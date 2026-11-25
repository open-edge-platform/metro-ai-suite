# Troubleshooting

This page provides troubleshooting steps, FAQs, and resources to help you resolve common issues.
If you encounter any problems with the application not addressed here, check the
[GitHub Issues](https://github.com/open-edge-platform/metro-ai-suite/issues) board. Feel free
to file new tickets there (after learning about the guidelines for
[Contributing](https://github.com/open-edge-platform/metro-ai-suite/blob/release-2026.3.0/CONTRIBUTING.md)).

## Troubleshooting Steps

1. **Changing the Host IP Address**

   - If you need to use a specific Host IP address instead of the one
     automatically detected during installation, you can explicitly provide it
     using the following command:

     ```bash
     ./install.sh <application-name> <HOST_IP>
     ```

     Example:

     ```bash
     ./install.sh smart-parking 192.168.1.100
     ```

2. **Containers Not Starting**
   - Check the Docker logs for errors:

     ```bash
     docker ps -a
     docker logs <CONTAINER_ID>
     ```

3. **Failed Service Deployment**

   - If unable to deploy services successfully due to proxy issues, ensure the
     proxy is configured in the `~/.docker/config.json`:

     ```json
     {
       "proxies": {
         "default": {
           "httpProxy": "http://your-proxy:port",
           "httpsProxy": "https://your-proxy:port",
           "noProxy": "localhost,127.0.0.1"
         }
       }
     }
     ```

   - After editing the file, restart docker:

     ```bash
     sudo systemctl daemon-reload
     sudo systemctl restart docker
     ```

4. **Video stream not displaying on Grafana UI**

   - If you do not see the video stream because of a URL issue, ensure that
     `WEBRTC_URL` in Grafana has:

      ```bash
      # When Grafana is opened on https://localhost/grafana
      https://localhost/mediamtx/

      # When Grafana is opened on https://<HOST_IP>/grafana
      https://<HOST_IP>/mediamtx/
      ```
5. **`scene-uploader` fails to due to `import-timeout`**
    
    ```
    Container metro-vision-ai-app-recipe-web-1 Healthy 
    Container metro-vision-ai-app-recipe-scene-uploader-1 Starting 
    Container metro-vision-ai-app-recipe-scene-uploader-1 Started 
    Container metro-vision-ai-app-recipe-scene-uploader-1 Waiting 
    Container metro-vision-ai-app-recipe-web-1 Waiting 
    Container metro-vision-ai-app-recipe-scene-uploader-1 Waiting 
    Container metro-vision-ai-app-recipe-web-1 Waiting 
    Container metro-vision-ai-app-recipe-web-1 Healthy 
    Container metro-vision-ai-app-recipe-web-1 Healthy 
    Container metro-vision-ai-app-recipe-scene-uploader-1 Error service "scene-uploader" didn't complete successfully: exit 1
    Container metro-vision-ai-app-recipe-scene-uploader-1 Error service "scene-uploader" didn't complete successfully: exit 1
    service "scene-uploader" didn't complete successfully: exit 1
    ```

    The `scene-uploader` service imports the scene zip file into the Scene
    Controller at startup. If the import takes longer than the configured timeout,
    the service fails and the stack does not come up. Import time depends on the
    size of your scene zip file, so you might need to increase the timeout.

    1. **Check the import timeout** in the `scene-uploader` section of
      `docker-compose.yml`:

        ```yaml
        scene-uploader:
          command:
            - --restauth
            - /run/secrets/controller.auth
            - --rootcert
            - /run/secrets/certs/scenescape-ca.pem
            - --wait
            - "300"
            - --import-timeout
            - "150"
            - https://web.scenescape.intel.com/api/v1
            - /scenes
        ```

    2. **Increase the `--import-timeout` value** (in seconds) based on the size of
      your scene zip file. For example, change `"150"` to `"300"`.

        > [!NOTE]
        > Larger scene zip files need a higher timeout. Choose a value that suits
        > the scene files you use.

    3. **Restart the stack** to apply the change:

        ```bash
        docker compose down -v
        docker compose --progress plain up -d
        ```

6. **Machine runs out of memory while `scene-uploader` container is getting deployed**
    
    Container `metro-vision-ai-app-recipe-scene-uploader-1` memory consumption spikes above recommended value.
    If OOM or unexpected exit of container `metro-vision-ai-app-recipe-scene-uploader-1` appears then try to increase swap file by 8GB.

7. **Pipeline start fails with `Invalid source URI: path outside allowed resources directory`**

   - DL Streamer Pipeline Server only accepts `file://` sources under
     `/home/pipeline-server/resources`. Use
     `file:///home/pipeline-server/resources/<video-file>` in the pipeline start request
     (the app's `src/dlstreamer-pipeline-server/videos/` folder is mounted there).

8. **Node-RED fails to start without internet (Scenescape mode)**

   - `docker compose down -v` removes the volume that holds the
     `node-red-contrib-influxdb` plugin, and Node-RED downloads it again on the
     next start. Reconnect to the internet and run `docker compose up -d` again,
     or use the offline package, which bundles the plugin.


