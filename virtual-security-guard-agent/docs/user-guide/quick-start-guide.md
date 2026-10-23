<!--
SPDX-FileCopyrightText: (C) 2026 Intel Corporation
SPDX-License-Identifier: Apache-2.0
-->

# Quick Start Guide

The shortest path to a running console. It assumes VSS and Hermes are
[set up](./get-started/set-up-prerequisite-stack.md), the
[Argus skills are installed](./get-started/set-up-prerequisite-stack.md#5-install-the-argus-skills), and
Docker and GNU Make are available. For the full setup, see
[Get Started](./get-started.md).

## 1. Configure

From the `virtual-security-guard-agent` application directory:

```bash
cp deploy/.env.example deploy/.env
# Set HERMES_BASE_URL, HERMES_API_KEY and VSS_BASE_URL
```

## 2. Start

```bash
make up    # pulls the image from deploy/.env, or builds it if none exists
```

## 3. Search

Open `http://<HOST_IP>:12346/argus` and check that **Hermes** and
**VSS** show **Reachable** in the sidebar footer.

Attach a photo of a person, or type a description such as "man in a yellow
hard hat and hi-vis vest", and press **Enter**. Argus replies with a grid of
potential matches to review.

![First search results](./_assets/argus-search-results.jpg "First search")

Continue with [Investigate a Person](./how-to-guides/investigate-a-person.md).

## 4. Stop

```bash
make down
```
