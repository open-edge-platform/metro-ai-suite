# Troubleshooting

| Symptom | Probable Cause | Fix |
| :--- | :--- | :--- |
| **No Axle Counts** | Wrong Adapter | Ensure `config.json` points to `sscape_adapter_side_max_tracking.py`. |
| **"Lift Axles" counted as Ground** | Tolerance too high | Adjust `tolerance` parameter in `classify_axles_ground_contact` function. |
| **Grafana Empty** | Node-RED Disconnect | Check `docker logs node-red`. Ensure connection to `broker.scenescape.intel.com` or local broker. |
| **No Video** | GPU Mapping | Verify `/dev/dri` is mapped in the compose file and user has permissions. |
| **Node-RED fails to start offline** | Plugin volume removed by `docker compose down -v` | Node-RED downloads `node-red-contrib-influxdb` on the first start after the volume is removed. Reconnect to the internet and run `docker compose up -d` again. |

## Troubleshooting Common Issues

### 1. `scene-uploader` fails to due to `import-timeout`

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

### 2. Machine runs out of memory while `scene-uploader` container is getting deployed

Container `metro-vision-ai-app-recipe-scene-uploader-1` memory consumption spikes above recommended value.
If OOM or unexpected exit of container `metro-vision-ai-app-recipe-scene-uploader-1` appears then try to increase swap file by 8GB.

## Support Contact

If you run into an unexpected problem or need help with the application, you can
browse existing issues or
[create a new one](https://github.com/open-edge-platform/metro-ai-suite/issues)
in the GitHub issue tracker, or contact <transportation.us@intel.com> directly.
