# SPDX-FileCopyrightText: (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
#
# Virtual Security Guard UI: static SPA served by unprivileged nginx, which
# also proxies Hermes and VSS (see nginx/templates/default.conf.template).
# Build context: this directory (ui/).

FROM node:22.20.0-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.29.8-alpine

LABEL org.opencontainers.image.title="vsg-ui" \
      org.opencontainers.image.description="Virtual Security Guard UI and Hermes/VSS proxy" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.vendor="Intel Corporation"

USER root
# One worker: this is a single-tenant BFF. `auto` (upstream default) would
# spawn one worker per CPU and exhaust the pids limit set in compose.yaml
# (128) on wide hosts, leaving the healthcheck unable to fork. nginx.conf is
# included in the main context, so the override goes here, not in conf.d.
RUN sed -i 's/^worker_processes  auto;/worker_processes  1;/' /etc/nginx/nginx.conf \
    && grep -q '^worker_processes  1;' /etc/nginx/nginx.conf
RUN apk upgrade --no-cache \
    && rm -f /etc/nginx/conf.d/default.conf
COPY --chown=root:root --chmod=0644 nginx/templates/ /etc/nginx/templates/
COPY --chown=root:root --chmod=0644 nginx/vsg/ /etc/nginx/vsg/
COPY --chown=root:root --chmod=0755 nginx/entrypoint/18-vsg-env.envsh /docker-entrypoint.d/18-vsg-env.envsh
COPY --from=build --chown=root:root /app/dist /usr/share/nginx/html
RUN chmod -R a+rX,go-w /usr/share/nginx/html /etc/nginx/templates /etc/nginx/vsg

# nginx-unprivileged: uid 101, listens on 8080, pid and temp files in /tmp.
USER 101
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
