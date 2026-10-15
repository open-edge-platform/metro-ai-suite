<!--
SPDX-FileCopyrightText: (C) 2026 Intel Corporation
SPDX-License-Identifier: Apache-2.0
-->

# Install the Hermes Skills

Argus is a Hermes agent defined by two skills that ship in `hermes-skills/`.
They set the investigation workflow, the privacy guardrails, and the fenced
`vsg-*` JSON reply format the console reads.

| Skill | Purpose |
|---|---|
| `virtual-security-guard` | Argus itself: search → validate → trace → report workflow, VSS tool playbook, reply format, guardrails. |
| `vsg-incident-report` | Turns confirmed sightings into a `vsg-report` draft. |

## Install

On the **Hermes host**, from the `virtual-security-guard-agent` application
directory:

```bash
make install-skills                                   # to ~/.hermes/skills/security
make install-skills HERMES_SKILLS_DIR=/path/to/skills # custom location
```

Then start a new Hermes session so the skills load.

## Hermes Configuration

| Setting | Why |
|---|---|
| API server enabled with `API_SERVER_KEY` | The console starts runs and reads sessions through it. Use the same key as `HERMES_API_KEY` in `deploy/.env`. |
| VSS MCP server registered, for example `http://<vss-host>:8000/mcp` | Gives Argus `vss_list_tags`, `vss_search_video`, `vss_watch_search` and the stream tools. |
| A model endpoint, for example OVMS at `http://<vss-host>:8450/v1` | The model Argus reasons with. |
| `terminal` toolset disabled for this agent | The console has no login; keep the agent's tools limited. |

## Update the Skills

Reinstall and start a new Hermes session whenever `hermes-skills/` changes.
The **Settings** page shows the **Directive protocol** version the console
expects (`v1`).
