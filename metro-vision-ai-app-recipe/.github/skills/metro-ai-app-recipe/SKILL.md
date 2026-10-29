---
name: metro-ai-app-recipe
description: >-
  Stand up a complete, ready-to-run computer-vision analytics stack on Intel
  hardware with one Docker Compose command — point it at your video sources and
  an OpenVINO/ONNX model to get live annotated WebRTC video plus real-time
  detection dashboards and alerts (object detection, classification, counting,
  or zone/line-crossing) for any vertical, with no glue code. See "When to use
  this skill" for the full component list, trigger conditions, and boundaries.
license: Apache-2.0
compatibility: >-
  Requires Docker + Docker Compose v2, host with Intel CPU (and optionally
  Intel GPU/NPU with `video`/`render` groups), outbound network access to
  Docker Hub, ghcr.io, and github.com (for model + sample video downloads).
  Ports 80 and 443 (Nginx) plus 3478/udp (Coturn TURN) must be free on the
  host; WebRTC also publishes MediaMTX port 8189 (tcp+udp) for ICE, with
  signalling proxied via Nginx. Tested
  with the open-edge-platform Metro Vision AI App Recipe reference
  (v2026.2.0 image tags).
---

# Metro AI App Recipe — DLSPS + WebRTC + Mosquitto + Node-RED + Grafana + Nginx

