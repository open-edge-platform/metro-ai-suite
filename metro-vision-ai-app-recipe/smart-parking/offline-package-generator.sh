#!/bin/bash

#################
# Script to generate an offline package for Metro Vision AI applications.
# This package can be copied to another device or DDIL environment.
#
# Usage: ./offline-package-generator.sh [ss] [HOST_IP]
#   If 'ss' is passed, generates the package for SceneScape mode.
#   Otherwise, generates the package for default mode (without SceneScape).
#   HOST_IP: Target host IP (default: 127.0.0.1)
#
# Examples:
#   ./offline-package-generator.sh
#   ./offline-package-generator.sh ss
#   ./offline-package-generator.sh ss 192.168.1.100
#
#################

set -e  # Exit on any error

MODE="def"
HOST_IP="127.0.0.1"

# Parse arguments: 'ss' for SceneScape mode, optional host IP
for arg in "$@"; do
  case "$arg" in
    ss)
      MODE="ss"
      ;;
    *)
      if [[ "$arg" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        HOST_IP="$arg"
      else
        echo "Warning: Unknown argument '$arg' ignored."
      fi
      ;;
  esac
done

echo "Starting offline package generation for '${MODE}' mode (HOST_IP=${HOST_IP})..."

# Copy Docker compose file and .env file and update it
echo "Copying Docker compose and .env files..."
cp ../.env ./
if [ "$MODE" = "ss" ]; then
  cp ../compose-scenescape.yml ./docker-compose.yml
else
  cp ../compose-without-scenescape.yml ./docker-compose.yml
fi

# Update .env file to set SAMPLE_APP=smart-parking and HOST_IP
echo "Updating .env file..."
sed -i 's/^SAMPLE_APP=.*/SAMPLE_APP=smart-parking/' .env
sed -i "s/^HOST_IP=.*/HOST_IP=${HOST_IP}/" .env

# Update docker-compose.yml file
# Remove "${SAMPLE_APP}/" and "./${SAMPLE_APP}/" from all paths in docker-compose.yml
echo "Updating docker-compose.yml file..."
sed -i -e 's#\./\${SAMPLE_APP}/#\./#g' -e 's#\${SAMPLE_APP}/##g' docker-compose.yml
sed -i "s/\${DLSTREAMER_PIPELINE_SERVER_IMAGE}/$(grep "DLSTREAMER_PIPELINE_SERVER_IMAGE" .env | cut -d'=' -f2 | sed 's/\//\\\//g')/g" docker-compose.yml

# Run install.sh to download all required models and videos and link configurations
echo "Running install.sh to download models, videos, and link configuration files..."
./install.sh "$HOST_IP" "$MODE"

# install.sh writes the mode-specific settings (SS_*, COMPOSE_PROFILES) to ../.env,
# so refresh the package copy taken earlier, otherwise ss mode ships without them
echo "Refreshing .env with mode-specific settings..."
cp ../.env ./.env
sed -i 's/^SAMPLE_APP=.*/SAMPLE_APP=smart-parking/' .env
sed -i "s/^HOST_IP=.*/HOST_IP=${HOST_IP}/" .env

# Run docker compose to pull all the images and download the grafana plugins
mkdir -p ./src/grafana/plugins
chown -R "$(id -u):$(id -g)" ./src/grafana/plugins 2>/dev/null || true
mkdir -p ./src/node-red/node-modules
chown -R "$(id -u):$(id -g)" ./src/node-red/node-modules 2>/dev/null || true

echo "Pulling Docker images and starting services to fetch runtime assets..."
if [ "$MODE" = "ss" ]; then
  # Ensure SceneScape admin password is set for compose validation
  export SUPASS="${SUPASS:-$(cat ./src/secrets/supass 2>/dev/null || echo 'admin')}"
  docker compose --profile "*" up -d
else
  docker compose up -d
fi

echo "Waiting for services to be healthy..."
sleep 60

docker cp $(docker ps -q --filter "name=grafana"):/var/lib/grafana/plugins ./src/grafana/plugins
docker cp $(docker ps -q --filter "name=node-red"):/usr/src/node-red/node_modules/. ./src/node-red/node-modules/

if [ "$MODE" = "ss" ]; then
  docker compose --profile "*" down -v
else
  docker compose down -v
fi

if [ "$MODE" = "ss" ]; then
  # SceneScape mode uses Grafana 11.6+ provisioning and bash /data/install_package.sh in entrypoint
  # Node-RED here only mounts individual files, so the saved modules need their own mount
  sed -i '/install_package\.sh:\/data\/install_package\.sh/a\      - ./src/node-red/node-modules:/data/node-modules:ro' docker-compose.yml
  sed -i 's#bash /data/install_package.sh && #cp -r /data/node-modules/* /usr/src/node-red/node_modules/ 2>/dev/null || true \&\& #' docker-compose.yml
  # Without internet the WebRTC sender stalls resolving the default public STUN server; fail fast instead
  sed -i '/^  dlstreamer-pipeline-server:$/a\    extra_hosts:\n      - "stun.l.google.com:127.0.0.1"' docker-compose.yml
else
  # Default mode uses grafana-mqtt-datasource plugin and /data/install_package.sh in entrypoint
  sed -i '/datasources\.yml.*datasources\.yml/a\      - "./src/grafana/plugins:/var/lib/grafana/plugins"' docker-compose.yml
  sed -i '/GF_INSTALL_PLUGINS=grafana-mqtt-datasource/d' docker-compose.yml
  sed -i 's#/data/install_package.sh#cp -r /data/node-modules/* /usr/src/node-red/node_modules/#' docker-compose.yml
  sed -i '/container_name: dlstreamer-pipeline-server/a\    extra_hosts:\n      - "stun.l.google.com:127.0.0.1"' docker-compose.yml
fi

# Create directory offline-package and copy all the files into it
echo "Creating offline-package directory and copying files..."
mkdir -p offline-package

tar --exclude='./offline-package' \
  --exclude='./src/secrets/ca' --exclude='./src/secrets/certs' --exclude='./src/secrets/django' \
  --exclude='./src/secrets/pgserver' --exclude='./src/secrets/influxdb2' --exclude='./src/secrets/nodered' \
  --exclude='./src/secrets/*.auth' --exclude='./src/secrets/supass' \
  -cf - . | (cd offline-package && tar -xf -)

# In the package the .env lives next to the scripts, not in the parent directory
sed -i 's#/\.\./\.env"#/.env"#' offline-package/sample_start.sh
grep -q 'ENV_FILE=.*/\.env"' offline-package/sample_start.sh && ! grep -q '/\.\./\.env' offline-package/sample_start.sh \
  || { echo "Error: failed to point sample_start.sh at the packaged .env"; exit 1; }

# Create a new directory inside it called docker-images and save all the docker images available in docker compose .yml file
echo "Creating docker-images directory and saving Docker images..."
mkdir -p offline-package/docker-images

# Extract images from docker-compose.yml and save them
if [ "$MODE" = "ss" ]; then
  COMPOSE_IMG_CMD="docker compose --profile \"*\" config"
else
  COMPOSE_IMG_CMD="docker compose config"
fi

eval "$COMPOSE_IMG_CMD" | grep -E "^\s+image:" | sed 's/.*image: //' | sort -u | while read image; do
  echo "Saving Docker image: $image"
  filename=$(echo "$image" | sed 's/[\/:]/-/g')
  docker pull "$image"
  docker save "$image" | gzip > "offline-package/docker-images/${filename}.tar.gz"
  echo "Saved: ${filename}.tar.gz"
done

# Create load-images.sh script in offline-package directory
echo "Creating load-images.sh script..."
cat > offline-package/load-images.sh << 'EOF'
#!/bin/bash

#################
# Advanced script to load Docker images from the offline package
# This script loads all Docker images from the docker-images directory with progress tracking
#
# Usage: ./load-docker-images.sh
# Example: ./load-docker-images.sh
#
#################

set -e  # Exit on any error

echo "Starting offline package generation..."

# Check if Docker is available and running
echo "Checking Docker availability..."
if ! command -v docker &> /dev/null; then
    echo "Error: Docker is not installed or not in PATH!"
    echo "Please install Docker and try again."
    exit 1
fi

if ! docker info &> /dev/null; then
    echo "Error: Docker daemon is not running!"
    echo "Please start Docker daemon and try again."
    exit 1
fi

echo "✓ Docker is available and running"

# Check if docker compose is available
if ! docker compose version &> /dev/null; then
    echo "Error: Docker Compose is not available!"
    echo "Please install Docker Compose and try again."
    exit 1
fi

echo "✓ Docker Compose is available"

echo "Starting Docker images loading..."

# Check if docker-images directory exists
if [ ! -d "docker-images" ]; then
    echo "Error: docker-images directory not found!"
    echo "Please make sure you're running this script from the offline-package directory."
    exit 1
fi

# Count total files
total_files=$(find docker-images -name "*.tar.gz" | wc -l)
if [ "$total_files" -eq 0 ]; then
    echo "Error: No .tar.gz files found in docker-images directory!"
    exit 1
fi

echo "Found $total_files Docker image files to load..."

# Load all Docker images from docker-images directory
current_file=0
failed_loads=0

for image_file in docker-images/*.tar.gz; do
    if [ -f "$image_file" ]; then
        current_file=$((current_file + 1))
        echo "[$current_file/$total_files] Loading Docker image: $(basename "$image_file")"
        
        if docker load < <(gunzip -c "$image_file"); then
            echo "✓ Successfully loaded: $(basename "$image_file")"
        else
            echo "✗ Failed to load: $(basename "$image_file")"
            failed_loads=$((failed_loads + 1))
        fi
        echo "---"
    fi
done

# Summary
echo "Docker images loading completed!"
echo "Successfully loaded: $((total_files - failed_loads))/$total_files images"

if [ "$failed_loads" -gt 0 ]; then
    echo "Failed to load: $failed_loads images"
    exit 1
fi

# Show loaded images
echo "Verifying loaded images..."
docker images --format "table {{.Repository}}\t{{.Tag}}\t{{.Size}}"

# Runtime secrets are not shipped in the package; docker compose fails without them
echo "Generating runtime secrets..."
bash "$(dirname "$(readlink -f "$0")")/init-secrets.sh"

EOF

# Make the script executable
chmod +x offline-package/load-images.sh
echo "load-images.sh script created and made executable."

# Runtime secrets are excluded from the package, so create a host-side script that
# generates them on the offline machine (no Docker image or internet access needed)
echo "Creating init-secrets.sh script..."
cat > offline-package/init-secrets.sh << 'EOF'
#!/bin/bash

#################
# Generates the runtime secrets required by docker-compose.yml on the offline machine.
# Requires only bash, openssl and python3 (SceneScape mode); no Docker or internet access.
#
# Usage: ./init-secrets.sh
# Run this from the offline-package directory before 'docker compose up -d'.
#
#################

set -e

SCRIPT_DIR="$(dirname "$(readlink -f "$0")")"
cd "$SCRIPT_DIR"

for tool in bash openssl; do
    if ! command -v "$tool" &> /dev/null; then
        echo "Error: '$tool' is required to generate secrets but was not found."
        exit 1
    fi
done

bash src/secrets/generate_nodered_secret.sh

if [ "__MODE__" = "ss" ]; then
    if ! command -v python3 &> /dev/null; then
        echo "Error: 'python3' is required to generate SceneScape secrets but was not found."
        exit 1
    fi
    if [ ! -f src/secrets/browser.auth ]; then
        bash src/secrets/generate_secrets.sh
    else
        echo "SceneScape secrets already exist, skipping generation."
    fi
    echo "Before starting the application, run: export SUPASS=\$(cat ./src/secrets/supass)"
fi

echo "Secrets are ready."
EOF
sed -i "s/__MODE__/${MODE}/" offline-package/init-secrets.sh
chmod +x offline-package/init-secrets.sh
echo "init-secrets.sh script created and made executable."


echo "Offline package generation completed successfully!"
echo "Package location: ./offline-package"
