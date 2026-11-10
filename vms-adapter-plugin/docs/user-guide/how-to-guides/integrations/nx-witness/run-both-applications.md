# Run Both Applications with Nx Witness

Loitering Detection and Live Video Captioning can run at the same time, on the same cameras,
through the same VAP Analytics Integration. This page assumes you have run each one on its
own, as in [Run Loitering Detection](./run-loitering-detection.md) and
[Run Live Video Captioning](./run-live-video-captioning.md).

## Part 1: Avoid container name and port conflicts

The two application stacks use some of the same container names and host ports. In the
Loitering Detection `docker-compose.yml` (`metro-vision-ai-app-recipe`), make these changes:

| Service | Change |
| --- | --- |
| `broker` | Host port from `1883` to `1884` (`"1884:1883"`) |
| `dlstreamer-pipeline-server` | Container name to `dlstreamer-pipeline-server-ld` |
| `coturn` | Container name to `coturn-ld`; host port to `3479` |
| `metrics-manager` | Container name to `metrics-manager-ld` |

## Part 2: Start the applications

1. Start the LVC stack. Its broker uses host port `1883`:

   ```bash
   cd metro-ai-suite/live-video-analysis/live-video-captioning
   docker compose up -d
   ```

2. Start the Loitering Detection stack. Its broker now uses host port `1884`:

   ```bash
   cd metro-ai-suite/metro-vision-ai-app-recipe
   docker compose up -d
   ```

## Part 3: Configure and start VAP

1. In the VAP `.env`, point each app at its own broker:

   ```bash
   # Loitering Detection broker
   MQTT_HOST=host.docker.internal
   MQTT_PORT=1884

   # LVC broker
   MQTT_BROKER_HOST=host.docker.internal
   MQTT_BROKER_PORT=1883
   ```

2. Generate the configuration with both apps:

   ```bash
   cd metro-ai-suite/vms-adapter-plugin
   ./setup.sh --vms nx --apps ld,lvc
   ```

3. If VAP already registered the integration with only one app, register it again, so the
   camera settings include both apps. VAP builds the settings panel only when it registers;
   see [Register the integration again](./reference.md#register-the-integration-again).

4. Start VAP:

   ```bash
   docker compose up -d
   ```

## Part 4: Start both pipelines

1. In the Desktop Client, close any open view of the camera.
2. Right-click the camera, choose **Camera Settings**, open the **Integrations** tab, and
   select **VAP Analytics Integration**.
3. The panel has a **Loitering Detection** group and a **Live Video Captioning** group. Check
   the enable checkbox in both, and click **Apply**, then **OK**.

VAP starts both pipelines within 5 seconds.

## Part 5: See the results

Both pipelines run in parallel, but the Desktop Client shows one kind of result at a time in
a camera view:

- **Object Search** panel (Alt+O): Loitering Detection boxes, such as `vap.pedestrian`.
- **Bookmarks** panel (Ctrl+B): LVC captions and loitering events.

This is a limitation of the Desktop Client, not of VAP.

## Next step

[Reference and Troubleshooting](./reference.md).
