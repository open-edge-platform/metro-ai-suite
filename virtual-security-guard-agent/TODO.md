<!--
SPDX-FileCopyrightText: (C) 2026 Intel Corporation
SPDX-License-Identifier: Apache-2.0
-->

# VSG QA bug list (2026-10-23)

Found by code review and by probing the running VSG/VSS/Hermes stack. Paths are
relative to this app root; `src/` means `ui/src/`.

**Status (2026-10-23):** fixes applied, unstaged. Verified from `ui/`: tsc clean,
eslint clean, vitest 154 passed / 2 skipped (was 69), Playwright 7/7 (mock
adapters), `vite build` OK, `make build` (image) OK, rendered nginx config
passes `nginx -t`. The shipped-floorplan schema test skips inside the image
build because `deploy/` is outside the `ui/` build context; it runs locally. The running
`vsg-ui` container still has the old image: run `make build up` to pick up the
UI, nginx and healthcheck changes. No Hermes skill reinstall is needed.

Legend: `[x]` fixed · `[~]` partly fixed · `[ ]` open.

## Open — needs a decision or a browser check

- [ ] **CSRF Origin==Host check 403s every write behind a reverse proxy that
  rewrites Host** (TLS terminator/ingress). Not changed: fixing it means trusting
  `X-Forwarded-Host` or adding a configured `VSG_PUBLIC_ORIGIN`, a security
  trade-off for the user to decide. `ui/nginx/templates/default.conf.template`
  (`$vsg_origin_bad`)
- [ ] **Run rate limit (20 r/m per IP) is shared behind NAT/proxy; a 429 shows as
  a raw "Hermes 429" error with no retry.** Not changed (rate limits left as is).
  `ui/nginx/templates/default.conf.template`, `src/adapters/hermes/http.ts`
- [ ] **PDF preview iframe may be blocked by CSP `object-src 'none'` in Chrome.**
  Needs a browser check against the nginx build. If blocked: allow
  `object-src blob:` or drop the inline preview (Download and Open in new tab
  are unaffected). `ui/nginx/vsg/security-headers.conf`,
  `src/features/reports/ReportsPage.tsx:52`
- [~] **PDF non-Latin text.** Markdown is stripped and common symbols are
  transliterated; emoji, CJK and Arabic now print as `?` instead of garbage. Full
  Unicode needs an embedded font (bundle size). `src/features/reports/pdfText.ts`
- [ ] **Empty final reply hides the search results** (Hermes session
  `api_1792771213_bb201721`). Qwen3.6 put its whole answer, including the start
  of the `vsg-matches` fence, in `reasoning`. The reply has `content: ""` and
  `finish_reason: "stop"`. The grid only renders from a `vsg-matches` directive
  in the reply text, so the turn shows only tool chips. The tool result itself
  parses fine (5 hits, query id OK). Options, best first:
  A. UI fallback: if a turn is done with no text but has `turn.search` hits,
     render them with a "raw search results" note.
     `src/features/agent/Turns.tsx`
  B. Server: check the OVMS reasoning parser and chat template for Qwen3.6, or
     turn thinking off for Argus.
  C. Restore and show the finished reasoning when the reply is empty
     (`turnsFromMessages` drops `m.reasoning`).
     `src/stores/investigation.logic.ts:485`
- [ ] **Tool chips unhelpful for meta-tool calls.** Calls go through
  `tool_search`/`tool_call`, so the chips read "tool search" and "tool call",
  not "Searching footage". The expanded preview is the first 500 characters of
  raw content, mostly the `<untrusted_tool_result>` safety notice. Fix: take
  the real name from the `tool_call` arguments and strip the wrapper from the
  preview. `src/features/agent/ToolChip.tsx`,
  `src/stores/investigation.logic.ts:501`
- [ ] **Attachment preview blob URL is never revoked after send.** Intentional
  today (`take()` keeps it as the transcript preview); bounded by photos sent per
  tab. `src/features/agent/useAttachment.ts:57-62`

## High

- [x] **H1 vsg-ui container always unhealthy.** HEALTHCHECK uses
  `wget -Y off` so BusyBox bypasses the Docker client proxy. `ui/Dockerfile`
- [x] **H2 one-line `vsg-status` hid the review grid.** Parser rewritten as a
  scanner: same-line bodies work and the next `vsg-*` fence never closes the
  current block; the instruction example is multi-line. `src/protocol/parser.ts`,
  `src/protocol/instructions.ts:71-74`; tests `parser.test.ts`
- [x] **H3 search prompts misclassified.** `escalat(e|es|ed|ing|ion)`; camera
  management needs the verb next to "camera(s)" with no preposition between;
  "escalator" and "… on camera 3" are searches. `src/stores/investigation.logic.ts:180-196`
- [x] **H4 VSS watch left running after a switch while "Starting".** `clear()`
  unwatches any query not already stopped. `src/stores/watch.ts`
