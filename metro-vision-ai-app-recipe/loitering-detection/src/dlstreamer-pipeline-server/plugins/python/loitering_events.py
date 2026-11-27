# SPDX-FileCopyrightText: (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
"""gvapython stage for the loitering-detection pipelines (one instance per camera pipeline).

Placed after gvametaconvert, so every frame already carries the per-frame metadata JSON
(the same object_tracking/<N> payload that the former mqtt-table-flattener and
loitering-event-recorder services consumed over MQTT). Per frame it:

* publishes one row per loitering object (dwell >= threshold) to
  <topic_prefix>/<camera_id>/<topic_suffix>, at most once per PUBLISH_INTERVAL_SEC.
  This is the feed for the Grafana MQTT table panel.
* when SM_URL is set, feeds the same rows to a per-camera recorder. It starts a Stream
  Manager recording on the first loiterer and stops it after the last one leaves.

Work on the streaming thread is limited to JSON parsing, an in-memory update and a
non-blocking MQTT publish. Stream Manager HTTP calls run on the tick thread.

Per-camera configuration is passed through the gvapython "arg" property as a JSON object:
  {"camera_id": "1", "source_uri": "rtsp://rtsp-server:8554/cam-1",
   "topic_prefix": "object_tracking", "topic_suffix": "loiterstatus", "threshold": 5.0}
"""
import json
import logging
import os
import re
import threading
import time
import urllib.error
import urllib.request
import weakref
from datetime import datetime, timezone

import paho.mqtt.client as mqtt

MQTT_HOST = os.environ.get("MQTT_HOST", "broker")
MQTT_PORT = int(os.environ.get("MQTT_PORT", "1883"))
PUBLISH_INTERVAL_SEC = float(os.environ.get("PUBLISH_INTERVAL_SEC", "1.0"))
# Empty SM_URL disables recording; the table rows are published either way.
SM_URL = os.environ.get("SM_URL", "").rstrip("/")
SM_BUFFER_LENGTH = int(os.environ.get("SM_BUFFER_LENGTH", "30"))
PRE_EVENT_SEC = min(float(os.environ.get("PRE_EVENT_SEC", "5")), SM_BUFFER_LENGTH)
STOP_GRACE_SEC = float(os.environ.get("STOP_GRACE_SEC", "3"))
MAX_SESSION_SEC = float(os.environ.get("MAX_SESSION_SEC", "300"))

TICK_SEC = 0.5
STREAM_CHECK_OK_SEC = 10.0
STREAM_CHECK_PENDING_SEC = 2.0
RETRY_BACKOFF_SEC = 5.0
MAX_STOP_ATTEMPTS = 5

ID_RE = re.compile(r"^[A-Za-z0-9_-]+$")

log = logging.getLogger("loitering-events")
if not log.handlers:
    _handler = logging.StreamHandler()
    _handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
    log.addHandler(_handler)
    log.setLevel(logging.INFO)
    log.propagate = False

# Stream Manager is only reached on the compose network, never through a proxy.
_opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))


class SMError(Exception):
    def __init__(self, status, code, detail):
        super().__init__(f"{status} {code}: {detail}")
        self.status = status
        self.code = code
        self.detail = detail


def sm_request(method, path, body=None, accept="application/json", timeout=15, stream=False):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(SM_URL + path, data=data, method=method)
    req.add_header("Accept", accept)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        resp = _opener.open(req, timeout=timeout)
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            err = json.loads(raw)
        except ValueError:
            err = {}
        raise SMError(e.code, err.get("error_code"), err.get("error_detail") or raw[:200]) from None
    except (urllib.error.URLError, OSError) as e:
        raise SMError(0, "unreachable", str(e)) from None
    if stream:
        return resp
    with resp:
        payload = resp.read()
    return json.loads(payload) if payload else {}


