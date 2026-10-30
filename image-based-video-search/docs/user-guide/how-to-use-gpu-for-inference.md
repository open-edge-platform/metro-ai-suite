# How to use GPU for inference

## Docker deployment

Follow steps 1 and 2 mentioned in [Get Started](./get-started.md#set-up-and-first-use) guide
if not already done.

### Volume mount GPU config

Comment out CPU and NPU volume mount and uncomment the GPU volume mount present in [compose.yml](https://github.com/open-edge-platform/metro-ai-suite/blob/main/image-based-video-search/compose.yml)
file under `volumes` section as shown below:

```sh
    volumes:
      # - "./src/dlstreamer-pipeline-server/configs/filter-pipeline/config.cpu.json:/home/pipeline-server/config.json"
      - "./src/dlstreamer-pipeline-server/configs/filter-pipeline/config.gpu.json:/home/pipeline-server/config.json"
      # - "./src/dlstreamer-pipeline-server/configs/filter-pipeline/config.npu.json:/home/pipeline-server/config.json"
```

### Start and run the application

After the above changes to docker compose file, follow from step 3 till end of the section as mentioned in the
[Get Started](./get-started.md#set-up-and-first-use) guide.
