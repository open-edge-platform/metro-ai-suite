<!--
SPDX-FileCopyrightText: (C) 2026 Intel Corporation
SPDX-License-Identifier: Apache-2.0
-->

# Install the Hermes Skills

Argus is a Hermes agent taught by two skills that ship with VSG. They define
the investigation workflow, the privacy guardrails, and the fenced `vsg-*`
JSON reply format that the console reads.

| Skill | Purpose |
|---|---|
| `virtual-security-guard` | Search → review → trace workflow, VSS tool playbook, reply format, guardrails. |
| `vsg-incident-report` | Turns confirmed sightings into a `vsg-report` draft. |

## Install

Run on the **Hermes host** (GNU Make required: `sudo apt-get install -y
make`), from `sample-applications/virtual-security-guard`:

```bash
make install-skills HERMES_SKILLS_DIR=~/.hermes/skills/security
```

This copies both skill folders into `HERMES_SKILLS_DIR`. Start a new Hermes
session so the skills are loaded.

## Hermes configuration checklist

| Setting | Why |
|---|---|
| API server enabled with `API_SERVER_KEY` | The console starts runs and reads sessions through it. Put the same key in `deploy/.env`. |
| VSS MCP server, for example `http://<vss-host>:8000/mcp` | Gives Argus `vss_search_video`, `vss_watch_search`, `vss_list_tags` and the stream tools. |
| Model endpoint, for example OVMS `http://<vss-host>:8450/v1` | The model Argus reasons with. |
| `terminal` toolset disabled for this agent | The console has no login; keep the agent's tools limited. |

## Update the skills

Reinstall whenever the Argus protocol changes (a new VSG release or a change to
`hermes-skills/`), then start a new Hermes session. The **Settings** page shows
the **Directive protocol** version the console expects (`v1`).
