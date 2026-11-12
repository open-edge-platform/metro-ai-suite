<!--hide_directive
```{eval-rst}
.. meta::
   :description: The Metro Smart Tolling Application is an Edge AI solution that fuses multi-camera inputs for vehicle detection and classification, license plate detection, color classification, axle counting, and tariffing.
   :keywords: smart tolling, automated tolling, multi-camera, vehicle classification, license plate detection, axle detection, tariffing, Deep Learning Streamer, Scenescape, Node-RED, Edge AI
```
hide_directive-->

# Smart Tolling Application

<!--hide_directive
::::{container} component_header_row
<div class="component_card_widget">
  <a class="icon_github" href="https://github.com/open-edge-platform/metro-ai-suite/tree/main/metro-vision-ai-app-recipe/smart-tolling">
     GitHub
  </a>
  <a class="icon_document" href="https://github.com/open-edge-platform/metro-ai-suite/blob/main/metro-vision-ai-app-recipe/smart-tolling/README.md">
     Readme
  </a>
</div>
hide_directive-->

> [!NOTE]
> This is a sample application **intended for evaluation and development purposes only**.
> For more information, refer to
> [Intended Use](https://docs.openedgeplatform.intel.com/dev/OEP-articles/notes-on-usage.html#intended-use)

<!--hide_directive :::: hide_directive-->

The **Metro Smart Tolling Application** is a high-precision Edge AI solution
designed to revolutionize automated tolling. By fusing multi-camera inputs
(Front, Rear, and Side profiles), the system delivers accurate vehicle detection
and classification, license plate detection, color classification,
axle counting, and tariffing.

Integrating these use cases across multiple viewpoints helps in understanding how the object
interacts with the real world in 3-D space. All the components used run on a single system
enabling low latency, simplified deployment, and cost efficiency.

## Key Features

**Multi vision**: Scene-based analytics allow insights beyond single sensor views.

- **Vehicle axle detection**:

  Vehicle class is determined based on axle and wheel count. Intended for toll
  classification, as well as revenue calculation and protection.

- **Lift axle detection**:

  The type of axle is determined based on camera feed. Ensures accurate tariffing,
  as lift axles may affect toll classification even when raised.

- **License plate detection**:

  The application identifies vehicles uniquely by their license plates, which are
  read from both front and rear views. The image evidence is included in every
  transaction for simplified auditing.

**Visualization and analytics**: Provides real-time and historical insights for
toll operators.

**Modularity**: Architecture based on modular microservices enables composability
and reconfiguration.

**High-throughput processing**: [Optimized video pipelines](./how-it-works/optimization.md)
for Intel edge devices.

## How It Works

For a high-level overview, see [How It Works](./how-it-works.md). For details, check the layers below.
The system uses the **Metro Edge Architecture** based on three key layers:

- **Perception**: Deep Learning Streamer (DL Streamer) [processes multiple camera feeds](./how-it-works/perception-layer.md).
- **Control**: Scenescape Controller [aggregates metadata](./how-it-works/analytics-pipeline.md).
- **Analytics**: Node-RED [transforms events into traffic insights](./how-it-works/analytics-pipeline.md#node-red-transformation)
  (Traffic Volume, Flow Efficiency, Tariffing).

## Learn More

- [System Requirements](./get-started/system-requirements.md)
- [Get Started](./get-started.md)
- [Troubleshooting](./troubleshooting.md)
- [Release Notes](./release-notes.md)

<!--hide_directive
:::{toctree}
:hidden:

./get-started.md
./how-it-works.md
./troubleshooting.md
Release Notes <./release-notes.md>

:::
hide_directive-->
