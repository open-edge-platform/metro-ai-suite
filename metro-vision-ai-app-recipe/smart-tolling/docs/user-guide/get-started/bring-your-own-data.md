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

- **Input sources**: either videos for the 6 camera views, or live RTSP cameras.
- **A Scenescape scene ZIP** (`.zip`): your own 3D map with cameras and toll-lane
  regions already placed on it.
- The resolution and layout of your cameras, so you can adjust detection regions to match.

## 1. Add Your Videos

Place your video files in `src/dlstreamer-pipeline-server/videos/` using these exact names:

| File name | Camera view |
| :--- | :--- |
| `FrontView_L_30fps.ts` | Front camera, left lane |
| `FrontView_R_30fps.ts` | Front camera, right lane |
| `RearView_L_30fps.ts` | Rear camera, left lane |
| `RearView_R_30fps.ts` | Rear camera, right lane |
| `SideAxle_Lane_1_30fps.ts` | Side profile, lane 1 |
| `SideAxle_Lane_2_30fps.ts` | Side profile, lane 2 |

Videos must be MPEG-TS (`.ts`) files. If you use different file names, a different number of
cameras, or live RTSP streams instead of files, update the matching pipeline's source in
`src/dlstreamer-pipeline-server/config.json`. See
[Perception Layer](../how-it-works/perception-layer.md).

## 2. Add Your Scene

The application needs a Scenescape "scene": a 3D map with cameras and toll-lane regions
calibrated on it, exported as a `.zip` archive. At startup, the `scene-uploader` service
imports every `<scene>/<scene>.zip` found under `src/webserver/scenes/`.

- Build and calibrate your scene using Scenescape's
  [Create a New Scene](https://docs.openedgeplatform.intel.com/dev/scenescape/how-to-guides/build-a-scene/create-new-scene.html)
  and [Integrate Cameras and Sensors](https://docs.openedgeplatform.intel.com/dev/scenescape/how-to-guides/integrate-cameras-and-sensors.html)
  guides.
- Export your scene to `src/webserver/scenes/Smart-Tolling/Smart-Tolling.zip` by following
  [Export the Scene](https://docs.openedgeplatform.intel.com/dev/scenescape/how-to-guides/build-a-scene/create-new-scene.html#exporting-and-importing-the-scene).
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
[Perception Layer](../how-it-works/perception-layer.md):

- The camera ID, to match the cameras defined in your new scene.
- The detection region (`gvaattachroi`), to match your video resolution and camera framing.

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
- [Scenescape Documentation](https://docs.openedgeplatform.intel.com/dev/scenescape/index.html)
