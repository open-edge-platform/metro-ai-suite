# Use the Console UI

The Loitering Detection Console is the sample application's operator UI: a single page to
start/stop video analytics streams, pick a model and device, draw an evaluation zone, and watch
live per-object loitering analytics without going through Grafana or the DL Streamer Pipeline
Server's REST API directly.

## Prerequisites

Complete the [Get Started - Set up](../get-started.md#set-up-and-first-use) section, selecting
the **Console UI** installation option in point 2, and start the application.
Open `https://localhost/console/`, replacing `localhost` with the host IP for remote access.
Paths below are relative to the `metro-vision-ai-app-recipe` directory.

> [!CAUTION]
> The Console and sample scripts share the same Pipeline Server. Running `./sample_start.sh`
> stops all existing instances before launching the four fixed samples; `./sample_stop.sh`
> also stops all instances, including Console pipelines.

## Start and stop pipelines

Each **Pipeline N** card selects a source, model, and device. Click **Start pipelines** to
launch the configured cards. Each instance gets a panel titled
**Pipeline N · source · model · device**, with a live WebRTC view and a per-object loiter table.
Click **X** at the top right of a panel to stop that instance, or **Stop all** to stop all
pipelines shown in the Console. To change a zone, draw on a running pipeline's video as described in
[Change the zone](#change-the-zone).

## Customization

### Number of pipelines

Raising the **Number of pipelines** (1-8) adds one **Pipeline N** card per unit increase, each a
fully independent pipeline with its own Source/Model/Device - every pipeline you start becomes
its own DL Streamer Pipeline Server instance and its own panel, so they can run different
sources, models or devices at once, or the exact same ones for a true side-by-side comparison.
Lowering the count removes the trailing card(s); an already-started pipeline that corresponded
to a removed card keeps running. Click **X** at the top right of a panel to stop a pipeline,
or **Stop all** to stop all pipelines. Lowering the count only affects what the next
**Start pipelines** click will create.

**Start pipelines** only launches cards that are not already running - a card linked to a live
pipeline is marked **Running** next to its title and is left alone. So after starting
Pipeline 1 and 2, raising the count to add Pipeline 3 and clicking **Start pipelines** again
starts only Pipeline 3; it does not relaunch (duplicate) the pipelines already running. To
restart a card that is already running, **Stop** its panel first, then click **Start pipelines**
again.

A newly added card defaults to the **first** source and model in their dropdowns and GPU (if
available) for device - the same defaults every card gets, not a copy of another card's current
selection - so two freshly added pipelines start out identically configured. Change the fields
you want to differ (typically **Model**, to compare) before clicking **Start pipelines**; only
one card expands at a time (click another card's header to switch to it).

#### Example: compare two models side by side

1. Set the **Number of pipelines** to `2`. A **Pipeline 2** card appears below **Pipeline 1**,
   defaulted to the same source/model/device as pipeline 1.
2. Expand **Pipeline 1** and pick the first model you want to compare (e.g., the default
   `pedestrian-and-vehicle-detector-adas-0001`) and its **Source** and **Device**.
3. Expand **Pipeline 2**. Set its **Source** to the *same* video as Pipeline 1 (so both
   pipelines see identical input) and its **Model** to the second model you want to compare
   (e.g., `yolo11s` - see [Add a model to compare](#add-a-model-to-compare) if it is not
   listed yet). Leave **Device** as-is, or change it too if you also want to compare devices
   rather than just models.
4. Click **Start pipelines**. Two panels appear side by side, titled
   **Pipeline 1 · pedestrian-and-vehicle-detector-adas-0001 (FP16) · GPU** and
   **Pipeline 2 · yolo11s (FP16) · GPU** - same video, different model's boxes/labels/loiter
   table underneath each, so you can judge recall and false positives side by side on identical
   input.
5. To compare a third model, raise **Number of pipelines** to `3` and repeat step 3 for the new
   **Pipeline 3** card before clicking **Start pipelines** again - pipelines 1 and 2 keep running
   unaffected; only the newly started one is added alongside them.

### Change the video, model or device

Each pipeline card has its own:

- **Source**: pick a bundled sample video from the **Camera / stream** dropdown, or type an
  RTSP URL instead. The RTSP field takes priority when filled in. See
  [Change the video source](#change-the-video-source) below to add another bundled option.
- **Model**: choose the model to run. See [Add a model to compare](#add-a-model-to-compare)
  below to add another option - with two or more pipelines you can run different models on the
  same source side by side for comparison.
- **Device**: CPU, GPU or NPU. GPU is pre-selected because it gives the best throughput on
  most deployments; switch it if your hardware or model does not support that device.
- **Pipeline configuration**: for how Start/Stop map to DL Streamer Pipeline Server REST calls
  and element properties, see [Updating the Pipeline](./update-pipelines.md).

### Add a model to compare

The **Model** dropdown lists whatever is under the mounted model store
(`loitering-detection/src/dlstreamer-pipeline-server/models/`) as `<model>.xml` + `<model>.bin`
pairs, with an optional `<model>.json` model_proc beside them. Drop a new model's files into
that folder using the same layout and click the refresh button (&#x27F3;) next to **Model** -
no restart or code change is needed. A model whose Intermediate Representation (IR) has a
dynamic input shape is still listed but flagged, since GPU and NPU reject that shape and
returns no detections for it; re-export the model with a fixed input size to use it on every device.

### Change the video source

Add a source to the **Camera / stream** dropdown by adding an entry to `SOURCES_JSON` in
`console-addon/.env` (id, label, and a `file://` or `rtsp://` URI), then restart the `console`
service. For a one-off source there is no need to edit anything - use the RTSP field instead.

### Change the zone

The Zone card has no manual coordinate entry - check **Draw zone on video**, pick
**Rectangle (drag)** or **Polygon (click points)**, then draw directly on a running pipeline's
video. The shape previews there until you apply it with either **Apply to this pipeline**
(appears on the pipeline you drew on) or the card's **Apply zone to live pipelines** (every live
pipeline). Either way it replaces that pipeline's zones entirely with the shape you drew, under
the id `OperatorZone` - `gvaanalytics` evaluates one zone set or the other, never both. Starting
a new pipeline without drawing anything first keeps the deployment's own zone file exactly as
configured.

For persistent multi-zone configuration, see
[Zone configuration files](./customize-application.md#zone-configuration-files).
The deployed files under `loitering-detection/src/dlstreamer-pipeline-server/zones/` are read
fresh on every pipeline start, so editing the relevant file takes effect on the next
**Start pipelines** - no service restart is needed. Once a pipeline has been switched to a
custom zone there is no UI action to switch it back to the file's zones; stop it and start
a new one without a custom zone instead.

### Show or hide the dwell-time overlay

Select **Show dwell-time overlay on video** before starting pipelines to control the text
drawn by `loitering_watermark`. To change an existing pipeline's setting, stop it and start
it again with the desired checkbox state. This does not hide bounding boxes, zone outlines,
or the Console's table. See
[Video overlay](./customize-application.md#video-overlay) for the launch properties,
threshold settings, and restart behavior.

## How detection and zones interact

Detection and tracking (`gvadetect`/`gvatrack`) always run on the full frame, and `gvawatermark`
draws a box for every detected object - zones do not affect what gets boxed on screen.
`gvaanalytics` separately matches each tracked object's position against whichever zone set is
active for that session - the file's zones by default, or a single custom `OperatorZone`
shape once the operator customises it (never both at once, see
[Change the zone](#change-the-zone)) - and draws each zone's outline in its configured color
(e.g., the sample config's `Pathway` in red and `Driveway` in cyan; `OperatorZone` draws in green
since the console does not set a color for it). Only objects matched to at least one zone appear
in the table below and count toward that stream's dwell/loiter statistics; an object outside
every zone is still detected and boxed, it just never shows up there.

A box missing on an object that does look like it should be detected usually means the model
itself did not detect it that frame (meaning confidence is below the pipeline's threshold) —
check the stream's raw MQTT topic if this needs confirming, or try the `yolo11s` model, which
may have better recall for some object types/angles than the default `pedestrian-and-vehicle-detector-adas-0001`.

## How to read the panel

- **fps / objects / max dwell / loiter** summarise the stream: they count every object currently
  inside the session's active zone set (the config file's zones by default, or the custom
  `OperatorZone` shape once customised), not everything detected in the frame.
- The table below it lists every object currently inside any of those zones:
  - **Object ID** — the tracker's id for this object.
  - **Type** — the detected class (e.g., `pedestrian`).
  - **Zone** — every zone id this object currently matches (e.g., `Pathway, Driveway` if a
    track spans both polygons), so you can tell which zone(s) a row's dwell time is coming from
    when more than one file zone is active at once. This field only shows `OperatorZone` once
    a custom shape has replaced the file's zones.
  - **Status** — `Present` below the loiter threshold shown under the Zone card, `Loitering`
    at or above it.
  - **Dwell (s)** — `gvaanalytics`'s own measurement for the longest-running zone the object is
    currently in. This is the same figure Grafana reports.
- **System Utilization** reports host-wide CPU/GPU/NPU/memory load, not per-stream load; the
  GPU sub-line breaks down per-engine ratios (`bcs`/`ccs`/`rcs`/`vcs`/`vecs`) as percentages.

## Troubleshooting

See [Troubleshooting the Console UI](../troubleshooting.md#troubleshooting-the-console-ui) for
UI-specific issues (missing bounding boxes, zone edits, stuck/silent streams).
