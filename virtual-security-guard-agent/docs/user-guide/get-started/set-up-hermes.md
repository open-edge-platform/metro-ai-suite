<!--
SPDX-FileCopyrightText: (C) 2026 Intel Corporation
SPDX-License-Identifier: Apache-2.0
-->

# Set Up Hermes and OVMS

Argus runs on a **Hermes** agent server and uses
[`OpenVINO/Qwen3.8-27B-int4-ov`](https://huggingface.co/OpenVINO/Qwen3.8-27B-int4-ov)
on **OpenVINO™ Model Server** (OVMS) for its reasoning. The
[agent-harness-install](https://github.com/open-edge-platform/edge-ai-libraries/tree/main/frameworks/agent-harness-install)
installer sets up both. It starts OVMS and an **Inference Router** in Docker,
installs Hermes, and connects Hermes to the router.

The installer does not configure Hermes for VSG. After it finishes, you also
enable the Hermes API server with an auth key, register the VSS MCP server,
limit the tools, and remove every skill except Argus's. Do all of this on the
**Hermes host**.

```text
VSG console ──► Hermes API server :8642 ──► Inference Router 127.0.0.1:8010/v1 ──► OVMS 127.0.0.1:8000/v3
                  (Argus skills only)    └──► VSS MCP server <vss-host>:8000/mcp
```

## 1. Install Hermes and OVMS

Get the installer:

```bash
git clone --filter=blob:none --sparse --branch main https://github.com/open-edge-platform/edge-ai-libraries.git
cd edge-ai-libraries
git sparse-checkout set frameworks/agent-harness-install
cd frameworks/agent-harness-install
```

Install Hermes and serve the model:

```bash
./install.sh --harness hermes --model OpenVINO/Qwen3.8-27B-int4-ov --model-precision int4
```

- The installer installs Docker, Node.js and Python if they are missing, and
  checks the Intel GPU. Read its
  [Get Started](https://github.com/open-edge-platform/edge-ai-libraries/blob/main/frameworks/agent-harness-install/docs/user-guide/get-started.md)
  guide for all options.
- The model is already in OpenVINO IR format, so OVMS downloads it without
  converting it. The weights are about 15 GB. Make sure the GPU has enough
  memory (for an integrated GPU, system memory) for the weights, the KV cache
  and the VSS models on the same host.
- Behind a proxy, export `HTTP_PROXY`, `HTTPS_PROXY` and `NO_PROXY` first.
  The installer passes them to Docker and to the containers.
- If VSS runs on the same host and publishes port `8000` (the VSS MCP server),
  move OVMS to another port. Hermes connects to the router on `8010`, not to
  OVMS directly:

  ```bash
  HARNESS_OVMS_REST_PORT=8100 ./install.sh --harness hermes --model OpenVINO/Qwen3.8-27B-int4-ov --model-precision int4
  ```

OVMS and the router listen on `127.0.0.1` only and do not check auth. Keep
them that way: only Hermes, on the same host, connects to them.

Check the installation:

```bash
./install.sh status
```

## 2. Check that the model can call tools

Argus only works if the model returns OpenAI-style `tool_calls`. If the graph
does not set the tool and reasoning parsers, OVMS picks them from the model.
Check which parsers it chose:

```bash
docker logs agent-harness-install-ovms 2>&1 | grep -E 'tool_parser|reasoning_parser'
```

Then send a test tool call through the router:

```bash
curl -s http://127.0.0.1:8010/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "Qwen3.8-27B-int4-ov",
    "messages": [{"role": "user", "content": "What is the weather in Paris?"}],
    "tools": [{"type": "function", "function": {
      "name": "get_weather",
      "parameters": {"type": "object", "properties": {"city": {"type": "string"}}, "required": ["city"]}
    }}]
  }' | python3 -m json.tool
```

The reply must contain a `tool_calls` entry for `get_weather`. If it contains
only text with the call written into it, set the parsers that the
[model card](https://huggingface.co/OpenVINO/Qwen3.8-27B-int4-ov) gives for
OVMS. Add `tool_parser` and `reasoning_parser` to the LLM node options in the
model's `graph.pbtxt`, then restart OVMS:

```bash
find ~/.agent-harness-install/models -name graph.pbtxt -path '*Qwen3.8-27B-int4-ov*'
docker restart agent-harness-install-ovms
```

## 3. Connect Hermes to the model

At the end, the installer prints the Hermes model settings. Apply them:

```bash
hermes config set model.provider custom
hermes config set model.base_url http://127.0.0.1:8010/v1
hermes config set model.default Qwen3.8-27B-int4-ov
```

`./install.sh onboard` prints them again.

## 4. Register the VSS MCP server

From the installer directory:

```bash
./install.sh mcp register vss http://<vss-host>:8000/mcp hermes
```

This adds `mcp_servers.vss` to `~/.hermes/config.yaml`. The VSS MCP server
must be the only entry under `mcp_servers`. Remove any other entries.

## 5. Enable the API server and set its auth key

The VSG console connects to Hermes through the Hermes **API server**. The API
server runs inside the Hermes **gateway**, and both are off after the
installer finishes.

Generate a key:

```bash
openssl rand -hex 32
```

Add these lines to `~/.hermes/.env`:

```bash
API_SERVER_ENABLED=true
API_SERVER_KEY=<the generated key>
API_SERVER_HOST=<hermes-host-ip>
API_SERVER_PORT=8642
```

- The VSG container connects to Hermes through the host's IP address. Its own
  `127.0.0.1` is the container itself. So bind the API server to the host
  address that the VSG host can reach. Use `0.0.0.0` only if you also restrict
  port `8642` with a firewall.
- Use the same key as `HERMES_API_KEY` in VSG's `deploy/.env`. The key must be
  8 to 512 characters of `A-Z a-z 0-9 . _ ~ + / = -`. The hex key above meets
  this.
- Keep `~/.hermes/.env` private (`chmod 600 ~/.hermes/.env`). Do not add tokens
  for any messaging platform (Telegram, Discord, Slack and so on). The gateway
  starts every platform that has a token.

Install the gateway as a user service and start it:

```bash
hermes gateway install
hermes gateway start
hermes gateway status
```

To keep the gateway running after you log out, run
`sudo loginctl enable-linger "$USER"`.

Check the API server and the key:

```bash
KEY=<the generated key>
curl -s -o /dev/null -w '%{http_code}\n' http://<hermes-host-ip>:8642/health                    # 200
curl -s -o /dev/null -w '%{http_code}\n' http://<hermes-host-ip>:8642/api/sessions?limit=1      # 401
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $KEY" \
  "http://<hermes-host-ip>:8642/api/sessions?limit=1"                                          # 200
```

## 6. Limit the tools

The console has no login, so Argus must only have the tools it needs. Run
`hermes tools`, select the API server platform, and keep only `skills` and the
`vss` MCP tools. Turn off the other toolsets, for example terminal, file, code
execution, browser and web.

## 7. Install Argus as the only skill

The Hermes installer adds bundled skills to `~/.hermes/skills`. Hermes loads
every skill in that directory, and they compete with Argus for the model's
attention. From the `virtual-security-guard-agent` directory, install Argus and
remove all other skills:

```bash
make install-skills INSTALL_ARGS=--exclusive
```

`--exclusive` does not delete the other skills. It moves them to
`~/.hermes/skills.removed.<timestamp>`, then installs `SOUL.md` and the two
Argus skills and restarts the gateway. See
[Install the Hermes Skills](./install-hermes-skills.md).

Check the result:

```bash
hermes skills list
```

The list must show only `virtual-security-guard` and `vsg-incident-report`.
Run this check again after `hermes update`. If the update installed the
bundled skills again, run `make install-skills INSTALL_ARGS=--exclusive` again.

## Next Step

Continue with [Get Started](../get-started.md#2-create-deployenv). Set
`HERMES_BASE_URL=http://<hermes-host-ip>:8642` and use the key from step 5 as
`HERMES_API_KEY`.

## Remove

From the installer directory:

```bash
./uninstall.sh --harness hermes                    # keeps the downloaded model
./uninstall.sh --harness hermes --delete-models    # also deletes the model
```

This removes Hermes with `~/.hermes`, OVMS and the router. Add
`--keep-agent-data` to keep `~/.hermes`.
