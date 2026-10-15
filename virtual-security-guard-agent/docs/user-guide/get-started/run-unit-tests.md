<!--
SPDX-FileCopyrightText: (C) 2026 Intel Corporation
SPDX-License-Identifier: Apache-2.0
-->

# Run Unit Tests

The UI is tested with [Vitest](https://vitest.dev/). You need GNU Make and
Node.js 22. From the `virtual-security-guard-agent` application directory:

```bash
make install        # once: npm ci
make check          # lint + type-check + unit tests
make lint           # lint + type-check only
make test           # unit tests only
make format         # format the sources with Prettier
```

## Live Smoke Test

Tests a deployed console end to end. It probes Hermes and VSS through the
proxy, then streams one real Argus search (a few minutes on a local 8B model).
The test deletes the Hermes session it creates.

```bash
cd ui
VSG_LIVE_BASE=http://127.0.0.1:12346 npx vitest run src/test/live.smoke.test.ts
```

Set `VSG_LIVE_PROMPT` to change the search text. Without `VSG_LIVE_BASE` the
test is skipped.
