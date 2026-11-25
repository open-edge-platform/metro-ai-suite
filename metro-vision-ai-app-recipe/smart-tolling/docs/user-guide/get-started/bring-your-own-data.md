<!--hide_directive
```{eval-rst}
.. meta::
   :description: Prepare your own videos, Scenescape scene ZIP file, pipeline configuration, and models before you run the Smart Tolling application.
   :keywords: Smart Tolling, bring your own data, Scenescape, scene ZIP, videos, pipeline configuration, models
```
hide_directive-->

# Bring Your Own Data

This application ships without sample videos or scene data. Before you run `install.sh`,
prepare the items below.

## What You Need

- **Input sources**: 6 videos (see [Add Your Videos](#1-add-your-videos)) or live RTSP cameras.
- **A Scenescape scene ZIP** (`.zip`): your own 3D map with cameras and toll-lane
  regions already placed on it.
- The resolution and layout of your cameras, so you can adjust detection regions to match.

## 1. Add Your Videos

### 1.1 Camera Setup

The application simulates a **toll point**: a short stretch of road with a fixed set of cameras
mounted on a gantry or pole above the lanes. Each model needs a close, specific view of
each vehicle. The sample has **2 lanes** (L and R) and **6 cameras**:

| Camera | Count | Purpose | View |
| :--- | :--- | :--- | :--- |
| **Front** | 1 per lane (2) | Read the front license plate | Ahead of the vehicles, looking back at them as they drive toward the camera. Shows one lane. |
| **Rear** | 1 per lane (2) | Read the rear license plate | Behind the vehicles, looking at them as they drive away. Shows one lane. |
| **Side** | 2, shared by both lanes | Detect wheels and axles | Beside the road and elevated, looking across both lanes. Both cameras show the same vehicles from different positions. |

`L` and `R` are only naming labels for the two lanes. Any consistent choice works, as long as the
file name, the pipeline, and the Scenescape camera ID refer to the same lane.

```text
                       direction of travel
                              ^
                              |
    FRONT cameras      [F-L]     [F-R]     <- ahead of the vehicles, look back at them
    (FrontView_*)        |         |
                         v         v
                  +-----------+-----------+
                  |           |           |
                  |  lane L   |  lane R   |
                  |     ^     |     ^     | <--- [S-2]   S-1, S-2: SIDE cameras beside
                  |     |     |     |     |              the road, looking across
      [S-1]  ---> |           |           |              both lanes
   (SideAxle_*)   |           |           |
                  +-----------+-----------+
                        ^           ^
                        |           |
    REAR cameras      [R-L]       [R-R]    <- behind the vehicles, look at their rear
    (RearView_*)
```

> [!NOTE]
> The sample videos use an elevated camera position. Exact heights, distances and angles are
> flexible. What matters is the result in the video: see the requirements in the next section.
> If you are unsure, record a short test clip and check it against those requirements before you
> record the full set.

### 1.2 What Each Video Must Contain

Place your video files in `src/dlstreamer-pipeline-server/videos/` using these exact names:

| File name | Camera | Lane | Pipeline |
| :--- | :--- | :--- | :--- |
| `FrontView_L_30fps.ts` | Front | Left (L) | `toll-front-l` |
| `FrontView_R_30fps.ts` | Front | Right (R) | `toll-front-r` |
| `RearView_L_30fps.ts` | Rear | Left (L) | `toll-rear-l` |
| `RearView_R_30fps.ts` | Rear | Right (R) | `toll-rear-r` |
| `SideAxle_Lane_1_30fps.ts` | Side 1 | Both lanes | `toll-side-l1` |
| `SideAxle_Lane_2_30fps.ts` | Side 2 | Both lanes | `toll-side-l2` |

#### Front and rear videos (`FrontView_*`, `RearView_*`)

| Requirement | Details |
| :--- | :--- |
| **Subject** | The traffic of **one lane**. The sample pipelines analyze the full frame, so other lanes that appear in the frame are detected too. If a neighboring lane is partly visible, narrow the detection region as described in [Update the Pipeline](#3-update-the-pipeline). |
| **Must be visible** | The whole vehicle front (or rear) and the **license plate, sharp enough to read**. As a rule of thumb, the characters should be clearly readable by eye when you pause the video at the point where the vehicle is closest. |
| **Vehicle behavior** | Vehicles drive straight through the lane at normal toll speed, with no lane changes. Front videos show only approaching vehicles, and rear videos show only departing vehicles. |
| **Pitfalls** | Plates hidden by another vehicle, strong glare or headlights facing the lens, extreme side angles, and plates that are only a few pixels wide. |

#### Side videos (`SideAxle_*`)

| Requirement | Details |
| :--- | :--- |
| **Subject** | Vehicles in **both lanes**, seen from the side. |
| **Must be visible** | The **entire vehicle length** passing through the frame (cab to last trailer), with **all wheels and the road surface under them** visible. The software finds the wheels, then compares their height to the road to decide whether an axle is lifted. If the road under the wheels is hidden, lifted axles cannot be told apart. |
| **Framing** | Keep the vehicle fully inside the frame at some moment. The adapter only saves a vehicle's best image when the vehicle does not touch the left or right edge of the frame. Wheels should appear in the lower part of the frame. The sample pipelines analyze only a horizontal band of the frame (for example `roi=5,400,1915,960` for `toll-side-l1`). Adjust that band to your framing. |
| **Pitfalls** | A near-horizontal view only a few pixels above the road, vehicles in the next lane hiding the wheels, and a camera so close that long trucks do not fit in the frame. |

#### Technical format (all 6 videos)

These values match the sample videos used during development:

| Property | Value |
| :--- | :--- |
| Container and codec | MPEG-TS (`.ts`), H.264 |
| Resolution | 1920x1080 (the detection regions in `config.json` assume this size) |
| Frame rate | 30 fps |
| Length | Any. The pipeline plays each file in a loop. The sample files are about 10 minutes long, so make sure several different vehicles pass in each file. |
| Audio | Ignored (can be omitted) |

To convert another format (for example MP4) to this format, run:

```bash
ffmpeg -i input.mp4 -vf scale=1920:1080 -r 30 -c:v libx264 -an -f mpegts FrontView_L_30fps.ts
```

#### Consistency across all 6 videos

- **Same recording.** All 6 files must show the same stretch of time and the same road section. A vehicle
  in a front video must also appear in the side and rear videos, in the right order. The application merges
  the views of one vehicle into one record, so unrelated clips produce incomplete or split records.
- **Same scene.** The camera positions must match the cameras you place in the
  Scenescape scene (see [Add Your Scene](#2-add-your-scene)).

### 1.3 Highways With More Than 2 Lanes

A highway with more lanes, for example 8 lanes (4 per direction), is supported by adding cameras and
pipelines. This requires editing `config.json` (new pipelines) and `init.sh` (video list). Plan the cameras like this:

- **Front and rear:** one front camera and one rear camera for each lane that you want to toll.
- **Side:** every lane must be fully visible, with all wheels and the road under them, in at least
  one side video. The number of side cameras depends on how many lanes each one can cover.
- **Opposite-direction lanes:** swap the roles. A camera that sees the front of vehicles in
  one direction sees the rear of vehicles in the other direction. Name and configure each file by what
  it shows (front or rear plate), not by where the camera is mounted.

For each new camera:

1. Add a pipeline entry to the `pipelines` list in `src/dlstreamer-pipeline-server/config.json`.
   The easiest way is to copy an existing pipeline of the same type (front, rear or side) and
   change these values:
   - `name`, for example `toll-front-l3`.
   - `destination.frame.path`, which must be unique.
   - `location=` in the `multifilesrc` source: the path to the new video.
   - `parameters.camera_config.cameraid`: the camera ID from your Scenescape scene.
   - `parameters.camera_config.view_angle`: `front` or `rear` for plate cameras, depending on which
     plate they see, and `left` or `right` for side cameras.
   - The `roi=` values of `gvaattachroi`.
2. Add the video file to `src/dlstreamer-pipeline-server/videos/`.
3. Add the camera and its calibration to the Scenescape scene. See
   [Integrate Cameras and Sensors](https://docs.openedgeplatform.intel.com/2026.3/scenescape/how-to-guides/integrate-cameras-and-sensors.html).
4. Update the video list in `init.sh`, which checks that the videos exist before starting.

Every pipeline needs more CPU, GPU and NPU capacity. See the next section and
[Optimization](../how-it-works/optimization.md), and add lanes step by step while the frame rate
stays near 30 fps.

### 1.4 Choose Which Pipelines Start Automatically

Each pipeline in `config.json` has an `auto_start` setting. In the shipped configuration,
`toll-front-l` and `toll-rear-l` have `auto_start` set to `false` so that the other streams keep
30 fps on lower-end machines. The remaining four pipelines start automatically. On more powerful
hardware, set `auto_start` to `true` to process all 6 streams. On weaker hardware, set it to `false`
for the pipelines you can leave out. All 6 video files must be present in either case, because
`init.sh` checks for them.

### 1.5 Other Sources

To use live RTSP cameras instead of files, edit the `pipeline` string of the matching pipeline in
`src/dlstreamer-pipeline-server/config.json`. See the
[DL Streamer Pipeline Server documentation](https://docs.openedgeplatform.intel.com/2026.3/edge-ai-libraries/dlstreamer-pipeline-server/index.html)
for pipeline configuration. Replace the file source at the start:

```text
multifilesrc loop=true location=/home/pipeline-server/videos/FrontView_L_30fps.ts name=source ! decodebin3
```

with an RTSP source:

```text
rtspsrc location=rtsp://<camera-host>:<port>/<stream-path> protocols=tcp latency=100 name=source ! rtph264depay ! h264parse ! decodebin3
```

Keep the rest of the pipeline unchanged. The stream must be H.264 and follow the same camera
requirements as the videos above. `init.sh` still checks for the 6 video files, so keep placeholder
files in `src/dlstreamer-pipeline-server/videos/` or remove that check for the cameras you replace.

## 2. Add Your Scene

The application needs a Scenescape "scene": a 3D map with cameras and toll-lane regions
calibrated on it, exported as a `.zip` archive. At startup, the `scene-uploader` service
imports every `<scene>/<scene>.zip` found under `src/webserver/scenes/`.

- Build and calibrate your scene using Scenescape's
  [Create a New Scene](https://docs.openedgeplatform.intel.com/2026.3/scenescape/how-to-guides/build-a-scene/create-new-scene.html)
  and [Integrate Cameras and Sensors](https://docs.openedgeplatform.intel.com/2026.3/scenescape/how-to-guides/integrate-cameras-and-sensors.html)
  guides.
- Export your scene to `src/webserver/scenes/Smart-Tolling/Smart-Tolling.zip` by following
  [Export the Scene](https://docs.openedgeplatform.intel.com/2026.3/scenescape/how-to-guides/build-a-scene/create-new-scene.html#exporting-and-importing-the-scene).
  If you keep this exact ZIP name, no further changes are needed. To use a different name, see
  the step below.

### 2a. Update ZIP File Name and Corresponding Directory Name (Optional)

If you kept the ZIP file name `Smart-Tolling.zip`, then skip this step. If you used a different
name, edit the directory name `src/webserver/scenes/Smart-Tolling` as well to make sure that
it matches exactly with the name of the ZIP file. Run:

```bash
./install.sh smart-tolling
```

## 3. Update the Pipeline

Camera IDs and detection regions in `config.json` are calibrated for the sample scene. After
swapping in your own videos and scene, update the following for each pipeline in the
`pipelines` list of `src/dlstreamer-pipeline-server/config.json`. The
[Perception Layer](../how-it-works/perception-layer.md) page describes what each pipeline does.

- The camera ID (`parameters.camera_config.cameraid`), to match the cameras defined in your new scene.
- The detection region (`roi=` of the `gvaattachroi` element in the `pipeline` string), to match your
  video resolution and camera framing.

## 4. Models

When you run `init.sh`, it downloads the model files listed below from the [edge-ai-resources](https://github.com/open-edge-platform/edge-ai-resources)
repository, pinned to a specific fixed commit, and stores them in `src/dlstreamer-pipeline-server/models/`:

- Axle detection
- Vehicle type detection
- Vehicle front/rear detection
- Vehicle color classification
- License plate detection
- License plate OCR

Models that are already present in that folder are not downloaded again.

If your dataset requires different models, we recommend training them to meet your specific
requirements using [Geti™](https://github.com/open-edge-platform/geti) and then integrating
them into the application accordingly.

## Learn More

- [Get Started](../get-started.md)
- [Perception Layer](../how-it-works/perception-layer.md)
- [Deep Learning Streamer Documentation](https://docs.openedgeplatform.intel.com/2026.3/edge-ai-libraries/dlstreamer/index.html)
- [DL Streamer Pipeline Server Documentation](https://docs.openedgeplatform.intel.com/2026.3/edge-ai-libraries/dlstreamer-pipeline-server/index.html)
- [Scenescape Documentation](https://docs.openedgeplatform.intel.com/2026.3/scenescape/index.html)
