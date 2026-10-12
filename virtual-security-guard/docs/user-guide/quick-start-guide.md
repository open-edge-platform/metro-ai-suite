<!--
SPDX-FileCopyrightText: (C) 2026 Intel Corporation
SPDX-License-Identifier: Apache-2.0
-->

# Quick Start Guide

Use this guide to run the console with the defaults, assuming VSS and Hermes
are already running and the Argus skills are installed. For the full setup,
see [Get Started](./get-started.md).

## 1. Configure

```bash
cd sample-applications/virtual-security-guard
cp deploy/.env.example deploy/.env
# Edit HERMES_BASE_URL, HERMES_API_KEY and VSS_BASE_URL
```

## 2. Start

Requires Docker and GNU Make (`sudo apt-get install -y make`).

```bash
make build
make up
```

## 3. Open the console

```text
http://<HOST_IP>:12346/argus
```

Check that **Hermes agent** and **VSS** show **Reachable** at the bottom of
the sidebar.

## 4. Run a first search

Drop a photo of a person into the message box (or type a description such as
"man in a yellow hard hat and hi-vis vest") and press **Enter**. Argus replies
with a grid of potential matches to review.

![First search results](./_assets/argus-search-results.jpg "First search")

Continue with [Investigate a Person](./how-to-guides/investigate-a-person.md).

## 5. Stop

```bash
make down
```
