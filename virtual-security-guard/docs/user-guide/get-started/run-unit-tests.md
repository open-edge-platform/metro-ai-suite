<!--
SPDX-FileCopyrightText: (C) 2026 Intel Corporation
SPDX-License-Identifier: Apache-2.0
-->

# Run Unit Tests

The UI is tested with [Vitest](https://vitest.dev/). Requires GNU Make and
Node.js 22; run `make install` once first.

## Lint, type-check and test

From `sample-applications/virtual-security-guard`:

```bash
make check          # lint + type-check + unit tests
make lint           # lint + type-check only
make test           # unit tests only
make format         # format the sources with Prettier
```

## Live smoke test

Checks a deployed console end to end: it probes Hermes and VSS through the
proxy and streams one real Argus search, so it creates a Hermes session.

```bash
cd ui
VSG_LIVE_BASE=http://127.0.0.1:12346 npx vitest run src/test/live.smoke.test.ts
```
