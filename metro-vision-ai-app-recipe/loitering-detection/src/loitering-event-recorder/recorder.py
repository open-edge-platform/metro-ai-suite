#!/usr/bin/env python3
"""Records the original camera stream through Stream Manager while people loiter.

Input : rows published by mqtt-table-flattener on <prefix>/<N>/<suffix> (one per loitering
        object per second, only once the dwell threshold is crossed).
Output: clips/cam-<N>/<start>_<recording_id>.mp4 and one line per recording in clips/events.jsonl.

One recording session per camera: the first loiterer starts it (with PRE_EVENT_SEC of
pre-roll), later loiterers join it, and it stops STOP_GRACE_SEC after the last one is gone.
"""
import calendar
import json
import logging
import os
import queue
import re
import shutil
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

import paho.mqtt.client as mqtt

MQTT_HOST = os.environ.get("MQTT_HOST", "broker")
MQTT_PORT = int(os.environ.get("MQTT_PORT", "1883"))
SOURCE_TOPIC_PREFIX = os.environ.get("SOURCE_TOPIC_PREFIX", "object_tracking")
DEST_TOPIC_SUFFIX = os.environ.get("DEST_TOPIC_SUFFIX", "loiterstatus")
SM_URL = os.environ.get("SM_URL", "http://stream-manager:8080/v1").rstrip("/")
CAMERA_IDS = [c.strip() for c in os.environ.get("CAMERA_IDS", "1,2,3,4").split(",") if c.strip()]
RTSP_URL_TEMPLATE = os.environ.get("RTSP_URL_TEMPLATE", "rtsp://rtsp-server:8554/cam-{id}")
SM_BUFFER_LENGTH = int(os.environ.get("SM_BUFFER_LENGTH", "30"))
PRE_EVENT_SEC = min(float(os.environ.get("PRE_EVENT_SEC", "5")), SM_BUFFER_LENGTH)
STOP_GRACE_SEC = float(os.environ.get("STOP_GRACE_SEC", "3"))
MAX_SESSION_SEC = float(os.environ.get("MAX_SESSION_SEC", "300"))
DELETE_REMOTE = os.environ.get("DELETE_REMOTE_AFTER_DOWNLOAD", "true").lower() == "true"
CLIPS_DIR = os.environ.get("CLIPS_DIR", "/clips")

TICK_SEC = 0.5
STREAM_CHECK_OK_SEC = 10.0
STREAM_CHECK_PENDING_SEC = 2.0
RETRY_BACKOFF_SEC = 5.0
MAX_STOP_ATTEMPTS = 5
FINALIZE_TIMEOUT_SEC = 180.0
DOWNLOAD_ATTEMPTS = 3
FINALIZER_THREADS = 2

ID_RE = re.compile(r"^[A-Za-z0-9_-]+$")
TS_RE = re.compile(r"^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?Z$")

log = logging.getLogger("loitering-event-recorder")

# Stream Manager is only reached on the compose network, never through a proxy.
_opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
_index_lock = threading.Lock()
_finalize_queue = queue.Queue()


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


def ts_to_ns(ts):
    m = TS_RE.match(ts)
    if not m:
        raise ValueError(f"unexpected timestamp {ts!r}")
    secs = calendar.timegm(time.strptime(m.group(1), "%Y-%m-%dT%H:%M:%S"))
    return secs * 10**9 + int((m.group(2) or "").ljust(9, "0")[:9])


def track_snapshot(history):
    return [
        {
            "track_id": i["track_id"],
            "zone": i["zone"],
            "type": i["type"],
            "detected_at": wall_to_ts(i["detected_wall"]),
            "last_seen_at": wall_to_ts(i["seen_wall"]),
            "max_dwell_sec": i["max_dwell"],
        }
        for i in history.values()
    ]


class Camera:
    def __init__(self, cam_id):
        self.id = cam_id
        self.sensor_id = f"cam-{cam_id}"
        self.source_uri = RTSP_URL_TEMPLATE.format(id=cam_id)
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
            self._end_session(reason, None)
            return
        log.info("%s: recording %s stopped (%s)", self.sensor_id, session["recording_id"], reason)
        self._end_session(reason, session)

    def _end_session(self, reason, session):
        with self.lock:
            tracks = track_snapshot(self.history or {})
            self.history = None
            old, self.session = self.session, None
        self.carry_segment = old["segment"] + 1 if reason == "max session length" else 0
        if session is not None:
            session["camera"] = self
            session["tracks"] = tracks
            _finalize_queue.put(session)


