# SPDX-FileCopyrightText: (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
FROM docker.io/library/node:26.7.0 AS build

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM docker.io/library/node:26.7.0

USER root

RUN apt-get update \
  && apt-get -y upgrade \
  && apt-get -y autoremove \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

RUN npm install -g npm@latest \
  && tmpdir="$(mktemp -d)" \
  && cd "$tmpdir" \
  && printf '{}\n' > package.json \
  && npm install --no-fund --no-audit --ignore-scripts \
      brace-expansion@5.0.9 ip-address@10.3.1 tar@7.5.21 \
  && npm_pkg_dir="$(npm root -g)/npm/node_modules" \
  && rm -rf "$npm_pkg_dir/brace-expansion" \
  && cp -r node_modules/brace-expansion "$npm_pkg_dir/" \
  && rm -rf "$npm_pkg_dir/ip-address" \
  && cp -r node_modules/ip-address "$npm_pkg_dir/" \
  && rm -rf "$npm_pkg_dir/tar" \
  && cp -r node_modules/tar "$npm_pkg_dir/" \
  && cd / \
  && rm -rf "$tmpdir" \
  && npm install -g --no-fund --no-audit serve \
  && npm cache clean --force \
  && rm -rf /root/.npm

WORKDIR /usr/src/app

ARG USER=intelmicroserviceuser
ARG UID=1999
RUN useradd -ms /bin/bash "$USER" -o -u "$UID" \
  && mkdir -p "/home/$USER" \
  && chown -R "$USER:$USER" "/home/$USER"

COPY --from=build --chown=${USER}:${USER} /usr/src/app/dist ./dist

EXPOSE 3000
USER ${USER}

CMD ["serve", "-s", "dist", "-l", "3000"]
