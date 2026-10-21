<!--
SPDX-FileCopyrightText: (C) 2026 Intel Corporation
SPDX-License-Identifier: Apache-2.0
-->

# Known Issues

## Hermes or VSS shows "Unreachable"

Symptoms:

- The sidebar or **Settings** page shows **Hermes** or **VSS** as not
  reachable; searches never start.

Checks:

- Run the health probes on the VSG host:

  ```bash
  for u in /healthz /hermes/health /vss/manager/health; do
    printf '%-22s %s\n' "$u" "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:12346$u)"
  done
  ```

- `502`/`504`: the upstream is down or `HERMES_BASE_URL` / `VSS_BASE_URL` in
  `deploy/.env` is wrong. Fix it and run `make up` to recreate the
  container. Use `make logs` to see the nginx errors.
- `401` on Hermes: `HERMES_API_KEY` does not match the Hermes
  `API_SERVER_KEY`.
- Behind a proxy: add the Hermes and VSS hosts to `no_proxy`.

## Argus replies but no grid is shown

Symptoms:

- Argus answers in text, but no review grid, report or status widget appears.

Details:

- The console only renders fenced `vsg-*` blocks. If the Hermes skills are
  missing or out of date, Argus answers in plain text.

Checks:

- Reinstall the skills on the Hermes host and start a new session. See
  [Install the Hermes Skills](./get-started/install-hermes-skills.md).
- Check that **Settings → Directive protocol** matches the installed skill.

## Argus never searches, or writes the tool call as text

Symptoms:

- Argus replies without running `vss_search_video`, or the reply contains a
  tool call written out as text or JSON.

Details:

- OVMS returns structured `tool_calls` only when the model's tool parser is
  set. See [Set Up Hermes and OVMS](./get-started/set-up-hermes.md#2-check-that-the-model-can-call-tools).

Checks:

- Run the test tool call from that section against the Inference Router.
- Check that `hermes tools` keeps the `vss` MCP tools for the API server, and
  that `mcp_servers.vss` in `~/.hermes/config.yaml` points at the VSS MCP
  server.

## Argus ignores its workflow or uses other skills

Symptoms:

- Replies do not follow the search → review → trace flow, or mention skills
  that are not Argus's.

Details:

- Hermes loads every skill under `~/.hermes/skills`. Its installer adds
  bundled skills, and `hermes update` can add them again.

Checks:

- Run `hermes skills list` on the Hermes host. If it lists anything other
  than `virtual-security-guard` and `vsg-incident-report`, run
  `make install-skills INSTALL_ARGS=--exclusive` and start a new session.

## Grid shows "Couldn't read the search results"

Symptoms:

- An Argus reply shows an error with a **Retry** button instead of matches.

Details:

- The console could not read the Hermes session transcript after the run.
  Click **Retry** once Hermes is reachable. The console never falls back to
  clips the model wrote.

## Route or floorplan shows no camera

Symptoms:

- Sightings are confirmed but nothing is drawn on the floorplan.

Checks:

- The camera's VSS tag must be a camera key on the plan. The Floorplan header
  lists VSS tags that are not on the plan; add them to the file. See
  [Configure the Floorplan](./how-to-guides/configure-floorplan.md).

## Times look shifted

Details:

- The VSS host and the browser can have different clocks or time zones.
  Sightings are ordered by VSS time; the UI never compares them to the
  browser clock. Keep the VSS host clock synchronized (NTP).

## Live search does not find anything

Checks:

- Live search watches only cameras on the **Live cameras** page. Make sure
  the RTSP streams are added and ingesting.
- RTSP hosts must be reachable from the VSS host (add them to `no_proxy`).
- The watch stops after the time limit or quiet period set on **Settings**.

## Reports disappear after reload

Details:

- Generated PDFs are kept in browser memory for the open tab only. Use
  **Reports → Open in Argus** to open a past investigation and generate the
  PDF again from its report draft.

## Floorplan and settings are per browser

Details:

- The uploaded floorplan and the investigation settings are stored in the
  browser. Upload the plan again on another browser, or use
  **Settings → Clear local data** to reset.

## No login

- The console has no authentication. Run it on a trusted network, bind it to
  `127.0.0.1` with `VSG_UI_HOST` if needed, and disable the Hermes `terminal`
  toolset for this agent.

## Port conflicts

If the console is not reachable, check whether port `12346` is in use and set
`VSG_UI_PORT` in `deploy/.env`.
