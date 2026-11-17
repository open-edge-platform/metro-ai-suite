<!--
SPDX-FileCopyrightText: (C) 2026 Intel Corporation
SPDX-License-Identifier: Apache-2.0
-->

# Docker Setup Script Reference

[setup_docker.sh](https://github.com/open-edge-platform/metro-ai-suite/blob/main/agentic-smart-community/setup_docker.sh) manages the four-service stack: model serving, video understanding, video-stream analytics, and the Smart Community MCP server. Follow [Get Started](../get-started.md#step-1---start-all-services) for installation prerequisites and initial configuration; this page explains what the script does and which options to use.

## What happens during startup

1. **Load the environment.** Sources `docker/set_env.sh` automatically to set model endpoints, image tags, device-group IDs, proxy exclusions, and runtime directories. Set overrides before running the script. The installation guide selects `TAG=2026.3.0`; the script defaults to `latest` when `TAG` is unset.
2. **Prepare the upstream source.** If missing, shallow-clones only the `multilevel-video-understanding` component from the `edge-ai-libraries` `main` branch into `.external/edge-ai-libraries`. Compose needs these service definitions even when using prebuilt images or stopping services. An existing checkout is reused, not updated.
3. **Prepare application images.** Builds missing `latest` images locally; existing images are reused without rebuilding. Pinned tags use local or published images. Explicit build options rebuild the three application images, not the model-serving image.
4. **Prepare video analytics.** Checks the bundled YOLO11s OpenVINO XML/BIN pair under `PREFILTER_MODEL_DIR` (default `~/models/openvino`). If missing or incomplete, invokes the download/conversion helper. Regenerates the live analytics configuration from its template, backing up a differing previous file.
5. **Start or reuse model serving.** A normal start launches the bundled serving and waits for readiness. `--light` reuses a healthy serving; if the bundled serving is not healthy, it starts it first. To use an external serving, configure its endpoints and model IDs, then use `--light` as described in [Use an existing model serving](../get-started.md#use-an-existing-model-serving).
6. **Resolve model settings and start the application tier.** Checks the configured VLM/LLM model IDs against each endpoint's `/models` response. A mismatched ID stops startup; an unavailable model list produces a warning and uses the configured ID. Creates the MCP configuration if absent, resolves its bundled VLM URL/model placeholders, then starts video understanding, analytics, and the MCP server through Compose.

The MCP container initializes a missing monitor configuration and registers the bundled video-summary tasks. It does not create camera monitors automatically. Continue with [Step 2 - Verify the MCP server](../get-started.md#step-2---verify-the-mcp-server), then connect an agent and register monitors.

> [!NOTE]
> Preparation also runs on the host: analytics configuration rendering requires Python 3 with PyYAML. Automatic YOLO conversion additionally requires Python venv/pip, `wget`, and network access. The script does not install Docker, GPU drivers, or an agent host, and it does not publish local videos as RTSP streams.

## Command options

Run the script from the `agentic-smart-community` directory.

| Option | Effect |
| ------ | ------ |
| No option or `--prod` | Start the full stack, waiting for bundled model serving before starting the application tier. |
| `--light` | Reuse model serving and start the three application services; start the bundled serving first if needed. |
| `--build` | Build the three application images without starting services. |
| `--build-prod` | Build the application images, then start the full stack. |
| `--no-cache` | Disable Docker's layer cache for builds; combine with a build/start option. |
| `--no-build` | Skip the script's image-build step; combine with a start option such as `--light`. |
| `--fetch` | Ensure the upstream source checkout exists, without building or starting services. Does not update an existing checkout. |
| `--light-down` | Stop and remove the three application containers; keep model serving running to avoid reloading the model. |
| `--down` | Stop and remove the stack's containers, networks, and named volumes, including orphan containers. |
| `-h`, `--help` | Show usage information. |

Compose may pull missing application images and fall back to building if a pull fails. `--no-build` skips the script's explicit build step; it does not pass Compose's own `--no-build` flag to startup. For build examples, see [Build the service images from source](../get-started.md#build-the-service-images-from-source).

## Configuration and data to preserve

- **MCP configuration:** Existing concrete values in `$SMART_COMMUNITY_DATA_DIR/config.yaml` are kept. Only the bundled VLM URL/model placeholders are replaced; changing environment variables later does not rewrite already concrete values. Existing monitor configuration is kept.
- **Analytics configuration:** Each startup regenerates `${VIDEOSTREAM_CACHE_HOST}/config.yaml` from `videostream-analytics/config/config.yaml.example`. A differing previous file is saved as `config.yaml.<YYYYMMDD-HHMMSS>.bak`. Keep custom model registrations in the template to retain them across deployments; see [Configure the Prefilter Model](./configure-prefilter-model.md#step-2--register-the-model).
- **Persistent files:** Neither stop option deletes host bind-mounted runtime data, model files, or caches. `--down` does remove Docker named volumes, so it is not equivalent to stopping containers only. See [Data directory](../get-started.md#data-directory) for the runtime layout.

## Model-serving startup failures

If Compose fails while Docker is retrying the bundled serving, the script prints recent logs and waits up to `VLLM_RETRY_TIMEOUT` seconds (default: `3600`). If the serving recovers, startup resumes; if recovery fails, the script reports likely causes and attempts to tear down the failed stack. Set the timeout to `0` to skip this recovery wait. It does not reset GPU drivers or add swap automatically.
