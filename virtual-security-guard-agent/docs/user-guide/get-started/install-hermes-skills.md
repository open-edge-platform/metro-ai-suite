<!--
SPDX-FileCopyrightText: (C) 2026 Intel Corporation
SPDX-License-Identifier: Apache-2.0
-->

# Install the Hermes Skills

Argus is a Hermes agent defined by a `SOUL.md` and two skills that ship in
`hermes-skills/`. They set Argus's identity, the investigation workflow, the
privacy guardrails, and the fenced `vsg-*` JSON reply format the console reads.

| File | Purpose |
|---|---|
| `SOUL.md` | Argus's identity, voice and boundaries. Installed as `$HERMES_HOME/SOUL.md`, which is **host-wide**: it replaces the identity of every agent on that Hermes host. |
| `virtual-security-guard` | Argus itself: search → validate → trace → report workflow, on-request video summaries, VSS tool playbook, reply format, guardrails. |
| `vsg-incident-report` | Turns confirmed sightings into a `vsg-report` draft. |

## Install

On the **Hermes host**, from the `virtual-security-guard-agent` application
directory:

```bash
make install-skills                                   # SOUL.md to ~/.hermes, skills to ~/.hermes/skills/security
make install-skills HERMES_HOME=/path/to/hermes-home  # custom Hermes home
make install-skills HERMES_SKILLS_DIR=/path/to/skills # custom skills location
make install-skills INSTALL_ARGS=--no-restart         # copy only
make install-skills INSTALL_ARGS=--exclusive          # also move every other skill aside
make install-skills INSTALL_ARGS="--exclusive --no-restart"
```

`make install-skills` runs `hermes-skills/install.sh`. It backs up an existing,
different `SOUL.md` as `SOUL.md.bak.<timestamp>`, replaces the two skill
directories, and runs `hermes gateway restart`. Start a new session in the
console afterwards.

Use `--exclusive` on a Hermes host that serves only Argus. Hermes loads every
`SKILL.md` under `$HERMES_HOME/skills`, including the bundled skills that its
installer adds. `--exclusive` moves all of them, before the install, to
`$HERMES_HOME/skills.removed.<timestamp>`. It does not delete them, and it
leaves dot-directories such as `.hub` in place. To restore a skill, move it
back. After the install, `hermes skills list` must show only the two Argus
skills. Check again after `hermes update`.

## Hermes Configuration

| Setting | Why |
|---|---|
| API server enabled with `API_SERVER_KEY` | The console starts runs and reads sessions through it. Use the same key as `HERMES_API_KEY` in `deploy/.env`. |
| VSS MCP server registered, for example `http://<vss-host>:8000/mcp` | Gives Argus `vss_list_tags`, `vss_search_video`, `vss_watch_search`, the stream tools, and `vss_summarize_video`, `vss_get_video_summary_timeline`, `vss_resolve_video` and `vss_list_videos` for video summaries. |
| Model `Qwen3.8-27B-int4-ov` on OVMS, through the Inference Router at `http://127.0.0.1:8010/v1` | The model Argus reasons with. It must return OpenAI-style `tool_calls`. |
| Only the `skills` toolset and the `vss` MCP tools enabled | The console has no login; keep the agent's tools limited. |
| No skills other than the two Argus skills (`--exclusive`) | Other skills compete with Argus for the model's attention. |

[Set Up Hermes and OVMS](./set-up-hermes.md) covers each setting.

## Update the Skills

Run `make install-skills` again whenever `hermes-skills/` changes.
The **Settings** page shows the **Directive protocol** version the console
expects (`v1`).
