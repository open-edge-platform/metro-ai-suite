<!--
SPDX-FileCopyrightText: (C) 2026 Intel Corporation
SPDX-License-Identifier: Apache-2.0
-->

# Virtual Security Guard

**Virtual Security Guard (VSG)** is an operator console for **Argus**, an AI
security agent that runs on a **Hermes**
agent server. Argus searches recorded and live camera footage through Intel®
**Video Search and Summarization (VSS)**. Hermes cannot show video or images,
so VSG renders what Argus finds: match grids for human review, a floorplan
route, live camera matches, and PDF incident reports.

![Argus investigation in Virtual Security Guard](./_assets/argus-search-results.jpg "Argus investigation")

The key features are:

**Chat-driven investigation**: Describe a person in words, drop a photo, or
both. Argus calls `vss_search_video` and returns ranked sightings.

**Human-in-the-loop review**: A 3×2 grid of the top matches, up to 20 per
search. The operator confirms; anything left unconfirmed is sent back to Argus
as a false positive.

**Crop and re-search**: Pause any clip, crop the person out of a frame, and
Argus searches again for that exact person.

**Route on a floorplan**: Confirmed sightings are ordered by time and drawn as
a route camera-to-camera on an uploadable floorplan.

**Live camera search**: With explicit operator consent, Argus watches live
RTSP cameras for the subject and the UI shows the nearest live matches.

**Incident reports**: Argus drafts a report from confirmed sightings only; the
operator edits it and exports a PDF in the browser.

**Grounded results**: Clips shown in the grid are read from the real VSS tool
result, not from text the model typed.

**Secure by default**: One read-only, non-root nginx container. It serves the
UI and proxies an allowlist of Hermes and VSS routes. The Hermes API key never
reaches the browser.

## Use Cases

**Lost or missing person**: Find where a person was last seen across many
cameras, starting from a photo or a description.

**Incident follow-up**: Reconstruct the route of a subject before and after an
event and hand over a time-ordered PDF report.

**Live watch**: After confirming a subject in recorded footage, watch live
cameras for new sightings for a bounded time.

**Privacy-aware search**: Argus describes clothing and movement only. It never
names people or guesses age, gender or ethnicity.

<!--hide_directive
:::{toctree}
:hidden:

get-started.md
quick-start-guide.md
how-to-guides.md
how-it-works.md
api-reference.md
known-issues.md
Release Notes <release-notes.md>

:::
hide_directive-->
