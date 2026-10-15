<!--
SPDX-FileCopyrightText: (C) 2026 Intel Corporation
SPDX-License-Identifier: Apache-2.0
-->

# VSG directive protocol (v1) - developer reference

Source of truth: `ui/src/protocol/directives.ts`. Argus-facing copy:
`hermes-skills/virtual-security-guard/references/directive-protocol.md`.

Blocks are fenced JSON with a `vsg-` language tag. The parser
(`protocol/parser.ts`, `parseAgentText`) splits a reply into text, directive,
pending (still streaming) and invalid segments; `lenientJson` tolerates common
model mistakes (trailing commas, smart quotes).

| Block | Direction | Purpose | Rendered by |
|---|---|---|---|
| `vsg-context` | UI → Argus | Scope (cameras, time window, image URL, live-watch state) prepended to search turns. | - |
| `vsg-matches` | Argus → UI | `keep` refs (`m<N>` = Nth hit of the tool result), optional `vss_query_id`, notes. | `ValidationGrid` |
| `vsg-feedback` | UI → Argus | `confirm` / `reject` refs, labels, optional note. Unconfirmed shown matches are sent as `reject`. A repeat for the same `vss_query_id` replaces that grid's earlier verdicts. | operator bubble |
| `vsg-report` | Argus → UI | Incident report draft (title, preset, summary, timeline, actions, confidence). | `ReportCard` |
| `vsg-status` | Argus → UI | One-line status. | inline text |
| `vsg-track` | Argus → UI | **Legacy** recorded-footage trace; only in old sessions. | `TraceCard` |

## Run lifecycle

1. `investigation.ts` builds the input (`vsg-context` + text, or
   `vsg-feedback`) and per-run `instructions` (`protocol/instructions.ts`).
2. `POST /hermes/v1/runs` → stream `GET /hermes/v1/runs/:id/events` (SSE) →
   text deltas and tool events update the agent turn.
3. After the run, `ground()` reads `/hermes/api/sessions/:id/messages` and
   replaces inline hits with the real `vss_search_video` result
   (`groundingFromLatestRun`), and detects `vss_watch_search` results
   (`watchFromLatestRun`).
4. `afterRun()` refreshes cameras and, for a confirming feedback, saves the
   session's confirmed sightings as the route seed and offers the live search
   (`useWatchStore.offer`; live sightings already confirmed are kept).

## Session sightings

`stores/hitl.ts` keeps verdicts and hits per grid; `confirmedSightings` unions
the confirms of every grid, de-duplicated by `segmentKey` (`video_id@start`)
and sorted by `hitTime`. `investigation.ts` sends them with every run via
`buildInstructions({ sightings: timelineLines(...) })` as numbered lines
(`N. <ISO time> <camera> (ref video_id@start, score) ; moved from X in 3 min
05 s`). Argus uses those refs as `vsg-report.timeline[].ref`; `hitMatchesRef`
matches them to PDF rows. The PDF adds a Movement section from
`movementLegs`. `features/reports/rebuild.ts` rebuilds the same list from the
last `vsg-feedback` per grid.

## Live search

- Started by the operator (offer card button or a chat request). The UI uses
  the original photo/prompt: `POST /vss/manager/search` + `PATCH
  /vss/manager/search/:id/watch` (or adopts Argus's `vss_watch_search`).
- Polls `GET /vss/manager/search/:id` every 10 s; shows the 4 highest-score
  live hits; confirmed ones join the route. Stops on operator Stop, the
  time limit (`watchMinutes`) or no new matches (`watchIdleMinutes`).