Build an end-to-end `{{OBJECT}}`-analytics stack on Intel hardware in
`./{{STACK_DIR}}/` with Docker Compose. **Vertical-agnostic:** the same
seven-container topology serves any DL Streamer / OpenVINO CV pipeline — only the
model, class filter, alert rule, dashboard, and topics differ. Follows the
open-edge-platform
[Metro Vision AI App Recipe](https://github.com/open-edge-platform/metro-ai-suite/tree/main/metro-vision-ai-app-recipe)
**MediaMTX + Coturn + WebRTC** path, streamlined (**no Prometheus/OTel**).
Scenescape is **off by default** (opt-in multi-camera analysis). Data-flow and
routing are detailed in **Reference architecture** below.

## When to use this skill

**Use when** building an object-detection, classification, object-counting, or
zone/line-crossing alerting pipeline for any vertical (see table below).
Optionally adds a Scenescape multi-camera path, or a lightweight demo/PoC single
app when no full stack is needed.

**Not for:** non-Intel or cloud-only deployments, Prometheus/OpenTelemetry
metrics stacks, or training/exporting models.

## Supported verticals & use-cases

| Vertical | Example use-cases (each = one invoking prompt) |
|---|---|
| Smart city / ITS | person/vehicle detection, ANPR, smart-parking, wrong-way |
| Retail | customer counting, queue-length, shelf out-of-stock, dwell-time |
| Industrial / logistics | surface-defect, PPE compliance, zone intrusion, forklift tracking |
| Healthcare / facilities | fall detection, hand-hygiene, occupancy, perimeter intrusion |
| Custom | any OpenVINO IR / ONNX detector + optional classifier |

The invoking prompt maps its vertical to concrete `{{OBJECT}}`,
`{{PIPELINE_NAME}}`, `{{DEFAULT_MODEL}}`, `{{DEFAULT_RULE}}`, `{{DASHBOARD_SLUG}}`
— nothing else changes.

## How to use this skill

1. Read this file end-to-end.
   When invoked by an orchestrator, reuse its approved specification for the
   questions below; ask only for missing required values. Surface incompatible
   choices (including model precision) before building, not after deployment.
2. Resolve packaging from the request or approved plan [microservice].
   If **demo/function/port** (single-app
   path), branch to [Demo/PoC mode](#demopoc-mode) + load
   [`references/DEMO_POC.md`](references/DEMO_POC.md), skip full-stack questions; else
   (**microservice**, the default full stack) continue.
3. Ask only unanswered questions below in ONE batch; accept defaults/empty.
   Skip the batch when the approved specification already supplies the answers.
4. Run parameter validation (below); refuse to proceed on any failure.
5. Load reference file(s) on demand — **not all up front** (per the *Reference
   files* table): Scenescape when `{{SCENESCAPE}}=yes`; PIPELINE for GPU/NPU,
   RTSP/`/dev/video`, or classifier; NODE_RED for `<`/`<=`/`>=` rules or a
   non-empty `{{CLASS_FILTER_IDS}}`.
6. Verify against completion criteria before declaring success (record
   throughput/latency vs `benchmark.md`); `validate_env.sh` is **step 0 of
   `install.sh`**.

## Reference files (load on demand)

| File | Load when authoring |
|---|---|
| [`references/PIPELINE.md`](references/PIPELINE.md) | DLSPS `config.json`, GPU/NPU variants (`_gpu`/`_npu` + `group_add`), input sources (file/RTSP/device), `gvaclassify` wiring, REST launcher, watchdog |
| [`references/PROXY_UI.md`](references/PROXY_UI.md) | `nginx.conf` proxy (WHEP/WHIP + WebRTC-TCP), Grafana iframe panels, dashboard provisioning, Mosquitto |
| [`references/NODE_RED.md`](references/NODE_RED.md) | `flows.json`, MQTT wildcard, `gva_meta` probe, alert flow |
| [`references/INSTALL.md`](references/INSTALL.md) | file layout, `.env`, `validate_env.sh` + rules, `install.sh`, `docker-compose.yml` volumes |
| [`references/TESTS.md`](references/TESTS.md) | `conftest.py`, `test_webrtc_stream.py`, assertion contracts |
| [`references/SCENESCAPE.md`](references/SCENESCAPE.md) | **`{{SCENESCAPE}}=yes` only** — multi-camera scene-fusion via `scenescape-setup` skill |
| [`references/DEMO_POC.md`](references/DEMO_POC.md) | **single-app packaging only** (`{{PACKAGING}}`∈`demo`/`function`/`port`) — lightweight single-app path (DL Streamer or OpenVINO); no full stack |

## Parameters (from invoking prompt)

| Param | Purpose |
|---|---|
| `{{PACKAGING}}` | `demo` \| `function` \| `microservice` \| `port` (default `microservice`). `demo`/`function`/`port` = single-app path ([DEMO_POC](references/DEMO_POC.md)); `microservice` = full stack (rows below are `microservice`-only) |
| `{{MODE}}` | Back-compat alias derived from `{{PACKAGING}}`: `demo` (single-app) \| `production` (= `microservice`) |
| `{{HW_TARGET}}` | Intel inference device: `CPU`\|`GPU`\|`NPU`\|`AUTO` (default `CPU`; `AUTO` = pick). Drives `sample_start.sh <cpu\|gpu\|npu>` + `_gpu`/`_npu` variants; no platform/generation naming |
| `{{OBJECT}}` | class label in dashboard/alerts (e.g. `person`, `vehicle`, `defect`, `fall`); any MQTT/Grafana-safe string |
| `{{STACK_DIR}}` | e.g. `person-detect-stack`, `ppe-compliance-stack`, `anpr-stack` |
| `{{DEFAULT_MODEL}}`, `{{OTHER_MODELS}}` | allowed model options; when `auto`, suggest from OpenVINO / Intel / Metro Analytics Catalog HF collections per a performance goal |
| `{{PIPELINE_NAME}}` | canonical DLSPS pipeline `name` (e.g. `yolov11s`); variants `<name>`/`_gpu`/`_npu`; topic `{{DETECTIONS_TOPIC_PREFIX}}_X/<name>` |
| `{{CLASSIFIER}}` | secondary model or `none`; if set, also `{{CLASSIFIER_URL}}` + `{{CLASSIFIER_XML}}` |
| `{{CLASS_FILTER_IDS}}` | JSON array of class IDs to keep (`[]`=all). Filtered in Node-RED |
| `{{DEFAULT_RULE}}` | e.g. `count>2 in 10s`; parses to `{{RULE_OP}}`∈`>`,`>=`,`<`,`<=`, `{{RULE_N}}`, `{{RULE_WINDOW_S}}` (see [NODE_RED](references/NODE_RED.md)) |
| `{{RULE_SCOPE}}` | `per-source` \| `aggregate` (default `per-source`) |
| `{{ALERT_TOPIC}}` | e.g. `alerts/{{OBJECT}}` |
| `{{DETECTIONS_TOPIC_PREFIX}}` | e.g. `object_detection` (per-source `_1`, `_2`, …) |
| `{{COUNT_TOPIC}}` | e.g. `stats/{{OBJECT}}_count` |
| `{{LABEL_RULE_NOTE}}` | model-specific classification note for Node-RED |
| `{{DASHBOARD_SLUG}}` | e.g. `smart-parking` |
| `{{NUM_SOURCES}}` | default `4` |
| `{{SCENESCAPE}}` | `yes` \| `no` (default `no`). `yes` = multi-camera path ([SCENESCAPE](references/SCENESCAPE.md)) |
| `{{SCENE_NAME}}` | (Scenescape only) scene name, e.g. `intersection-1` |
| `{{CAMERA_IDS}}` | (Scenescape only) unique IDs (no `/`), one per input stream, in input order |
| `{{TURN_USER}}`, `{{TURN_PASS}}` | Coturn / MediaMTX ICE credentials (default `turnuser` / a generated secret) |

## Questions (only missing information, single batch)

1. **Goal and alerts** — what objects/events matter, when should an alert fire,
   and where should it appear? [provided object/rule; MQTT `{{ALERT_TOPIC}}`,
   explicitly MQTT-only unless a visible/external channel is configured]
2. **Video and coverage** — how many sources and which files/cameras?
   [{{NUM_SOURCES}}× sample-video, independent views] Ask about cross-camera
   tracking only for multiple cameras; if needed, collect scene name and unique
   camera IDs and follow [SCENESCAPE](references/SCENESCAPE.md).
   RTSP/device inputs are continuous: no video download or file watchdog.
3. **Delivery** — full dashboard service or lightweight demo, and which output
   folder? [microservice, `{{STACK_DIR}}`]

Model, classifier, and hardware are optional preferences, not extra required
questions. Reuse supplied values; otherwise select the model for balanced
accuracy/latency, no classifier unless the goal requires one, and a supported
Intel CPU/GPU/NPU device. Show these choices before building; do not name
hardware generations.

For appearance alerts, carry through the approved transition/re-arm behavior
and cooldown separately from the count/window rule. State whether delivery is
MQTT-only, a visible dashboard notification, or an external destination; do not
claim email/webhook delivery without configuring and testing that destination.

For sample inputs, prefer licensed fixed-camera footage with minimal clutter and
clear target objects; retain source attribution. Verify real counts naturally
cross the approved threshold before using the clip as alert evidence. If they
do not, report the limitation rather than changing the rule or fabricating events.

## Parameter validation (enforce BEFORE `install.sh` runs)

Ship `validate_env.sh` and call it as step 0 of `install.sh`; reject on any
failure. The script body and full **validation rules table** (`PACKAGING`/`MODE`,
`HOST_IP`, `NUM_SOURCES`, `HW_TARGET`/`DEVICE`, `PIPELINE_NAME`, topics, TURN
creds, inputs, Scenescape params, …) are in
[`references/INSTALL.md`](references/INSTALL.md); validate `{{PACKAGING}}` ∈
`demo`/`function`/`microservice`/`port` and `{{HW_TARGET}}` ∈ `CPU`/`GPU`/`NPU`/`AUTO`.

## Reference architecture

Single Compose network `app_network`. Nginx publishes 80/443; **Coturn also
publishes `3478/udp`** (WebRTC TURN). Nginx reverse-proxies DLSPS REST, Grafana,
Node-RED, and MediaMTX WHEP/WHIP signalling (ICE 8189) — full route map in
[`references/PROXY_UI.md`](references/PROXY_UI.md). Data:
DLSPS→MQTT→Mosquitto→Node-RED→Grafana; DLSPS→WHIP→MediaMTX (peer-id
`{{DETECTIONS_TOPIC_PREFIX}}_N`, ICE/TURN via Coturn); Grafana embeds
`<iframe src="/mediamtx/{{DETECTIONS_TOPIC_PREFIX}}_N/">`.

## Demo/PoC mode

When packaging is `demo`/`function`/`port` (single-app packaging), **do not
build the full stack** — produce one lightweight app proving a model runs on
Intel HW (DL Streamer app or minimal OpenVINO script). Follow
[`references/DEMO_POC.md`](references/DEMO_POC.md) (load only on this branch);
production criteria (1–11) do **not** apply.

## Scenescape spatial-analysis path (optional, `{{SCENESCAPE}}=yes`)

When cross-camera tracking selects Scenescape, **branch**: keep the DLSPS detection pipeline
but replace the MediaMTX/WebRTC + Node-RED + Grafana-MQTT tail with an Intel®
Scenescape multi-camera scene-fusion stack. **Do not re-implement by hand** —
delegate to `scenescape-setup`, passing `{{SCENE_NAME}}` + `{{CAMERA_IDS}}`.
Architecture, images, validation, criteria in
[`references/SCENESCAPE.md`](references/SCENESCAPE.md); load only on this branch.
Default (`{{SCENESCAPE}}=no`) path is unchanged.

## Images — pin to the latest available tag (never `:latest`)

Resolve each image to the **newest published stable tag on Docker Hub** (query
the repo's `tags` API with `ordering=last_updated`), pin it, and ignore
`*-weekly` pre-releases. **Grafana is the one exception:** keep it pinned to
`11.5.4` (the MQTT datasource plugin only works on that tag).

- `intel/dlstreamer-pipeline-server:2026.2.0-ubuntu24`
- `eclipse-mosquitto:2.1.2-alpine`
- `nodered/node-red:5.0.4`
- `nginx:1.31.3-alpine`
- `bluenviron/mediamtx:1.20.0` (WebRTC: WHIP in, WHEP out)
- `coturn/coturn:4.17.0` (ICE/TURN)
- `grafana/grafana:11.5.4` (**pinned — do not upgrade**) with `GF_INSTALL_PLUGINS="grafana-mqtt-datasource 1.3.3,yesoreyeram-infinity-datasource 3.11.1"` — a bad plugin version kills the container → Nginx 502
- `intel/dlstreamer:2026.2.0-ubuntu24` (one-shot in `install.sh`: model dl + INT8 quantize + TLS cert)

## Layout (flat)

Generate a flat `{{STACK_DIR}}/`: `README.md`, `docker-compose.yml`, `.env`,
`validate_env.sh`, `install.sh`, `sample_*.sh`/`update_dashboard.sh`, a `src/`
tree (per-service dirs), and `tests/`. Full annotated tree in
[`references/INSTALL.md`](references/INSTALL.md).

### `README.md` (required content)

The generated `README.md` MUST document, at minimum:

- **Architecture** — the data + video flow from *Reference architecture* above;
  include the ASCII diagram + seven containers.
- **Quick start** — `./install.sh` → `docker compose up -d` →
  `./sample_start.sh <cpu|gpu|npu>`, plus stop/status scripts.
  Distinguish stopping detection from stopping the full stack. Disable the
  watchdog before deleting pipelines; document stopping any host-side watchdog
  as well as Compose services, preserving configuration and data.
- **Access URLs + credentials** — dashboard `https://<HOST_IP>/grafana/`
  (**Grafana login `admin`/`admin`**, change on first login), DLSPS REST
  `https://<HOST_IP>/api/pipelines`, WHEP
  `https://<HOST_IP>/mediamtx/{{DETECTIONS_TOPIC_PREFIX}}_N/`.
- **Configuration** — key `.env` values (`HOST_IP`, GIDs, TURN creds) + how to
  swap the video source for RTSP.
  Consume source/model/class/rule/cooldown settings from one documented
  configuration, validate them, and provide the regeneration/restart command;
  routine changes must not require editing generator or flow code.

## Template variable substitution

Substitute every `{{VAR}}` with its concrete value BEFORE writing any file — a
literal `{{...}}` left in `nginx.conf`, `config.json`, `flows.json`, the
dashboard JSON, or a test is a syntax error.

## Execution guardrails

- Hard timeouts: model dl+INT8 300 s; video dl 120 s/file; `compose pull` 300 s;
  `compose up -d` 120 s + 180 s healthy; each pytest 60 s.
- Max 2 retries per step, then STOP and print last 30 log lines from the failing
  container. Never loop.
- Before `compose up`: `ss -ltn` shows `:80`/`:443` free, `ss -lun` shows
  `:3478` free (Coturn TURN).
- **Bypass host proxy for all localhost/LAN curl** — corporate proxies route
  `https://localhost/...` through an unreachable proxy (→ `Could not resolve
  host` / 502). Every curl in `sample_*.sh` MUST use `--noproxy '*'` + `--cacert
  src/nginx/ssl/server.crt` (generated by `install.sh`); tests set `NO_PROXY=*`
  in `conftest.py`.
- Test WebRTC signalling with the criterion-7 curl (expect `200`; stream exists
  only after `sample_start.sh`). Test MQTT via `docker run --rm --network
  <project>_app_network eclipse-mosquitto:2.1.2-alpine mosquitto_sub -h broker -t
  '#' -v` (tag `2.1.2-alpine` is an intentional pin — never `:latest`).
- pytest venv at `./.venv` inside stack dir (`python -m venv .venv`) — system
  pip is PEP-668 blocked; `/tmp` may be `noexec`.

## Optional external skills

If available, invoke; otherwise write files from the reference templates.
- `dlstreamer-coding-agent` — pipeline JSON (+ single-app DL Streamer app when `{{PACKAGING}}`∈`demo`/`function`/`port`)
- `dlsps-user` — DLSPS deploy/config/REST; default `production` path ([PIPELINE](references/PIPELINE.md))
- `model-download` — OMZ model IR
- `scenescape-setup` — **only when `{{SCENESCAPE}}=yes`** ([SCENESCAPE](references/SCENESCAPE.md))

## Reference implementation

The upstream
[`smart-parking/src/`](https://github.com/open-edge-platform/metro-ai-suite/tree/main/metro-vision-ai-app-recipe/smart-parking/src)
recipe uses the same path — consult it for `config.json`, `mosquitto.conf`,
`nginx.conf`, `datasources.yml`, `dashboards.yml`, `flows.json` shapes; drop
`prometheus`/`otel-collector`/`metrics-manager`.

## Completion criteria (all must pass)

> When `{{SCENESCAPE}}=yes`, criteria 3–11 are **superseded** by the Scenescape
> criteria in [`references/SCENESCAPE.md`](references/SCENESCAPE.md); 1–2 still apply.

After changing a video/source, repeat the affected detection, count, notification,
browser playback/rendering, and file-replay checks against the final input.
Record source identity and observation time; earlier footage's results and
retained historical alerts are not proof for the replacement source.

1. `./install.sh` succeeds: `.env` populated; INT8 model + optional classifier
   IR under `src/dlstreamer-pipeline-server/models/…`; videos downloaded; TLS
   cert with SAN.
2. `./validate_env.sh cpu` exits 0 with a valid `.env`;
   `HOST_IP=127.0.0.1 ./validate_env.sh cpu` exits non-zero.
3. `docker compose up -d` → all containers `running`/`healthy` (incl.
   `mediamtx-server`, `coturn`).
4. `curl --cacert src/nginx/ssl/server.crt https://localhost/api/pipelines/status` returns 3 variants.
5. `./sample_start.sh <cpu|gpu|npu>` launches `{{NUM_SOURCES}}` pipelines; none
   `QUEUED`, all `RUNNING`.
6. Detections arrive on
   `{{DETECTIONS_TOPIC_PREFIX}}_1..{{NUM_SOURCES}}/{{PIPELINE_NAME}}`
   (or `_gpu`/`_npu`) within 30 s.
7. `curl --cacert src/nginx/ssl/server.crt https://localhost/mediamtx/{{DETECTIONS_TOPIC_PREFIX}}_1/`
   returns 200 (WHEP HTML) once pipelines run; MediaMTX logs show the WHIP
   publisher connected per `peer-id`.
8. Node-RED publishes JSON `{{ALERT_TOPIC}}` and **scalar** `{{COUNT_TOPIC}}` /
   `stats/alert_active` / `stats/alert_total` per `{{RULE_SCOPE}}`;
   `mosquitto_sub -t '{{COUNT_TOPIC}}/#' -C 1` MUST parse as `int()` (JSON breaks
   Grafana plotting).
9. Grafana at `https://localhost/grafana` (admin/admin) shows live {{OBJECT}}
   counts + alert data and `{{NUM_SOURCES}}` `<iframe>` WebRTC panels
   (`GF_SECURITY_ALLOW_EMBEDDING=true`). MQTT datasource health
   (`/grafana/api/datasources/uid/mqtt_ds/health`) MUST return `"MQTT
   Connected"` — broker in **`jsonData.uri`** (`tcp://broker:1883`), not `url:`.
   Blank-panel / redirect-loop fixes: [`references/PROXY_UI.md`](references/PROXY_UI.md).
   Verify in a browser that video frames advance and numeric panels receive
   live values matching MQTT, plus a visible notification when configured.
   WHEP HTML, publisher logs, datasource health, and panel configuration alone
   are not playback/rendering proof. If browser verification is unavailable,
   report this criterion as unverified, not passed.
10. `pytest -q tests/` passes; `pytest --collect-only -q tests/ | tail -1`
    reports ≥ 9 tests collected (no empty stubs).
11. **Watchdog continuity** (file:// sources): after `video-length + 30 s`,
    `/api/pipelines/status` shows `{{NUM_SOURCES}}` `RUNNING` (`COMPLETED`
    history is fine), WebRTC re-establishes, MQTT still flowing
    (`>{{NUM_SOURCES}}` `RUNNING` = missing watchdog dedup guard).
    Verify the detection stop command leaves no active pipelines after one
    watchdog interval; then verify the documented full-stack stop leaves no
    project services or host watchdog running. For a running-app delivery,
    restart and recheck health/detections afterward; honor explicit stop requests.

## Final summary — surface the proof (don't just name files)

Keep the closing summary concise: verified capabilities, failures or unverified
criteria, access URLs, credential guidance, start/stop/status commands, and
whether services remain running. Save criterion-by-criterion evidence and the
[*Final-summary proof points*](references/INSTALL.md#final-summary-proof-points)
in the generated README; link to it instead of repeating the full checklist.
