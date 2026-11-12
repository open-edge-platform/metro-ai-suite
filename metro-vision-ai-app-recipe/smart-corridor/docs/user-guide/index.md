```{eval-rst}
.. meta::
   :description: Use edge AI to track vehicles across intersection cameras and analyze traffic flow.
   :keywords: Smart Corridor, edge AI, traffic monitoring, multi-camera tracking, MQTT
```

# Smart Corridor

<!--hide_directive
<div class="component_card_widget">
  <a class="icon_github" href="https://github.com/open-edge-platform/metro-ai-suite/tree/main/metro-vision-ai-app-recipe/smart-corridor">
     GitHub
  </a>
  <a class="icon_document" href="https://github.com/open-edge-platform/metro-ai-suite/blob/main/metro-vision-ai-app-recipe/smart-corridor/README.md">
     Readme
  </a>
  <a class="icon_download" href="https://github.com/open-edge-platform/metro-ai-suite/blob/main/metro-vision-ai-app-recipe/smart-corridor/docs/user-guide/get-started.md">
     Installation guide
  </a>
</div>
hide_directive-->

The Smart Corridor sample application uses edge AI to improve traffic flow. It combines feeds
from multiple intersection cameras to track vehicles from different angles, analyze their speed
and direction, and understand interactions in real space. The system works with
existing cameras and delivers real-time, coordinated insights for smarter traffic monitoring.

**Example Use Case**

- **Traffic flow monitoring**: Count vehicles and measure dwell time in each lane to detect
  when vehicles stay in their lanes for too long. This identifies stalled cars, accidents, and
  traffic jams.

**Key Benefits**

- **Multi-camera, multi-object tracking**: Tracks objects across multiple camera views.
- **Scene-based analytics**: Define regions of interest that span multiple views on a map
  instead of independently on each camera view. This simplifies business logic, enables more
  flexibility in defining regions, and enables additional sensors such as light detection and
  ranging (LIDAR) and radar to track vehicles and people.
- **Improved urban management**: Object tracking and analytics are available in near real time
  through a Message Queuing Telemetry Transport (MQTT) broker, providing actionable insights
  for traffic monitoring and safety applications.
- **Reduced total cost of ownership (TCO)**: Works with existing cameras and makes it easy to scale
  by adding sensors and cameras. This simplifies business logic development and helps
  future-proof the solution.

## Learn More

- [Scenescape](https://docs.openedgeplatform.intel.com/dev/scenescape/index.html): Intel® scene-based AI software framework.
- [Deep Learning Streamer Pipeline Server](https://docs.openedgeplatform.intel.com/dev/edge-ai-libraries/dlstreamer-pipeline-server/index.html):
  An Intel® microservice based on Python programming language for video ingestion and deep learning
  inference.

<!--hide_directive
:::{toctree}
:hidden:

get-started
troubleshooting
release-notes

:::
hide_directive-->