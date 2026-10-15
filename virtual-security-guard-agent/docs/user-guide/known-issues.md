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

## Matches marked "unverified"

Symptoms:

- Grid cards carry an "unverified" label.

Details:

- The console could not find the VSS tool result in the Hermes transcript and
  fell back to the clips the model wrote inline. Check those clips carefully
  before confirming.

## Route or floorplan shows no camera

Symptoms:

- Sightings are confirmed but nothing is drawn on the floorplan.

Checks:

- The camera's VSS tag must match a camera key (or `camera_id`) on the plan,
  or be mapped with **Map cameras**. See
  [Configure the Floorplan](./how-to-guides/configure-floorplan.md).
- Check that the sighting's score is above **Minimum score (of the top
  match)** on the **Settings** page; it is relative to the best match of the
  same search.

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
  **Reports → Rebuild PDF** to rebuild one from a past investigation.

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
