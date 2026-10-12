<!--
SPDX-FileCopyrightText: (C) 2026 Intel Corporation
SPDX-License-Identifier: Apache-2.0
-->

# VSG directive protocol v1

The VSG UI reads fenced code blocks whose info string starts with `vsg-`.
Each block holds **one JSON object**. Blocks carry references only (match refs
and, when available, a VSS query id); the UI gets clip details itself.

The UI parser lives in `ui/src/protocol/directives.ts`. Keep this file in sync
with it.

## Common rules

- Put blocks **after** the prose. At most one block of each type per reply.
- JSON only: double quotes, no comments, no trailing commas.
- Always include `"v":1`.
- A **match ref** is `m<N>`: the 1-based position of a hit in the latest
  `vss_search_video` result (or the hit's `match_id` when the tool provides
  one). `m1` is the best hit.

## How the UI finds the hits

Hermes stores every tool result in the session transcript. After each run the
UI reads the latest `vss_search_video` result from there, so the agent never
has to copy hits. The UI resolves a block's hits in this order:

1. the stored VSS query, when the tool result (or the block) has a
   `query_id` that VSS knows;
2. the `vss_search_video` result in the transcript;
3. hits copied inline into the block (legacy, see below).

Refs in `keep`, `anchor`, `notes` and report timelines may also be a
`video_id` or `<video_id>@<start_s>`; refs that match nothing are ignored and
the grid then shows every hit.
- Unknown block types are ignored. A block that fails validation is shown to
  the operator as raw text with a "couldn't render" note, so check the JSON.

## Agent → UI

### `vsg-matches`: candidates to review

| Field | Type | Required | Notes |
|---|---|---|---|
| `v` | `1` | yes | |
| `keep` | string[] | no | Refs worth reviewing, best first. Empty or missing = show all. |
| `note` | string | no | One line shown above the grid. |
| `notes` | object | no | Per-ref reason, e.g. `{"m2":"same backpack"}`. |
| `vss_query_id` | string | no | Only when the tool result has `query_id`; copy it exactly. |
| `matches` | object[] | no | Legacy inline copy, see below. Don't use. |

```vsg-matches
{"v":1,"keep":["m1","m2","m4"],"note":"Blue jacket near the entry and lobby.","notes":{"m4":"partly occluded"}}
```

### `vsg-track`: route of the confirmed subject

| Field | Type | Required | Notes |
|---|---|---|---|
| `v` | `1` | yes | |
| `anchor` | string or object | no | Confirmed ref (`"m3"`) or `{"video_id":"…","seek_s":12.5}`. |
| `keep` | string[] | no | Refs into the **trace** search result that belong to the route. |
| `note` | string | no | One line. |
| `vss_query_id` | string | no | `query_id` of the trace search, only if the tool gave one. |
| `matches` | object[] | no | Legacy inline copy. Don't use. |

```vsg-track
{"v":1,"anchor":"m3","keep":["m1","m2","m5","m7"],"note":"Seen at 4 cameras."}
```

The UI keeps hits with score ≥ the operator's threshold (default 0.6), drops
rejected clips, orders the rest by time and draws the route on the floorplan.

### `vsg-report`: incident report

Defined by the `vsg-incident-report` skill (`references/report-schema.md`).

### `vsg-status`: optional progress line

```vsg-status
{"v":1,"phase":"trace","message":"Searching the other cameras with the confirmed frame."}
```

`phase` is one of `search`, `validate`, `trace`, `report`, `idle`.

### Legacy inline matches

Older agents copied hits into the block. The UI still accepts it, but only
uses it when the transcript has no `vss_search_video` result, and marks the
grid "unverified". Don't emit it:

```vsg-matches
{"v":1,"matches":[
 {"match_id":"m1","video_id":"b41e…","video_name":"P_Lev_4_Main_Entry_ip_54-20140730-090000-chunk-011.mp4","camera":"P_Lev_4_Main_Entry_ip_54","start_s":120,"end_s":130,"seek_s":124,"score":1.0},
 {"match_id":"m2","video_id":"0c9d…","start_s":45,"end_s":55,"seek_s":48,"score":0.82}
],"note":"Two possible sightings."}
```

Fields per match: `match_id`, `video_id` (required), `video_name`, `camera`
(the camera tag, if known), `start_s`, `end_s`, `seek_s`, `score`, `url`.
Leave out fields you don't have. Never make up a value.

## UI → agent

### `vsg-context`: search scope attached to an operator prompt

```vsg-context
{"v":1,"image_url":"http://10.223.23.199:12345/datastore/video-summary/search-images/3f2a.jpg","tags":["P_Lev_4_Main_Entry_ip_54"],"start":"2026-10-02T13:00:00.000Z","end":"2026-10-02T15:00:00.000Z","limit":16}
```

Pass `image_url` to `vss_search_video` as `image`, and `tags`, `start`, `end`,
`limit` unchanged. Every field is optional.

### `vsg-feedback`: operator verdicts

```vsg-feedback
{"v":1,"confirm":["m2"],"reject":["m1","m4"],"anchor_image_url":"http://10.223.23.199:12345/datastore/video-summary/search-images/9b7e.jpg","text":"He left through the back."}
```

The prose above the block names each ref's clip, e.g.
`Confirmed m2 (P_Lev_4_Main_Entry_ip_54, video <video_id>, 176-184 s)`.
`vss_query_id` is present only when VSS confirmed the reviewed query.

- `confirm` not empty → trace with `anchor_image_url` (a frame grabbed from the
  first confirmed clip). Use `confirm[0]` as the `vsg-track` `anchor`.
- `confirm` empty → refine the search; don't return the rejected clips again.
- `text` is free-form operator guidance. Follow it.
- A later `vsg-feedback` with the same `vss_query_id` replaces the earlier
  verdicts for that grid (the operator updated the review). Confirms from all
  grids together form the session's confirmed sightings, listed in time order
  in the run instructions.

## Reserved

`vsg-tick` is reserved for live tracking. Do not emit it.
