<!--
SPDX-FileCopyrightText: (C) 2026 Intel Corporation
SPDX-License-Identifier: Apache-2.0
-->

# VSS search playbook

Tactics for `vss_search_video` and friends in this deployment.

## Know the cameras

- Each VSS **tag** is one camera, named `P_Lev_<floor>_<location>_ip_<n>`,
  e.g. `P_Lev_4_Main_Entry_ip_54`.
- "Camera" in the operator's words always means a VSS tag. "Search the X, Y,
  Z cameras" = `vss_search_video` with `tags` = the tags for X, Y and Z.
- Call `vss_list_tags` once per session when you need to map camera or place
  words to tags. Match on the `<location>` part, case-insensitively, and treat `_` as a
  space ("main entry" → `P_Lev_4_Main_Entry_ip_54`).
- If several tags fit ("corridor"), use all of them. If none fit, search all
  cameras and say which place you could not match.
- When the operator scoped cameras in the UI (`vsg-context.tags`), use exactly
  those and nothing else.

## Writing the search

| Situation | Call |
|---|---|
| Operator attached an image | `image=<image_url>`, no `query`. |
| Text only | `query="<visual description>"`: clothing colours, garments, carried items, posture. Drop names, times and places; those go in `tags`/`start`/`end`. |
| Trace after confirmation | `image=<anchor_image_url>`, same scope, `limit=20`. |
| Refine after all rejected | Reword with more specific visual detail, or narrow `tags`. One retry. |

Good queries: "person in a dark blue jacket and grey trousers carrying a black
backpack", "man in a red hoodie walking". Bad: "the thief", "suspicious guy",
"John".

## Time windows

- `start` and `end` must be given together, as ISO-8601 UTC
  (`2026-10-02T13:00:00Z`).
- VSS filters on **ingest time** (when the clip was added to VSS), not on the
  wall-clock time it was recorded. The UI warns the operator about this. If a
  windowed search returns nothing, say so and offer to search without the window.
- Clip file names often contain the recording time
  (`…-20140730-090000-chunk-011.mp4` = recorded 2014-07-30 09:00:00). You may
  mention it, but don't use it to filter.

## Reading results

- Results are best first. `score` is normalised so the top hit is `1.0`.
- `start_s`/`end_s` bound the moment in the clip; `seek_s` is the best frame.
- One clip can return several moments. Keep at most two refs per `video_id`
  unless the operator asked for every appearance.
- Use 0.6 as the default review threshold. If fewer than 3 hits pass it, keep
  the top 3 anyway and say the evidence is weak.
- `unknown_tags` not empty → the tags you sent don't exist. Retry once using
  `available_tags`.

## Failure handling

| Symptom | Do this |
|---|---|
| Tool error / timeout | Say VSS did not answer, send no block, suggest retrying. |
| No hits | Say so; suggest one change (wider window, other cameras, simpler words). No block. |
| Image search unsupported | Say image search is not enabled; offer a text search from the operator's description. |
| No `query_id` in result | Normal today. Send `keep` refs only; the UI reads the hits from the transcript. |

## Never

- Invent ids, URLs, times or scores.
- Download or play clips, extract frames, or use the terminal. The UI does this.
- Call `vss_index_video` or change VSS data unless the operator explicitly asks.
