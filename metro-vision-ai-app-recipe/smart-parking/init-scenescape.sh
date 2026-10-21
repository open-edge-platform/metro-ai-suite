#!/bin/bash -e
# SceneScape-specific setup for smart-parking ("ss" mode), called from install.sh

SCRIPT_DIR="$(dirname "$(readlink -f "$0")")"
cd "$SCRIPT_DIR"

if [ ! -f src/secrets/browser.auth ]; then
  echo "Generating SceneScape secrets..."
  # Run as the invoking user so the generated secrets are not root-owned
  docker run --rm -t --user "$(id -u):$(id -g)" \
    -e http_proxy -e https_proxy -e no_proxy \
    -v "$SCRIPT_DIR/src/secrets:/src/secrets" \
    docker.io/library/python:3.12 bash /src/secrets/generate_secrets.sh
else
  echo "SceneScape secrets already exist, skipping generation."
fi

# Self-guarded: generates Node-RED admin credentials or backfills if missing
docker run --rm -t --user "$(id -u):$(id -g)" \
  -e http_proxy -e https_proxy -e no_proxy \
  -v "$SCRIPT_DIR/src/secrets:/src/secrets" \
  docker.io/library/python:3.12 bash /src/secrets/generate_nodered_secret.sh

echo "SceneScape setup complete. Before starting the application, run from the recipe directory:"
echo "  export SUPASS=\$(cat ./smart-parking/src/secrets/supass)"
