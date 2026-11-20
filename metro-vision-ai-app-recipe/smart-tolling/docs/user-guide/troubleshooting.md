# Troubleshooting

| Symptom | Probable Cause | Fix |
| :--- | :--- | :--- |
| **No Axle Counts** | Wrong Adapter | Ensure `config.json` points to `sscape_adapter_side_max_tracking.py`. |
| **"Lift Axles" counted as Ground** | Tolerance too high | Adjust `tolerance` parameter in `classify_axles_ground_contact` function. |
| **Grafana Empty** | Node-RED Disconnect | Check `docker logs node-red`. Ensure connection to `broker.scenescape.intel.com` or local broker. |
| **No Video** | GPU Mapping | Verify `/dev/dri` is mapped in the compose file and user has permissions. |
| **Node-RED fails to start offline** | Plugin volume removed by `docker compose down -v` | Node-RED downloads `node-red-contrib-influxdb` on the first start after the volume is removed. Reconnect to the internet and run `docker compose up -d` again. |

## Support Contact

If you run into an unexpected problem or need help with the application, you can
browse existing issues or
[create a new one](https://github.com/open-edge-platform/metro-ai-suite/issues)
in the GitHub issue tracker, or contact <transportation.us@intel.com> directly.
