#!/bin/bash -e

HOST_IP="${1:-$(hostname -I | cut -f1 -d' ')}"

docker run --rm -t \
    -e http_proxy -e https_proxy -e no_proxy \
    -e HOST_IP="$HOST_IP" \
    -v $(pwd)/init.sh:/init.sh \
    -v $(pwd)/src:/src \
    docker.io/library/python:3.12 bash init.sh


sudo chown -R $USER:$USER src/secrets

# If this is a parent deployment (TOTAL_REMOTE_CHILD set in .env), run CA federation
ENV_FILE="../.env"
if [[ -f "$ENV_FILE" ]]; then
    TOTAL_REMOTE_CHILD=$(grep -E "^TOTAL_REMOTE_CHILD=" "$ENV_FILE" | cut -d'=' -f2 | tr -d '"')
    TOTAL_REMOTE_CHILD=${TOTAL_REMOTE_CHILD:--1}

    # ── Always clean up symlinks before any deployment ──────────────────
    # Remove symlinks only — never removes real files
    echo "Cleaning up any existing symlinks..."
    if [[ -L "src/webserver/smart-corridor-ri.tar.bz2" ]]; then
        unlink src/webserver/smart-corridor-ri.tar.bz2
        echo "  Removed symlink: smart-corridor-ri.tar.bz2"
    fi
    if [[ -L "src/dlstreamer-pipeline-server/config.json" ]]; then
        unlink src/dlstreamer-pipeline-server/config.json
        echo "  Removed symlink: config.json"
    fi
    
    if [[ "$TOTAL_REMOTE_CHILD" -gt 0 ]] 2>/dev/null; then
        echo "Parent deployment detected (TOTAL_REMOTE_CHILD=${TOTAL_REMOTE_CHILD})"
        echo "Running CA bundle..."
        bash ./ca-bundle.sh
        echo "Using smart-corridor-parent-ri.tar.bz2"
        ln -sf smart-corridor-parent-ri.tar.bz2 src/webserver/smart-corridor-ri.tar.bz2
        echo "Using config_parent.json"
        ln -sf config_parent.json src/dlstreamer-pipeline-server/config.json
    elif [[ "$TOTAL_REMOTE_CHILD" -eq 0 ]]; then
        echo "Single Node Parent deployment detected(TOTAL_REMOTE_CHILD=${TOTAL_REMOTE_CHILD})"
        echo "No child deployments — skipping CA bundle"
        echo "Using smart-corridor-sn-parent-ri.tar.bz2"
        ln -sf smart-corridor-sn-parent-ri.tar.bz2 src/webserver/smart-corridor-ri.tar.bz2
        echo "Using config_sn_parent.json"
        ln -sf config_sn_parent.json src/dlstreamer-pipeline-server/config.json
    else
        # Child deployment: check REMOTE_CHILD_DEPLOY setting in env file
        REMOTE_CHILD_DEPLOY=$(grep -E "^REMOTE_CHILD_DEPLOY=" "$ENV_FILE" | cut -d'=' -f2 | tr -d '"' || true)

        if [[ -z "$REMOTE_CHILD_DEPLOY" ]]; then
            echo "Error: REMOTE_CHILD_DEPLOY must be specified in $ENV_FILE for child deployment (e.g., REMOTE_CHILD_DEPLOY=1)."
            exit 1
        fi

        CHILD_TAR="smart-corridor-child-${REMOTE_CHILD_DEPLOY}-ri.tar.bz2"
        CHILD_CONFIG="config_child_${REMOTE_CHILD_DEPLOY}.json"

        echo "Child deployment detected (REMOTE_CHILD_DEPLOY=${REMOTE_CHILD_DEPLOY}) — using ${CHILD_TAR}"
        ln -sf "${CHILD_TAR}" src/webserver/smart-corridor-ri.tar.bz2
        echo "Child deployment detected (REMOTE_CHILD_DEPLOY=${REMOTE_CHILD_DEPLOY}) — using ${CHILD_CONFIG}"
        ln -sf "${CHILD_CONFIG}" src/dlstreamer-pipeline-server/config.json
    fi
else
    # No .env — default to child
    echo "Error: .env file not found."
    exit 1
fi

mkdir -p src/nginx/ssl
cd src/nginx/ssl
if [ ! -f server.key ] || [ ! -f server.crt ]; then
    echo "Generate self-signed certificate..."
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 -keyout server.key -out server.crt -subj "/C=US/ST=CA/L=San Francisco/O=Intel/OU=Edge AI/CN=localhost"
    chown -R "$(id -u):$(id -g)" server.key server.crt 2>/dev/null || true
fi