- [x] **H5 tab close/reload left the VSS watch running.** `pagehide` sends a
  keepalive unwatch; the pending query id is kept in sessionStorage and unwatched
  on the next load. `src/stores/watch.ts`, `src/adapters/vss/http.ts`
- [x] **H6 report editor ate spaces and newlines.** Raw text kept locally,
  tidied on blur. `src/features/reports/ReportEditor.tsx`

## Chat, review and sessions

- [x] **History race showed the wrong transcript.** Stale resume responses are
  dropped (load token); History disabled while a session loads.
  `src/stores/investigation.ts`, `src/features/agent/AgentHub.tsx`
- [x] **Browser Back during a run was dropped.** URL sync re-runs when the run
  ends. `src/features/agent/AgentHub.tsx`
- [x] **Confirmations couldn't be withdrawn.** After a review was sent,
  unticking all sends an all-reject review ("Update review (none match)").
  `src/features/agent/ValidationGrid.tsx`
- [x] **Review marked sent though Hermes failed.** Rolled back if the run doesn't
  start. `src/stores/investigation.ts` (`submitReview`)
- [x] **Retry on older turns reordered the transcript.** Retry only on the last,
  non-restored agent turn (UI and store). `src/features/agent/MessageList.tsx`,
  `Turns.tsx`, `src/stores/investigation.ts`
- [x] **Full Hermes output ignored after a stream drop.** `ev.output` wins when
  longer. `src/stores/investigation.logic.ts`
- [x] **Crop & re-search while busy was lost.** Warning toast with a "Search now"
  action. `src/features/agent/ValidationGrid.tsx`
- [x] **Refresh mid-run lost the run.** Active run kept in sessionStorage and
  re-attached on resume if still running. `src/stores/investigation.ts` (`reattach`)
- [x] **History missed older investigations on a shared Hermes.** Pages through
  `offset`/`has_more` (max 5×100) for up to 50 VSG sessions; resume title from
  `GET /api/sessions/{id}`. `src/hooks/queries.ts`, `src/adapters/hermes/*`
- [x] **Stop ignored before the run id existed.** Stop is remembered and applied
  when the id arrives (or the run is never started). `src/stores/investigation.ts`
- [x] **Failed Stop offered Retry while the run went on.** Now an error toast;
  the run keeps streaming and Stop can be pressed again. `src/stores/investigation.ts`
- [x] **Failed photo upload + Enter sent text only.** Send is blocked with an
  error toast. `src/features/agent/AgentHub.tsx`
- [x] **Unclosed `vsg-*` fence hid the rest of the reply.** The block ends at its
  balanced JSON or the next fence; prose after it shows. `src/protocol/parser.ts`
- [x] **Orphan empty session when the first run failed.** The new session is
  deleted; the URL only gets the session once the run starts. `src/stores/investigation.ts`
- [x] **Per-token re-parse per grid.** Parsed directives cached per turn
  (WeakMap). `src/stores/investigation.logic.ts`
- [x] **SSE back-off not abortable.** Abort ends the wait; `interrupted` runs are
  failed, not retried. `src/adapters/hermes/http.ts`

## Live search, clip and crop

- [x] **Double Save crop.** Ref guards in CropTool and ClipPlayerDialog.
- [x] **Esc/close during crop upload still searched.** Late results are dropped
  (attempt counter). The upload itself isn't aborted. `src/features/agent/ClipPlayerDialog.tsx`
- [x] **Crop Enter listener hijacked focused buttons.** Ignored on buttons,
  links and inputs. `src/features/agent/CropTool.tsx`
- [x] **"Search again" reused sighting ids.** Id is `watch:hitKey`; route/report
  dedupe still by footage. `src/stores/liveTimeline.ts`
- [x] **localStorage quota broke polling.** `persistStorage()` never throws
  (toast once); max 200 sightings per session, unconfirmed dropped first.
  `src/lib/storage.ts`, `src/stores/liveTimeline.ts`
- [x] **"Starting" stuck; 404 retried forever.** 404 ends the watch; 3 failed
  checks in a row stop it with an error. `src/stores/watch.ts`
- [x] **Open live clip reloaded when the best hit changed.** Dialog keeps the hit
  it opened with. `src/features/agent/LiveWatch.tsx`
- [x] **Crop on a failed clip said "Too small".** Falls back to the still, or
  says the clip failed to load. `src/features/agent/ClipPlayerDialog.tsx`, `CropTool.tsx`
- [x] **Black/stale frame captured.** `waitForFrame()` before capture.
  `src/lib/crop.ts`
- [x] **Object URL leaks / broken thumbnails.** Crop uses the uploaded preview
  URL; HitThumb re-grabs a revoked frame once. `src/hooks/useThumbnail.ts`,
  `src/components/shared/media.tsx`
