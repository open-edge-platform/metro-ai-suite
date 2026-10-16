# Get Started with Smart Parking using SceneScape

The Smart Parking application can optionally run with Intel® SceneScape. In this variant, the
DL Streamer Pipeline Server sends vehicle detections to SceneScape, which tracks every vehicle on
a calibrated 2D map of the parking lot and reports which parking slot each vehicle occupies.
The Grafana dashboard shows the live video of each zone together with a per-slot occupancy table
(status, vehicle type, color, entry time and dwell time).

The default Smart Parking application is unchanged. SceneScape is only enabled when the `ss`
option is passed to the installation script.

By following this guide, you will learn how to:

- **Set up the sample application with SceneScape**: Use Docker Compose to deploy the application and the SceneScape services.
- **Run the predefined pipelines**: Execute the pipelines to see SceneScape-based parking slot occupancy in action.
- **Access the application's features and user interfaces**: Explore the SceneScape UI, Grafana dashboard, Node-RED interface, InfluxDB and DL Streamer Pipeline Server.

## Prerequisites

- Verify that your system meets the [minimum requirements](./get-started/system-requirements.md).
- Install Docker: [Installation Guide](https://docs.docker.com/get-docker/).

## Set up and First Use

1. **Clone the Suite**:

   Go to the target directory of your choice and clone the suite.
   If you want to clone a specific release branch, replace `main` with the desired tag.
   To learn more on partial cloning, check the [Repository Cloning guide](https://docs.openedgeplatform.intel.com/dev/OEP-articles/contribution-guide.html#repository-cloning-partial-cloning).

   ```bash
   git clone --filter=blob:none --sparse --branch main https://github.com/open-edge-platform/metro-ai-suite.git
   cd metro-ai-suite
   git sparse-checkout set metro-vision-ai-app-recipe/
   cd metro-vision-ai-app-recipe/
   ```

2. **Setup Application and Download Assets**:
   - Use the installation script with the `ss` option to configure the application with SceneScape,
     download the required models and videos, and generate the SceneScape secrets:

     ```bash
     ./install.sh smart-parking ss
     ```

> [!NOTE]
> For environments requiring a specific host IP address (for example, when deploying across different network interfaces), you can explicitly specify the
> IP address : `./install.sh smart-parking ss <HOST_IP>` (replace `<HOST_IP>` with your target IP address).

> [!NOTE]
> To switch back to the default Smart Parking application, stop the application with `docker compose down`
> and run `./install.sh smart-parking`. This removes the SceneScape settings from the `.env` file.

## Run the Application

1. **Start the Application**:
   - Export the SceneScape admin password as an environment variable:

     ```bash
     export SUPASS=$(cat ./smart-parking/src/secrets/supass)
     ```

   - Download container images with Application microservices and run with Docker Compose:

     ```bash
     docker compose up -d
     ```

     <details>
     <summary>
     Check Status of Microservices
     </summary>
     - The application starts the following microservices.
     - To check if all microservices are in Running state:

       ```bash
       docker ps
       ```

     **Expected Services:**
     - Grafana Dashboard
     - DL Streamer Pipeline Server
     - MQTT Broker
     - Node-RED
     - InfluxDB
     - MediaMTX and coturn (WebRTC streaming)
     - SceneScape services (web server, scene controller, analytics, database and NTP server)

     </details>

2. **Run Predefined Pipelines**:
   - Start video streams to run video inference pipelines. Pass `cpu`, `gpu` or `npu` to select the inference device:

     ```bash
     ./sample_start.sh cpu
     ```

     One pipeline is started for each of the four parking zones. Each pipeline publishes its detections to the
     matching SceneScape camera (`sp_cam_zone1` to `sp_cam_zone4`).

   - To check the status of the pipelines:

     ```bash
     ./sample_status.sh
     ```

     <details>
     <summary>
     Stop pipelines
     </summary>
     - To stop the pipelines without waiting for video streams to finish replay:

       ```bash
       ./sample_stop.sh
       ```

     > [!NOTE]
     > This will stop all the pipelines and the streams. **DO NOT** run this if
     > you want to see smart parking detection.

     </details>

3. **View the Application Output**:
   - Open a browser and go to `https://localhost/grafana` to access the Grafana dashboard.
     - Change the localhost to your host IP if you are accessing it remotely.
   - Log in with the following credentials:
     - **Username**: `admin`
     - **Password**: `admin`
   - Open the **Smart Parking Dashboard (SceneScape)** dashboard under the Dashboards section.
   - **Expected Results**: The dashboard displays the real-time video stream of each zone with AI overlays, and an
     occupancy table with the status, vehicle type, color, entry time and dwell time of every parking slot.
     All slots are shown as `Empty` until a vehicle is detected in them.

## Access the Application and Components

> [!NOTE]
> All services are accessed through the nginx reverse proxy at `https://localhost`.
> Change the localhost to your host IP if you are accessing it remotely.

### **SceneScape UI**

- **URL**: `https://localhost`
- **Log in with credentials**:
  - **Username**: `admin`
  - **Password**: Stored in `supass`. (Check `./smart-parking/src/secrets/supass`)
- The SceneScape UI shows four scenes, `Smart-Parking-Zone1` to `Smart-Parking-Zone4`. Each scene has one
  calibrated camera and five parking slot regions (`Slot1` to `Slot5`). Open a scene to see the tracked
  vehicles on the 2D map of the parking lot.

### **Grafana UI**

- **URL**: `https://localhost/grafana`
- **Log in with credentials**:
  - **Username**: `admin`
  - **Password**: `admin` (You will be prompted to change it on first login.)
- In Grafana UI, the **Smart Parking Dashboard (SceneScape)** dashboard displays the video of each zone and the parking slot occupancy.

### **InfluxDB UI**

- **URL**: `http://localhost:8086`
- **Log in with credentials**:
  - **Username**: Check `./smart-parking/src/secrets/influxdb2/influxdb2-admin-username`
  - **Password**: Check `./smart-parking/src/secrets/influxdb2/influxdb2-admin-password`
- The parking slot occupancy is stored in the `SS-Parking` bucket, in the `parking_spot` measurement.

### **NodeRED UI**

- **URL**: `https://localhost/nodered/`
- The Node-RED flow subscribes to the SceneScape slot (region) events and per-zone vehicle data, and writes
  the occupancy of every slot to InfluxDB.

### **DL Streamer Pipeline Server**

- **REST API**: `https://localhost/api/pipelines/status`
- **WebRTC**: `https://localhost/mediamtx/object_detection_1/`

## **Stop the Application**

- To stop the application microservices, use the following command:

  ```bash
  docker compose down
  ```

## Supporting Resources

- [Get Started](./get-started.md): Run the default Smart Parking application without SceneScape.
- [Troubleshooting](./troubleshooting.md): Find detailed steps to resolve common issues during deployments.
- [DL Streamer Pipeline Server](https://docs.openedgeplatform.intel.com/dev/edge-ai-libraries/dlstreamer-pipeline-server/index.html): Intel microservice based on Python for video ingestion and deep learning inferencing functions.
- [SceneScape](https://docs.openedgeplatform.intel.com/dev/scenescape/index.html): Intel Scene-based AI software framework.
