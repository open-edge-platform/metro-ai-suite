# Server File Download Checklist

Based on the analysis of `server_docs/docker-compose.yml`, download the following files from your server and place them in the corresponding structure.

This assumes the root directory on the server matches the `${SAMPLE_APP}` variable (`smart-tolling`).

## 1. Nginx Configuration

- [ ] `src/nginx/nginx.conf`
- [ ] `src/nginx/smart-tolling-image-server.conf`

## 2. Mosquitto (MQTT)

- [ ] `src/mosquitto/mosquitto-secure.conf`

## 3. Node-RED

- [ ] `src/node-red/flows.json`
- [ ] `src/node-red/flows_cred.json`
- [ ] `src/node-red/settings.js`
- [ ] `src/node-red/install_package.sh`

## 4. Grafana

- [ ] `src/grafana/data/dashboards/Overview.json`
- [ ] `src/grafana/data/dashboards/Vehicle_Events_Axle_Analysis.json`
- [ ] `src/grafana/dashboards.yml`
- [ ] `src/grafana/datasources.yml`

## 5. Pipeline Server (DL Streamer)

**Configuration & Scripts:**

- [ ] `src/dlstreamer-pipeline-server/config.json` (CRITICAL)
- [ ] `src/dlstreamer-pipeline-server/user_scripts/` (Entire Directory)

**Models (If changed from default):**

- [ ] `src/dlstreamer-pipeline-server/models/axle/`
- [ ] `src/dlstreamer-pipeline-server/models/vehicle_type/`
- [ ] `src/dlstreamer-pipeline-server/models/vehicle_front_rear/`
- [ ] `src/dlstreamer-pipeline-server/models/color_int8_latest/`
- [ ] `src/dlstreamer-pipeline-server/models/licenseplate_cropped/`
- [ ] `src/dlstreamer-pipeline-server/models/paddle_ocr_v4/`

## 6. Scenescape Manager (Web/PGServer)

- [ ] `src/webserver/user_access_config.json`
- [ ] `src/webserver/smart-tolling.tar.bz2` (Database dump)

## 7. Scenescape Controller

- [ ] `src/controller/tracker-config.json`

## 8. Secrets & Certificates

> [!NOTE]
> Only download these if you need to replicate the exact security environment. For documentation purposes, just knowing they exist is usually enough, but `supass` might be needed for login.

- [ ] `src/secrets/certs/scenescape-ca.pem`
- [ ] `src/secrets/certs/scenescape-broker.crt`
- [ ] `src/secrets/certs/scenescape-broker.key`
- [ ] `src/secrets/certs/scenescape-web.crt`
- [ ] `src/secrets/certs/scenescape-web.key`
- [ ] `src/secrets/influxdb2/influxdb2-admin-username`
- [ ] `src/secrets/influxdb2/influxdb2-admin-password`
- [ ] `src/secrets/influxdb2/influxdb2-admin-token`
- [ ] `src/secrets/django`
- [ ] `src/secrets/browser.auth`
- [ ] `src/secrets/controller.auth`
- [ ] `src/secrets/supass`
