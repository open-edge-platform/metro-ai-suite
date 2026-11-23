# Get Started

The Smart Intersection Sample Application is a modular sample application designed to help
developers create intelligent intersection monitoring solutions. By leveraging AI and sensor
fusion, this sample application demonstrates how to achieve accurate traffic detection,
congestion management, and real-time alerting.

To get started:

- **Set up the sample application**: use Docker Compose to quickly deploy the application in
  your environment.
- **Run a predefined pipeline**: execute a sample pipeline to see real-time transportation
  monitoring and object detection in action.
- **Access the application's features and user interfaces**: explore the Scenescape
  Web UI, Grafana dashboard, Node-RED interface, and DL Streamer Pipeline Server to monitor,
  analyze and customize workflows.
- **Consider Enabling Security features**: use hardware-based security measures to make your
  application safer.

## Prerequisites

- Verify that your system meets the [minimum requirements](./get-started/system-requirements.md).
- Install Docker: [Installation Guide](https://docs.docker.com/get-docker/).
- Enable running docker without "sudo": [Post Install](https://docs.docker.com/engine/install/linux-postinstall/).
- Install Git: [Installing Git](https://git-scm.com/book/en/v2/Getting-Started-Installing-Git).

## Setup and First Use

1. **Clone the Suite**:

   Go to the target directory of your choice and clone the suite.
   If you want to clone a specific release branch, replace `main` with the desired tag.
   To learn more on partial cloning, check the [Repository Cloning guide](https://docs.openedgeplatform.intel.com/dev/OEP-articles/contribution-guide.html#repository-cloning-partial-cloning).

   ```bash
   git clone --filter=blob:none --sparse --branch main https://github.com/open-edge-platform/metro-ai-suite.git
   cd metro-ai-suite
   git sparse-checkout set metro-vision-ai-app-recipe
   cd metro-vision-ai-app-recipe/
   ```

2. **Setup Application and Download Assets**:
   - Use the installation script to configure the application and download required models:

     ```bash
     ./install.sh smart-intersection
     ```

> [!NOTE]
> For environments requiring a specific host IP address (for example, when deploying across different network interfaces), you can explicitly
> specify the IP address (Replace `<HOST_IP>` with your target IP address.):
> `./install.sh smart-intersection <HOST_IP>`

## Run the Application

### Experimental Vehicle ReID with Tracker

The optional Tracker/ReID overlay replaces the Scene Controller with Tracker,
standalone ReID ingestion, and a persistent VDMS. Analytics applies ReID
decisions to Tracker output. Do not enable the `legacy-scene-controller`
profile with this overlay: running both trackers on the same scene produces
duplicate output and may create conflicting identities.

This example uses the third-party MIT-licensed
[vehicle_vit_clip_reid](https://huggingface.co/occurra/vehicle_vit_clip_reid)
model trained on VeRi-776. Its accuracy on intersection footage and the
default ReID similarity threshold have not been established. It processes
vehicle detections only; pedestrians remain normal tracked detections.
By default, ReID requires a bounding-box area greater than 5,000 pixels for
enrollment and matching, so small or distant vehicles may not be identified.
CPU inference can be slow, especially with several cameras.

**Prerequisites:** A separately provisioned Smart Intersection installation,
including its scene ZIP, videos, detection model, Manager/MQTT credentials,
and nginx certificate; Tracker, ReID, and Analytics images with Tracker
`reid_sighting` and ReID decision support; and the DL Streamer image used by
the recipe. Prepare certificates for VDMS separately from the Manager/MQTT
CA: a CA, a server certificate with DNS SAN `reid.scenescape.intel.com` and
server key, and a client certificate and key signed by that CA. Protect private
keys and make the client key readable by the ReID image's built-in non-root
user (UID `1001` in the `2026.3.0-rc2` image). The broker certificate and key
must also be readable by the recipe's configured `UID` and `GID`.

The recipe's root `install.sh` runs `docker compose down -v`; do not run it
against another active deployment or data you need to keep. This overlay does
not alter the generated top-level Compose file or existing scene data.

From the recipe root, download the pinned model and prepare a separate config
and OpenVINO model. The utility checks the model SHA-256 and refuses to
overwrite existing output files. Set the preparation image to the same
DL Streamer image used by your application:

```bash
export REID_PREPARE_IMAGE='<your-dlstreamer-pipeline-server-image>'
export VEHICLE_REID_CACHE="$HOME/.cache/smart-intersection-vehicle-reid"
mkdir -p "$VEHICLE_REID_CACHE"
if [[ ! -e "$VEHICLE_REID_CACHE/vehicle_vit_clip_reid.onnx" ]]; then
  curl -fL 'https://huggingface.co/occurra/vehicle_vit_clip_reid/resolve/44e911547f3949c621091ef44305a1f8dcbea4e3/vehicle_vit_clip_reid.onnx' \
    -o "$VEHICLE_REID_CACHE/vehicle_vit_clip_reid.onnx"
fi
docker run --rm --network none --user "$(id -u):$(id -g)" \
  --entrypoint python3 \
  -v "$VEHICLE_REID_CACHE:/work" \
  -v "$PWD/smart-intersection/prepare_vehicle_reid.py:/prepare.py:ro" \
  -v "$PWD/smart-intersection/src/dlstreamer-pipeline-server/config.json:/config.json:ro" \
  "$REID_PREPARE_IMAGE" /prepare.py /work/vehicle_vit_clip_reid.onnx /config.json /work/prepared
export VEHICLE_REID_DIR="$VEHICLE_REID_CACHE/prepared"
```

If the model has already been prepared, skip the download and preparation
commands and set `VEHICLE_REID_DIR` to the existing prepared directory.

Set the compatible image names and certificate file paths in your shell,
without putting private keys or passwords in source control. The `SUPASS`
variable and the recipe's normal `.env` settings are also required.

```bash
export SAMPLE_APP=smart-intersection
export TRACKER_IMAGE='<tracker-image-with-reid-sighting>'
export REID_SERVICE_IMAGE='<reid-image-with-tracker-ingest>'
export ANALYTICS_IMAGE='<analytics-image-with-reid-decisions>'
export REID_CA_FILE='<absolute-path-to-vdms-ca>'
export REID_CLIENT_CERT_FILE='<absolute-path-to-client-cert>'
export REID_CLIENT_KEY_FILE='<absolute-path-to-client-key>'
export REID_SERVER_CERT_FILE='<absolute-path-to-vdms-server-cert>'
export REID_SERVER_KEY_FILE='<absolute-path-to-vdms-server-key>'

COMPOSE_PROFILES= docker compose -p smart-intersection-reid -f compose-scenescape.yml \
  -f smart-intersection/compose-tracker-reid-overlay.yml up -d
```

The overlay uses a separate Compose project, unique proxy/metrics container
names, and loopback ports `8088`, `8445`, and `18086` for HTTP, HTTPS, and
InfluxDB respectively. Choose other available ports with
`INTERSECTION_HTTP_PORT`, `INTERSECTION_HTTPS_PORT`, and
`INTERSECTION_INFLUX_PORT`. PostgreSQL and VDMS are not published to the host.
For remote browser access, use an SSH tunnel to port `8445` and a trusted
certificate matching the browser hostname. Do not remove the `reid-data`
volume if enrolled identities must be retained. The ReID gRPC endpoint is not
published to the host; it has no transport TLS and must only be accessed on a
trusted network or through a TLS terminator.

Verify camera messages carry `metadata.reid`, Tracker output carries
`reid_sighting`, and ReID publishes decisions on
`scenescape/data/reid/<scene_id>/vehicle`. These signals establish that the
pipeline is connected, not that matching accuracy has been validated.

1. **Start the Application**:
   - Export admin password as environment variable:

     ```bash
     export SUPASS=$(cat ./smart-intersection/src/secrets/supass)
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
   - Node-RED (for applications without Scenescape)
   - Scenescape services (for Smart Intersection only)

   </details>

2. **View the Application Output**:
   - Open a browser and go to `https://localhost/grafana/` to access the Grafana dashboard.
     - Change the localhost to your host IP if you are accessing it remotely.
   - Log in with the following credentials:
     - **Username**: `admin`
     - **Password**: `admin`
   - Check under the Dashboards section for the application-specific preloaded dashboard.
   - **Expected Results**: The dashboard displays real-time video streams with AI overlays
     and detection metrics.

## Access the Application and Components

### Application UI

Open a browser and go to the following endpoints to access the application. Use `<actual_ip>`
instead of `localhost` for external access:

> [!NOTE]
>
> - All services are accessed through the nginx reverse proxy at `https://localhost` with appropriate paths.
> - For passwords stored in files (e.g., `supass` or `influxdb2-admin-token`), refer to the respective secret files in your deployment under ./src/secrets.
> - Since the application uses HTTPS with self-signed certificates, your browser may display a certificate warning. For the best experience, use **Google Chrome** and accept the certificate.
> - Scenescape supports uploading GLB 3D base map files. The upload limit is configurable via `NGINX_CLIENT_MAX_BODY_SIZE` in the `.env` file.

- **URL**: [https://localhost](https://localhost)
- **Log in with credentials**:
  - **Username**: `admin`
  - **Password**: Stored in `supass`. (Check `./smart-intersection/src/secrets/supass`)

> [!NOTE]
>
> - After starting the application, wait approximately 1 minute for the MQTT broker to initialize. You can confirm it is ready when green arrows appear for MQTT in the application interface. Since the application uses HTTPS, your browser may display a self-signed certificate warning. For the best experience, use **Google Chrome**.

### Grafana UI

- **URL**: [https://localhost/grafana/](https://localhost/grafana/)
- **Log in with credentials**:
  - **Username**: `admin`
  - **Password**: `admin` (You will be prompted to change it on first login.)

### InfluxDB UI

- **URL**: [http://localhost:8086](http://localhost:8086)
- **Log in with credentials**:
  - **Username**: `<your_influx_username>` (Check `./smart-intersection/src/secrets/influxdb2/influxdb2-admin-username`)
  - **Password**: `<your_influx_password>` (Check `./smart-intersection/src/secrets/influxdb2/influxdb2-admin-password`).

### NodeRED UI

- **URL**: [https://localhost/nodered/](https://localhost/nodered/)
- **Log in with credentials**:
  - **Username**: `<your_nodered_username>` (Check `./smart-intersection/src/secrets/nodered/nodered-admin-username`)
  - **Password**: `<your_nodered_password>` (Check `./smart-intersection/src/secrets/nodered/nodered-admin-password`).

### DL Streamer Pipeline Server

- **REST API**: [https://localhost/api/pipelines/status](https://localhost/api/pipelines/status)
  - **Check Pipeline Status**:

    ```bash
    curl -k https://localhost/api/pipelines/status
    ```

## Verify the Application

- **Fused object tracks**: in Scene Management UI, click on the Intersection-Demo card to
  navigate to the Scene. On the Scene page, you will see fused tracks moving on the map. You
  will also see greyed out frames from each camera. Toggle the "Live View" button to see the
  incoming camera frames. The object detections in the camera feeds will correlate to the
  tracks on the map.

  ![Intersection Scene Homepage](./_assets/scenescape.png "intersection scene homepage")

- **Grafana Dashboard**: In Grafana UI, observe aggregated analytics of different regions of
  interests in the grafana dashboard. After navigating to Grafana home page, click on
  "Dashboards" and click on item "Anthem-ITS-Data".

  ![Intersection Grafana Dashboard](./_assets/grafana.png "intersection grafana dashboard")

## **Stop the Application**

- To stop the application microservices, use the following command:

    ```bash
    docker compose down
    ```

## Deploy with Trusted Compute

To deploy the Smart Intersection application with Intel Trusted Compute for hardware-isolated workloads, refer to the [Deploy with Trusted Compute](./deploy-with-trusted-compute.md) guide.

## Security Enablement

With AI systems handling sensitive city data and making autonomous decisions, robust security
is essential. Intel platforms provide built-in security features to protect data, infrastructure,
and AI processing. See the [Security Enablement Guide](https://docs.openedgeplatform.intel.com/dev/OEP-articles/application-security.html)
that uses the example of Smart Intersection to show how to secure Open Edge Platform
applications.

## Learn More

- [Security Enablement Guide](https://docs.openedgeplatform.intel.com/dev/OEP-articles/application-security.html)
- [Troubleshooting](./troubleshooting.md): Find detailed steps to resolve common issues during deployments.
- [DL Streamer Pipeline Server](https://docs.openedgeplatform.intel.com/dev/edge-ai-libraries/dlstreamer-pipeline-server/index.html): Intel microservice based on Python for video ingestion and deep learning inferencing functions.
- [Scenescape](https://docs.openedgeplatform.intel.com/dev/scenescape/index.html): Intel Scene-based AI software framework.

<!--hide_directive
:::{toctree}
:hidden:

get-started/system-requirements.md
deploy-with-trusted-compute.md

:::
hide_directive-->