def wall_to_ts(t):
    return datetime.fromtimestamp(t, timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f") + "Z"


class Camera:
    """Recording state machine for one camera. Only ever driven by its tick thread and on_row()."""

    def __init__(self, cam_id, source_uri):
        self.id = cam_id
        self.sensor_id = f"cam-{cam_id}"
        self.source_uri = source_uri
        self.lock = threading.Lock()
        self.active = {}  # (track, zone) -> info, only objects currently loitering
        self.history = None  # (track, zone) -> info for the open session, None when idle
        self.session = None
        self.carry_segment = 0
        self.stream_id = None
        self.stream_ok = False
        self.next_stream_check = 0.0
        self.retry_at = 0.0

    def on_row(self, row):
        key = (row.get("Track ID"), row.get("Zone"))
        dwell = float(row.get("Dwell Time (s)") or 0)
        now_wall, now_mono = time.time(), time.monotonic()
        with self.lock:
            info = self.active.get(key)
            if info is None:
                info = self.history.get(key) if self.history is not None else None
                if info is None:
                    info = {
                        "track_id": key[0], "zone": key[1], "type": row.get("Type"),
                        "detected_wall": now_wall, "max_dwell": 0.0,
                    }
                self.active[key] = info
                if self.history is not None:
                    self.history[key] = info
            info["seen_wall"], info["seen_mono"] = now_wall, now_mono
            info["max_dwell"] = max(info["max_dwell"], round(dwell, 1))

    def refresh_stream(self, now):
        if now < self.next_stream_check:
            return
        try:
            items = sm_request("GET", "/streams").get("items", [])
            # The stream listing has no source_uri, so a sensor_id is assumed to be ours
            streams = [s for s in items if s.get("sensor_id") == self.sensor_id]
            for s in streams:
                if s.get("state") == "failed":
                    log.warning("%s: stream %s failed, re-creating", self.sensor_id, s["stream_id"])
                    try:
                        sm_request("DELETE", f"/streams/{s['stream_id']}")
                    except SMError as e:
                        log.warning("%s: cannot delete stream %s: %s", self.sensor_id, s["stream_id"], e)
            match = next((s for s in streams if s.get("state") != "failed"), None)
            if match is None:
                match = sm_request("POST", "/streams", {
                    "sensor_id": self.sensor_id, "source_uri": self.source_uri,
                    "buffer_length": SM_BUFFER_LENGTH,
                })
                log.info("%s: registered stream %s", self.sensor_id, match["stream_id"])
            self.stream_id = match["stream_id"]
            self.stream_ok = match.get("state") == "buffering"
        except SMError as e:
            log.warning("%s: stream check failed: %s", self.sensor_id, e)
        self.next_stream_check = now + (STREAM_CHECK_OK_SEC if self.stream_ok else STREAM_CHECK_PENDING_SEC)

    def tick(self):
        now = time.monotonic()
        self.refresh_stream(now)
        with self.lock:
            for key in [k for k, i in self.active.items() if now - i["seen_mono"] > STOP_GRACE_SEC]:
                del self.active[key]
            loitering = bool(self.active)
            earliest = min((i["detected_wall"] for i in self.active.values()), default=None)
        if self.session is None:
            if loitering and self.stream_ok and now >= self.retry_at:
                self.start_session(earliest, now)
            return
        if not loitering:
            reason = "loitering ended"
        elif MAX_SESSION_SEC and now - self.session["started_mono"] >= MAX_SESSION_SEC:
            reason = "max session length"
        elif not self.stream_ok:
            reason = "stream lost"
        else:
            return
        self.stop_session(reason)

    def start_session(self, earliest, now):
        segment = self.carry_segment
        attempts = [(time.time(), 0)] if segment else [(earliest, PRE_EVENT_SEC), (time.time(), 0)]
        with self.lock:
            history = dict(self.active)
        if not history:
            return
        trigger = next(iter(history.values()))
        for start_wall, pre in attempts:
            body = {
                "stream_id": self.stream_id,
                "start_ts": wall_to_ts(start_wall),
                "metadata": {"source": "loitering-detection", "camera": self.sensor_id, "segment": segment,
                             "trigger_track": trigger["track_id"], "trigger_zone": trigger["zone"]},
            }
            if pre:
                body["pre_event_duration"] = pre
            try:
                rec = sm_request("POST", "/records/start", body)["recordings"][0]
            except SMError as e:
                if e.code == "history_unavailable" and pre:
                    log.warning("%s: no history for %.0fs pre-roll, retrying without it", self.sensor_id, pre)
                    continue
                if e.code == "stream_not_found":
                    self.stream_id, self.stream_ok, self.next_stream_check = None, False, 0.0
                self.retry_at = now + RETRY_BACKOFF_SEC
                log.error("%s: cannot start recording: %s", self.sensor_id, e)
                return
            with self.lock:
                self.history = history
                self.session = {
                    "recording_id": rec["recording_id"], "started_mono": time.monotonic(),
                    "segment": segment, "pre_event": pre, "stop_attempts": 0,
                }
            log.info("%s: recording %s started (segment %d, pre-roll %.0fs)",
                     self.sensor_id, rec["recording_id"], segment, pre)
            return

    def stop_session(self, reason):
        session = self.session
        try:
            sm_request("POST", "/records/stop", {"recording_id": session["recording_id"]})
        except SMError as e:
            session["stop_attempts"] += 1
            if e.code not in ("recording_not_found", "record_not_ready", "history_unavailable") \
                    and session["stop_attempts"] < MAX_STOP_ATTEMPTS:
                log.warning("%s: stop failed (%s), will retry", self.sensor_id, e)
                return
            log.error("%s: dropping recording %s: %s", self.sensor_id, session["recording_id"], e)
            self._end_session(reason)
            return
        log.info("%s: recording %s stopped (%s)", self.sensor_id, session["recording_id"], reason)
        self._end_session(reason)

    def _end_session(self, reason):
        with self.lock:
            self.history = None
            old, self.session = self.session, None
        self.carry_segment = old["segment"] + 1 if reason == "max session length" else 0


def _tick_loop(cam_ref):
    # Holds only a weak reference, so the thread ends when the pipeline element is released.
    while True:
        cam = cam_ref()
        if cam is None:
            return
        try:
            cam.tick()
        except Exception:
            log.exception("%s: tick failed", cam.sensor_id)
        del cam
        time.sleep(TICK_SEC)


def _load_config(raw):
    if isinstance(raw, str):
        raw = json.loads(raw)
    if isinstance(raw, list) and len(raw) == 1:
        raw = raw[0]
    if not isinstance(raw, dict):
        raise ValueError("loitering_events: arg must be a JSON object")
    return raw


class LoiteringEvents:
    """gvapython class: pass `class=LoiteringEvents function=process_frame` in the pipeline."""

    def __init__(self, config=None):
        cfg = _load_config(config)
        self.camera_id = str(cfg.get("camera_id", ""))
        if not ID_RE.match(self.camera_id):
            raise ValueError(f"loitering_events: invalid camera_id {self.camera_id!r}")
        prefix = cfg.get("topic_prefix", "object_tracking")
        suffix = cfg.get("topic_suffix", "loiterstatus")
        self.topic = f"{prefix}/{self.camera_id}/{suffix}"
        self.threshold = float(cfg.get("threshold", 5.0))
        self._last_publish = 0.0

        # paho-mqtt 1.x API, as bundled in the dlstreamer-pipeline-server image
        self._mqtt = mqtt.Client()
        self._mqtt.connect_async(MQTT_HOST, MQTT_PORT, keepalive=60)
        self._mqtt.loop_start()

        self.camera = None
        if SM_URL:
            source_uri = cfg.get("source_uri", "")
            if not source_uri:
                raise ValueError("loitering_events: source_uri is required when recording is enabled")
            self.camera = Camera(self.camera_id, source_uri)
            threading.Thread(target=_tick_loop, args=(weakref.ref(self.camera),), daemon=True).start()
            log.info("cam-%s: recording enabled (pre-roll %.0fs, grace %.0fs, max session %.0fs)",
                     self.camera_id, PRE_EVENT_SEC, STOP_GRACE_SEC, MAX_SESSION_SEC)
        else:
            log.info("cam-%s: recording disabled (SM_URL not set)", self.camera_id)
        log.info("cam-%s: publishing loitering rows to %s (threshold %.1fs)",
                 self.camera_id, self.topic, self.threshold)

    def __del__(self):
        try:
            self._mqtt.loop_stop()
            self._mqtt.disconnect()
        except Exception:  # pylint: disable=broad-except
            pass

    def process_frame(self, frame):
        try:
            self._process(frame)
        except Exception:  # pylint: disable=broad-except
            # Never let an analytics-side error break the pipeline
            log.exception("cam-%s: frame processing failed", self.camera_id)
        return True

    def _process(self, frame):
        messages = frame.messages()
        if not messages:
            return
        payload = json.loads(messages[-1])
        # gvapython delivers the unwrapped message; the MQTT topic wraps it under "metadata"
        objects = payload.get("objects") or payload.get("metadata", {}).get("objects", [])

        rows = []
        for obj in objects:
            dwell_times = obj.get("dwell_times")
            if not dwell_times:
                continue
            dwell = dwell_times[0]
            dwell_sec = dwell.get("dwell_time_sec", 0)
            if dwell_sec < self.threshold:
                continue
            rows.append({
                "Stream": self.camera_id,
                "Track ID": obj.get("id"),
                "Type": obj.get("roi_type"),
                "Zone": dwell.get("zone_id"),
                "Dwell Time (s)": round(dwell_sec, 1),
            })
        if not rows:
            return

        if self.camera is not None:
            for row in rows:
                self.camera.on_row(row)

        # Throttle the table feed the same way the former flattener did (one publish per interval)
        now = time.monotonic()
        if now - self._last_publish >= PUBLISH_INTERVAL_SEC:
            self._last_publish = now
            for row in rows:
                self._mqtt.publish(self.topic, json.dumps(row), qos=0)
