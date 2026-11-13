```{eval-rst}
.. meta::
   :description: Troubleshooting guidance for the Smart Corridor Sample Application.
   :keywords: Smart Corridor, troubleshooting, Docker, containers, NPU inference
```

# Troubleshooting

This section provides troubleshooting information for the Smart Corridor Sample
Application. It is divided into the following sub-sections:

- **Common Issues**: General steps for resolving container failures, port conflicts, and
  missing dependencies.
- **Troubleshooting Docker Deployments**: Steps for resolving problems specific to Docker
  deployments.

If you encounter a problem that is not addressed in this section, check the
[GitHub Repository's Issues](https://github.com/open-edge-platform/metro-ai-suite/issues) board. Before
filing a new issue, review the
[contribution guidelines](https://github.com/open-edge-platform/metro-ai-suite/blob/main/CONTRIBUTING.md).

## Troubleshooting Common Issues

### 1. Containers Do Not Start

- **Issue**: The application containers fail to start.
- **Solution**:

  ```bash
  docker compose logs
  ```

  Check the logs for errors and resolve any dependency issues.

### 2. Port Conflicts

- **Issue**: Port conflicts with other running applications.
- **Solution**: Update the ports section in the Docker Compose file.

### 3. Missing Dependencies

- **Issue**: Required software dependencies are not installed.
- **Solution**:

  ```bash
  sudo apt-get install -y <dependency>
  ```

### 4. Camera Stream is Stuck

- **Issue**: Camera streams seem to be stuck when you access the Scenescape UI using a
  localhost URL.
- **Solution**: Access the localhost URL only through RDP or VNC sessions. Accessing it
  through browser extensions from a remote machine is not recommended.

### 5. NPU Inference Failures with Geti-Trained Models

- **Issue**: Errors or failures when running an NPU workload with a model trained in Intel® Geti™
  may be caused by **Non-Maximum Suppression (NMS)** being embedded in the model graph.
  The NPU does not support dynamic shapes, and NMS operations with
  dynamic output shapes are incompatible with NPU execution.
- **Solution**: Follow the [Export and Optimize Geti Model](./export-and-optimize-geti-model.md)
  guide to generate a model with NMS removed from the model graph. DL Streamer will then
  handle NMS.

### 6. Application Fails to Start in Air-Gapped (No Internet) Environments

- **Issue**: When you run the application on a machine without internet access, containers
  may fail to start with errors such as `failed to resolve reference`. Grafana dashboards
  may also show "No data" even though the containers appear healthy.
- **Solution**: While internet access is available, run the following preparation steps
  after `./install.sh smart-corridor`:

  ```bash
  # Pre-install Node-RED InfluxDB plugin into the named volume
  docker compose run --rm --no-deps --entrypoint "npm" node-red install node-red-contrib-influxdb

  # Pre-pull all container images
  docker compose pull
  ```

  After disconnecting from the internet, complete these steps:

  - Export the administrator password as an environment variable:

    ```bash
    export SUPASS=$(cat ./smart-corridor/src/secrets/supass)
    ```

  - Start the application with proxy variables (if there are any) unset:

    ```bash
    unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY no_proxy NO_PROXY
    docker compose up -d
    ```

### 7. Time Synchronization Issues Between Parent and Child Nodes

Synchronize system time using NTP:

1. **Install `systemd-timesyncd`** if it is not already installed:

    ```bash
    sudo apt install systemd-timesyncd
    ```

2. **Check the service status**:

    ```bash
    systemctl status systemd-timesyncd
    ```

3. **Configure an NTP server** (if behind a corporate proxy):

   ```bash
   sudo nano /etc/systemd/timesyncd.conf
   ```

   Add the following configuration:

   ```ini
   [Time]
   NTP=corp.intel.com
   ```

   > [!NOTE]
   > Replace `corp.intel.com` with an NTP server supported by all nodes on your
   > network.

4. **Restart the service**:

    ```bash
    sudo systemctl restart systemd-timesyncd
    ```

5. **Verify the status**:

    ```bash
    systemctl status systemd-timesyncd
    ```

## Troubleshooting Docker Deployments

### 1. Containers Fail to Start

- Check the Docker logs for errors:

  ```bash
  docker compose logs
  ```

### 2. Port Conflicts

- Update the `ports` section in the Compose file to resolve conflicts.

### 3. Reset the Application

- Reset the application to its initial state:

  ```bash
  docker compose down
  docker volume ls | grep metro-vision-ai-app-recipe | awk '{ print $2 }' | xargs docker volume rm
  ```

### 4. Regenerate the Secrets

To regenerate the secrets:

- From the recipe root, remove the existing authentication file:

  ```bash
  rm ./src/secrets/browser.auth
  ```

- Repeat Step 2, **Set up Credentials and Download Assets**, in [Get Started](./get-started.md).

### 5. Cannot Access the Application on a Remote Host

- Configure the firewall to allow incoming requests on port 443:

  ```bash
  sudo ufw allow 443/tcp
  ```

- Stop other services that might be using port 443, such as a Kubernetes load balancer.

### 6. Scene or Web Services Fail to Start

- On the first start, `scene` or `web` might time out while waiting for `pgserver` to
  initialize. Restart the services:

  ```bash
  docker compose up -d scene web
  ```

### 7. Grafana Dashboard Shows No Data When Accessed Remotely

- This issue occurs when the system running the application and the system accessing
  Grafana through a browser have different times. Grafana relies on timestamps to display
  data, so unsynchronized clocks may prevent data from appearing.
- Use Grafana's time range filter to adjust the displayed time range to match the timestamps
  of the data generated by the application. This ensures that the data falls within the
  selected time range and appears in the dashboard.
- This adjustment is useful when the systems are in different time zones or have slight
  clock differences.

### 8. Application UI Shows No Objects Detected in the Scene

- This issue occurs when the scene controller cannot connect to the message broker. Ensure
  that the broker service is running and accessible, and verify that the network
  configuration allows communication between the scene controller and the broker.
- Inspect the scene controller logs:

  ```bash
  docker compose logs scene
  ```

- When the scene controller cannot connect to the broker, the following log lines appear:

  ```text
  Starting scene controller
  Broker broker.scenescape.intel.com online: [Errno 111] Connection refused
  Broker broker.scenescape.intel.com online: [Errno 111] Connection refused
  Broker broker.scenescape.intel.com online: Connecting
  ```

- Restart the scene controller:

  ```bash
  docker compose down scene
  docker compose up -d scene
  ```

- Verify that the container is ready:

  ```text
  Broker broker.scenescape.intel.com online: Connecting
  Broker broker.scenescape.intel.com online: 0
  Took 1 seconds
  Container is ready
  ```

- The application UI will now display detected objects in the scene.

### 9. Access the MQTT Broker Externally

- **Issue**: You want to connect an external MQTT client to the broker to debug or monitor
  topics.
- **Solution**: Expose port 1883 on the broker service by adding a `ports` section in
  `docker-compose.yml`:

  ```yaml
  broker:
    ports:
      - "1883:1883"
  ```

- Restart the broker:

  ```bash
  docker compose up -d --force-recreate broker
  ```

- Connect using an MQTT client with TLS and the CA certificate:

  ```bash
  mosquitto_sub -h <HOST_IP> -p 1883 \
    --cafile ./smart-corridor/src/secrets/certs/scenescape-ca.pem \
    -t '#' -v
  ```

  > [!NOTE]
  > The broker uses TLS (TLSv1.3) but allows anonymous connections; no user name
  > or password is required. Use an MQTT client, not a web browser, because MQTT is a TCP
  > protocol, not HTTP.
