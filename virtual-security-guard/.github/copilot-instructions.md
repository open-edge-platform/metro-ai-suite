<!--
SPDX-FileCopyrightText: (C) 2026 Intel Corporation
SPDX-License-Identifier: Apache-2.0
-->

# Virtual Security Guard — AI agents

## Canonical Instructions

Use this file as the canonical router for coding agents. Keep tool-specific
files such as `AGENTS.md`, `CLAUDE.md`, and `.cursor/rules/vsg.mdc` as short
pointers to this file.

## What This Repo Is

Virtual Security Guard (VSG) is a React operator console for **Argus**, a
security agent that runs on a **Hermes** agent server. Argus drives Intel
**Video Search and Summarization (VSS)** through the VSS MCP tool server and
the VSS `/manager` REST API. Hermes cannot show video or images, so this UI
renders what Argus finds: match grids for human review, a floorplan route, live
camera matches, and PDF incident reports.

VSG has no backend of its own. A single nginx container serves the static
bundle and reverse-proxies an **allowlist** of Hermes and VSS routes; the Hermes
API key is injected by nginx and never reaches the browser. Deeper design notes
live in [`docs/user-guide/design.md`](../docs/user-guide/design.md).

## Investigation Flow

| Phase | What happens | Where in code |
|---|---|---|
| Search | Operator types a description and/or drops a photo; Argus calls `vss_search_video` and replies with a `vsg-matches` block. | `stores/investigation.ts`, `protocol/instructions.ts` |
| Review (HITL) | 3×2 grid of the top six matches; "Show N more findings" reveals six at a time, up to 20. Operator only confirms; unconfirmed shown matches are sent as false positives in a `vsg-feedback` block. Every grid stays confirmable all session; re-sending replaces that grid's verdicts. | `features/agent/ValidationGrid.tsx`, `useSubmitReview.ts`, `stores/hitl.ts` (`confirmedSightings`) |
| Crop & re-search | From a review clip the operator crops the person out of a frame, saves the crop to VSS as the new subject image, and Argus runs a follow-up image search for that person (a new grid). | `features/agent/ClipPlayerDialog.tsx`, `CropTool.tsx`, `lib/crop.ts`, `stores/investigation.ts` (`setSubject`) |
| Historical route | The session's confirmed sightings (all grids, de-duplicated, in time order) become the route on the floorplan and feed reports. | `stores/trace.ts`, `stores/watch.ts` (`seed`) |
| Live search (optional) | Only after operator consent: a watched VSS query (`vss_watch_search` / `PATCH /search/:id/watch`) polled every 10 s; UI shows the 4 nearest live matches; Stop is always visible. | `stores/watch.ts`, `features/agent/LiveWatch.tsx` |
| Report | Argus gets the time-ordered sightings with movement gaps and replies with a `vsg-report` block; UI renders an editable draft and builds a PDF (sightings in time order plus a Movement section) in the browser. | `features/agent/ReportCard.tsx`, `features/reports/` |

## Architecture at a Glance

```
browser ──► vsg-ui (nginx :12346)
              ├─ /            static React bundle (ui/dist)
              ├─ /hermes/...  ──► Hermes API server (:8642)  + Bearer key from deploy/.env
              └─ /vss/...     ──► VSS nginx gateway (:12345) /manager, /datastore
Hermes (Argus) ──► VSS MCP server (:8000/mcp) and the VSS /manager API
```

- **Hermes runs API**: `POST /v1/runs`, SSE `GET /v1/runs/:id/events`,
  `POST /v1/runs/:id/stop`; sessions under `/api/sessions`.
- **Directive protocol**: Argus answers in fenced `vsg-*` JSON blocks
  (`vsg-matches`, `vsg-track` (legacy), `vsg-report`, `vsg-status`); the UI
  sends `vsg-context` and `vsg-feedback`. Schemas: `ui/src/protocol/directives.ts`.
- **Grounding**: match hits are re-read from the real tool result in the
  Hermes transcript (`protocol/grounding.ts`); the model's inline copy is a
  fallback only.

## Repository Map

| Path | Contents |
|---|---|
| `Makefile` | Dev entrypoint: `install`, `dev`, `dev-mock`, `lint`, `test`, `check`, `build`, `up`, `down`, `logs`, `install-skills`. |
| `deploy/` | `compose.yaml` and `.env.example` (copy to gitignored `deploy/.env`). |
| `ui/` | Vite + React 19 + TypeScript app, `Dockerfile`, nginx config. |
| `ui/nginx/templates/` | Gateway allowlist (`default.conf.template`) and upstream includes. |
| `ui/src/adapters/` | `hermes/` and `vss/` HTTP + mock adapters (`getAdapters()`). |
| `ui/src/protocol/` | Directive schemas, parser, grounding, Argus run instructions. |
| `ui/src/stores/` | Zustand stores: `investigation`, `hitl`, `watch`, `trace`, `cameras`, `floorplan`, `reports`, `settings`. |
| `ui/src/features/` | `agent` (chat, review, live search, report), `cameras`, `map`, `reports`, `settings`. |
| `hermes-skills/` | Skills installed **on the Hermes host**: `virtual-security-guard` (Argus) and `vsg-incident-report`. |
| `docs/user-guide/` | Design and user documentation. |
| `.github/skills/` | Coding-agent skills for working on this repo. |

## Tech Stack

React 19, TypeScript, Vite, Tailwind CSS v4, Radix UI (shadcn-style
components), Zustand, TanStack Query, Zod, Framer Motion, jsPDF, Vitest.
Served by nginx in Docker; configured through `deploy/.env`.

## Conventions

- Run `make` targets from this app root; run `npm` scripts from `ui/`.
- Every new source/config/doc file carries the SPDX header
  (`SPDX-FileCopyrightText: (C) 2026 Intel Corporation` / `Apache-2.0`).
- **Never** commit `deploy/.env`, `ui/.env.local`, or the Hermes API key.
- New Hermes or VSS routes must be added to the nginx allowlist and the Vite
  dev proxy, with strict path regexes.
- Zustand selectors must return stable references (no inline `?? []`); use a
  module-level constant. Unstable selectors cause React error #185.
- VSS and browser clocks can differ: never compare VSS timestamps with
  `Date.now()`; dedupe or compare VSS values with each other.
- A live watch starts only on an explicit operator action.
- When the Argus protocol changes, update `protocol/instructions.ts`,
  `hermes-skills/*/SKILL.md`, and `docs/user-guide/design.md` together, then
  reinstall the Hermes skills.

## Skills

Reusable workflow skills live under [`.github/skills/`](skills/). Use
[`.github/skills/skill-catalog.json`](skills/skill-catalog.json) to pick the
relevant skill, then read that skill's `SKILL.md`.

| User intent | Skill |
|---|---|
| Develop, run, test, build, deploy or debug the VSG UI; change the Argus protocol | `vsg-dev` |

For VSS itself (deploy, streams, search, MCP server), use the VSS skills in
`../video-search-and-summarization/.github/skills/`.

## Skill Loading Rules

- Load only the skill needed for the current request.
- Use a skill's `references/` files only when its `SKILL.md` points to them.
- Prefer the repo's real interfaces: `Makefile`, `deploy/compose.yaml`, the
  nginx gateway, and the Hermes and VSS APIs.
- Run commands yourself when the harness permits it and relay the result.
- Probe `GET /healthz`, `/hermes/health` and `/vss/manager/health` on the UI
  port before debugging app behaviour.

## Path Conventions

All paths in the skill catalog are relative to this app root
(`sample-applications/virtual-security-guard`).