- [x] **Session switch silently ended the live search.** "Live search stopped"
  toast. `src/stores/investigation.ts` (`reset`)
- [x] **Two tabs overwrote timelines; bad stored data crashed.** Stored shape
  validated with zod on load; tabs rehydrate on `storage` events.
  `src/stores/liveTimeline.ts`
- [~] **Live hits without a timestamp dropped silently.** Now a console warning
  with the count per watch; no UI note. `src/stores/liveTimeline.ts`
- [x] **Start live search was a silent no-op without a subject.** "Search the
  footage first" toast. `src/stores/investigation.ts` (`startWatch`)
- [x] **No VSS fetch timeout.** 20 s `AbortSignal.timeout`; counts as a failed
  check. `src/adapters/vss/http.ts`

## Cameras, map, reports and settings

- [x] **Route numbers in list/PDF didn't match the map.** Shared
  `stopNumbers()`; off-plan cameras show "–". `src/features/map/route.ts`
- [x] **ReportCard Download broke after removal on Reports.** Detects the removed
  report and rebuilds the PDF. `src/features/agent/ReportCard.tsx`
- [x] **Settings numbers clamped per keystroke.** Clamp on blur/Enter; saved
  values re-clamped on load. `src/features/settings/SettingsPage.tsx`,
  `src/stores/settings.ts`
- [x] **Long subject ran off the PDF page.** Per-line page breaks. `src/features/reports/pdf.ts`
- [x] **Tall floorplan clipped / bad map PNG failed the PDF.** Fit to page width
  and height; failure is noted in the PDF. `pdf.ts`, `useReportGenerator.tsx`
- [x] **Large floorplan vanished after reload.** `persistStorage()`; error toast
  when the plan can't be saved. `src/stores/floorplan.ts`, `FloorplanPage.tsx`
- [x] **Floorplan camera keys not validated.** `/^[A-Za-z0-9_-]{1,128}$/`; both
  default plans pass. `src/features/map/schema.ts`
- [x] **Esc during camera save broke the next dialog.** Saving resets on open,
  stale saves ignored, Esc/Cancel blocked while saving.
  `src/features/cameras/CameraFormDialog.tsx`
- [x] **No error boundary.** Errors render inside the app shell with Reload;
  unknown URLs show "Page not found". `src/routes.tsx`,
  `src/components/layout/RouteError.tsx`
- [x] **Copy failed silently over plain HTTP.** Selects the tag and says press
  Ctrl+C. `src/features/map/FloorplanPage.tsx`
- [x] **Removed camera reappeared for ~10 s.** Stale list reads dropped.
  `src/stores/cameras.ts`
- [x] **Double-click Pause.** Per-camera in-flight guard. `CameraFleetPage.tsx`
- [x] **Picker said every camera in use when the plan failed to load; taken
  preselected camera accepted.** Both fixed. `CameraFormDialog.tsx`
- [x] **Dialog titles changed while closing.** Last value kept.
  `src/features/cameras/useLastDefined.ts`
- [x] **PDF images stretched/dropped; misleading empty-route text.** Aspect kept,
  WebP/GIF/SVG converted to PNG, "No sightings were confirmed."
- [x] **PDF limits.** Full wrapped notes, wrapped camera lines, paginated title;
  the 24-thumbnail cap stays and is stated in the PDF.
- [x] **Floorplan edge cases.** Negative/off-canvas cameras and duplicate zone
  names rejected; no spread `Math.max`. Documented in
  `docs/user-guide/how-to-guides/configure-floorplan.md`.
- [x] **Clear local data skipped live timelines; settings not re-clamped; unknown
  URLs redirected; status tooltip not focusable.** All fixed; Clear uses
  `ConfirmDialog`.
- [x] **React "script tag" console error.** `next-themes` replaced by
  `src/components/layout/theme.ts` (same storage key) and removed from
  `package.json` and `third-party-programs.txt`.

## Deployment and nginx

- [x] **`/vss/manager/frames` sent conflicting Cache-Control.** Upstream header
  hidden. `ui/nginx/templates/default.conf.template`
- [x] **MinIO headers leaked through `/vss/datastore`.** HSTS, `X-Amz-*`,
  `X-Ratelimit-*`, `X-Xss-Protection` hidden. `ui/nginx/templates/vss-proxy.inc.template`

## QA focus for the next round

1. Agent output: one-line `vsg-status`, "escalator" / "show … camera" prompts,
   Retry only on the last turn.
2. Refresh during a run (re-attach) and during a live search (watch stopped).
3. Review changes: untick all after Save, Save while Hermes is down.
4. Keyboard: report editor, settings numbers, Enter in the crop view.
5. PDF: symbols, long text, tall floorplans, empty route; preview in Chrome.
6. Deploy (after `make build up`): container healthy; behind a TLS/reverse proxy.
