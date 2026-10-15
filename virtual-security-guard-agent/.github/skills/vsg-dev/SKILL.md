---
name: vsg-dev
description: Develop, run, test, build, deploy and debug the Virtual Security Guard Agent (VSG) UI - the React operator console for the Argus agent on Hermes over Intel VSS. Covers the Makefile targets, mock vs live dev servers, the nginx allowlist gateway, Zustand stores, the vsg-* directive protocol, the HITL review and live camera search flow, and reinstalling the Hermes skills. Use when the user says "run the VSG UI", "start Argus UI", "add a feature/page to VSG", "Argus reply not shown", "add a VSS/Hermes route", "change the Argus protocol", "redeploy vsg-ui", or reports a VSG UI bug.
license: Apache-2.0
metadata:
  version: "1.0.0"
  tags: "vsg argus hermes vss react development"
---

<!--
SPDX-FileCopyrightText: (C) 2026 Intel Corporation
SPDX-License-Identifier: Apache-2.0
-->

# VSG Dev

Work on the Virtual Security Guard Agent UI with its real interfaces: the
`Makefile`, `deploy/compose.yaml`, the nginx gateway in `ui/nginx/`, and the
Hermes and VSS APIs behind it. Run commands yourself and relay the output.

Project context and conventions live in
[`../../copilot-instructions.md`](../../copilot-instructions.md); read it
first. Design detail: [`docs/user-guide/design.md`](../../../docs/user-guide/design.md).

## Environment setup (run first)

All paths are relative to the app root
`sample-applications/virtual-security-guard-agent`. Resolve and enter it:

```bash
APP_ROOT="$(git rev-parse --show-toplevel)/sample-applications/virtual-security-guard-agent"
cd "$APP_ROOT" && test -f Makefile && test -d ui/src
```

Install dependencies only when `ui/node_modules` is missing or
`ui/package-lock.json` changed: `make install`.

## 1. Choose how to run it

| Goal | Command | Needs |
|---|---|---|
| Offline UI work with scripted Argus + VSS | `make dev-mock` | nothing |
| Dev server against real Hermes/VSS | `cp ui/.env.example ui/.env.local`, fill it, `make dev` | `ui/.env.local` (gitignored) |
| Production container | `cp deploy/.env.example deploy/.env`, fill it, then `docker compose --env-file deploy/.env -f deploy/compose.yaml up -d --build` | `deploy/.env` (gitignored) |

`make up` starts the prebuilt image only; use the `--build` command above
after code changes. The UI listens on `VSG_UI_PORT` (default `12346`).

Never print, log or commit `HERMES_API_KEY`. nginx (and the Vite proxy in dev)
adds it server-side; the browser never sees it.

## 2. Health check before debugging

```bash
P=${VSG_UI_PORT:-12346}
for u in /healthz /hermes/health /vss/manager/health; do
  printf '%-22s %s\n' "$u" "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:$P$u)"
done
```

All three must return `200`. If `/hermes/health` or `/vss/manager/health`
fails, the upstream is down or `deploy/.env` points at the wrong host; fix
that first (for VSS use the `vss-troubleshoot` skill in
`../video-search-and-summarization/.github/skills/`).

## 3. Change code

Map the request to the owning module before editing:

| Area | Files |
|---|---|
| Chat run, phases, operator turns | `ui/src/stores/investigation.ts`, `investigation.logic.ts` |
| Review grid (confirm-only, six shown, "Show more" up to 20, every grid confirmable all session) | `ui/src/features/agent/ValidationGrid.tsx`, `MatchCard.tsx`, `useSubmitReview.ts`, `stores/hitl.ts` |
| Live camera search (offer, 10 s poll, 4 nearest, Stop) | `ui/src/stores/watch.ts`, `features/agent/LiveWatch.tsx` |
| Route / floorplan | `ui/src/stores/trace.ts`, `stores/floorplan.ts`, `features/map/SpatialMap.tsx` |
| Reports / PDF | `ui/src/features/agent/ReportCard.tsx`, `features/reports/` |
| Live cameras page (VSS `/streams`) | `ui/src/stores/cameras.ts`, `features/cameras/` |
| Hermes or VSS HTTP calls | `ui/src/adapters/{hermes,vss}/` (keep `mock.ts` in sync) |
| Argus protocol | `ui/src/protocol/` - see [references/protocol.md](references/protocol.md) |

Rules that prevent the bugs this app has already hit:

- **Stable selectors.** A Zustand selector must not return a fresh object or
  array (`s.x ?? []`); hoist a module-level constant. Otherwise: React error
  #185 (maximum update depth).
- **No cross-clock comparisons.** VSS and browser clocks differ. Don't filter
  or age VSS timestamps against `Date.now()`; compare VSS values to each other
  or measure change between polls.
- **Ground hits in tool results.** Prefer `groundingFromLatestRun` over the
  model's inline JSON; inline hits are a fallback and are labelled unverified.
- **Operator consent.** Never start a live watch without an operator action.
- **New upstream route** → add it in three places with a strict regex:
  `ui/nginx/templates/default.conf.template`, the Vite proxy in
  `ui/vite.config.ts` (if not already covered), and the adapter + mock.
- **Hermes session titles must be unique**; `createSession` already retries
  with a suffix - keep that.
- SPDX header on every new file.

## 4. Verify

From `ui/`, run the smallest set that covers the change, then all before
handing off:

```bash
npm run format && npm run lint && npx tsc -b --noEmit && npx vitest run && npm run build
```

Live smoke against a running deployment (optional):

```bash
VSG_LIVE_BASE=http://127.0.0.1:12346 npx vitest run src/test/live.smoke.test.ts
```

For visual changes take a headless screenshot (Chromium from Playwright's
cache works) and look at it before claiming success.

## 5. Redeploy

```bash
docker compose --env-file deploy/.env -f deploy/compose.yaml up -d --build
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:${VSG_UI_PORT:-12346}/argus
```

## 6. Protocol or Argus behaviour changes

When you change what Argus is asked to do or a `vsg-*` schema, update together:

1. `ui/src/protocol/directives.ts` (Zod schema) and `instructions.ts` (per-run
   instructions sent with every run).
2. `hermes-skills/virtual-security-guard/SKILL.md` (+ `references/`) and, for
   reports, `hermes-skills/vsg-incident-report/`.
3. `docs/user-guide/design.md`.
4. Reinstall on the **Hermes host** (not this machine unless it is the host):
   `make install-skills HERMES_SKILLS_DIR=~/.hermes/skills/security`, then
   start a new Hermes session. Tell the user if you cannot reach the host.

## 7. Debug "Argus replied but the UI shows nothing / wrong"

1. Read the raw transcript (key from `deploy/.env`, never echo it):
   `GET $HERMES_BASE_URL/api/sessions?limit=3` then
   `GET /api/sessions/<id>/messages`. Check whether the assistant emitted a
   well-formed `vsg-*` block and which tools ran.
2. If the block is valid, feed the exact text to `parseAgentText` in a scratch
   vitest file to confirm it parses; delete the scratch file afterwards.
3. If it parses, the bug is in rendering/state: check `Turns.tsx`
   (`DirectiveView`), `MessageList.tsx` ordering, and store selectors.
4. If it does not, fix the schema leniency or the Argus instructions (step 6).

## Out of scope

- Deploying or fixing VSS, the VSS MCP server, or RTSP streams - use the VSS
  skills in `../video-search-and-summarization/.github/skills/`.
- Hermes server installation or model configuration.