def finalize(session):
    cam, rid = session["camera"], session["recording_id"]
    if not ID_RE.match(rid):
        log.error("%s: refusing unexpected recording id %r", cam.sensor_id, rid)
        return
    deadline = time.monotonic() + FINALIZE_TIMEOUT_SEC
    while True:
        try:
            rec = sm_request("GET", f"/records/{rid}")
            if rec.get("state") == "ready":
                break
            if rec.get("state") == "failed":
                log.error("%s: recording %s failed: %s", cam.sensor_id, rid, rec.get("error_detail"))
                return
        except SMError as e:
            if e.code == "recording_not_found":
                log.error("%s: recording %s disappeared", cam.sensor_id, rid)
                return
        if time.monotonic() > deadline:
            log.error("%s: recording %s not ready in time", cam.sensor_id, rid)
            return
        time.sleep(1)

    start_ns, end_ns = ts_to_ns(rec["start_ts"]), ts_to_ns(rec["end_ts"])
    duration = (end_ns - start_ns) / 1e9 - 0.001  # stay inside the recording's end
    if duration <= 0:
        log.error("%s: recording %s is empty", cam.sensor_id, rid)
        return
    stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime(start_ns // 10**9))
    rel_path = os.path.join(f"cam-{cam.id}", f"{stamp}_{rid}.mp4")
    final_path = os.path.join(CLIPS_DIR, rel_path)
    os.makedirs(os.path.dirname(final_path), exist_ok=True)
    query = urllib.parse.urlencode({"start_ts": rec["start_ts"], "duration": f"{duration:.3f}", "format": "mp4"})
    for attempt in range(1, DOWNLOAD_ATTEMPTS + 1):
        try:
            resp = sm_request("GET", f"/retrieve/{rid}/clip?{query}", accept="video/mp4", timeout=900, stream=True)
            with resp, open(final_path + ".part", "wb") as f:
                shutil.copyfileobj(resp, f)
            os.replace(final_path + ".part", final_path)
            break
        except (SMError, OSError) as e:
            log.warning("%s: clip download for %s failed (%d/%d): %s", cam.sensor_id, rid, attempt, DOWNLOAD_ATTEMPTS, e)
            if attempt == DOWNLOAD_ATTEMPTS:
                log.error("%s: giving up on clip %s; recording kept in Stream Manager", cam.sensor_id, rid)
                return
            time.sleep(2 * attempt)

    event = {
        "recording_id": rid, "camera": cam.sensor_id, "clip": rel_path.replace(os.sep, "/"),
        "start_ts": rec["start_ts"], "end_ts": rec["end_ts"], "segment": session["segment"],
        "pre_event_sec": session["pre_event"], "tracks": session["tracks"],
    }
    if rec.get("error_detail"):
        event["warning"] = rec["error_detail"]
    with _index_lock, open(os.path.join(CLIPS_DIR, "events.jsonl"), "a") as f:
        f.write(json.dumps(event) + "\n")
    log.info("%s: saved clip %s", cam.sensor_id, final_path)

    if DELETE_REMOTE:
        try:
            sm_request("DELETE", f"/records/{rid}")
        except SMError as e:
            log.warning("%s: could not delete recording %s: %s", cam.sensor_id, rid, e)


def finalizer_loop():
    while True:
        session = _finalize_queue.get()
        try:
            finalize(session)
        except Exception:
            log.exception("finalizing %s failed", session.get("recording_id"))


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    for cam_id in CAMERA_IDS:
        if not ID_RE.match(cam_id):
            raise SystemExit(f"invalid camera id {cam_id!r}")
    cameras = {cam_id: Camera(cam_id) for cam_id in CAMERA_IDS}
    os.makedirs(CLIPS_DIR, exist_ok=True)

    def on_connect(client, userdata, flags, rc):
        client.subscribe(f"{SOURCE_TOPIC_PREFIX}/+/{DEST_TOPIC_SUFFIX}")

    def on_message(client, userdata, msg):
        cam = cameras.get(msg.topic.split("/")[-2])
        if cam is None:
            return
        try:
            cam.on_row(json.loads(msg.payload))
        except (ValueError, TypeError, AttributeError):
            pass

    # paho-mqtt 1.x API, as bundled in the dlstreamer-pipeline-server image
    client = mqtt.Client()
    client.on_connect = on_connect
    client.on_message = on_message
    client.connect_async(MQTT_HOST, MQTT_PORT, keepalive=60)
    client.loop_start()

    for _ in range(FINALIZER_THREADS):
        threading.Thread(target=finalizer_loop, daemon=True).start()

    log.info("watching cameras %s (pre-roll %.0fs, grace %.0fs, max session %.0fs)",
             ",".join(CAMERA_IDS), PRE_EVENT_SEC, STOP_GRACE_SEC, MAX_SESSION_SEC)
    while True:
        for cam in cameras.values():
            try:
                cam.tick()
            except Exception:
                log.exception("%s: tick failed", cam.sensor_id)
        time.sleep(TICK_SEC)


if __name__ == "__main__":
    main()
