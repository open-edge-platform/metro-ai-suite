#!/bin/bash -e

SCRIPT_DIR="$(dirname "$(readlink -f "$0")")"
MODE="${2:-def}"

# Link names mounted by the compose files -> "<default target>|<scenescape target>" (same dir).
# An empty target means the link must not exist in that mode.
declare -A CONFIG_LINKS=(
  [src/dlstreamer-pipeline-server/config.json]="config_def.json|config_ss.json"
  [src/grafana/datasources.yml]="datasources_def.yml|datasources_ss.yml"
  [src/node-red/flows.json]="flows_def.json|flows_ss.json"
  [src/node-red/install_package.sh]="install_package_def.sh|install_package_ss.sh"
  [src/node-red/settings.js]="|settings_ss.js"
  [src/node-red/flows_cred.json]="|flows_cred_ss.json"
)

link_target() {
  IFS='|' read -r def_target ss_target <<< "${CONFIG_LINKS[$1]}"
  if [ "$MODE" = "ss" ]; then echo "$ss_target"; else echo "$def_target"; fi
}

# Validate everything first so a failure leaves the current links untouched
for link in "${!CONFIG_LINKS[@]}"; do
  target="$(link_target "$link")"
  if [ -n "$target" ] && [ ! -e "${SCRIPT_DIR}/$(dirname "$link")/${target}" ]; then
    echo "Error: $(dirname "$link")/${target} not found for '${MODE}' mode."
    exit 1
  fi
done

echo "Linking configuration files for '${MODE}' mode..."
for link in "${!CONFIG_LINKS[@]}"; do
  link_path="${SCRIPT_DIR}/${link}"
  target="$(link_target "$link")"
  if [ -L "$link_path" ]; then
    unlink "$link_path"
  fi
  # Nothing to link in this mode; leave any runtime-generated file (e.g. Node-RED settings.js) alone
  if [ -z "$target" ]; then
    continue
  fi
  # A regular file here means it was edited in place (e.g. Node-RED Deploy); keep it instead of overwriting
  if [ -e "$link_path" ]; then
    backup="${link_path}.user-$(date +%Y%m%d-%H%M%S)"
    mv "$link_path" "$backup"
    echo "  WARNING: ${link} was a regular file, saved as $(basename "$backup")"
  fi
  ln -s "$target" "$link_path"
  echo "  ${link} -> ${target}"
done

if [ "$MODE" = "ss" ]; then
  bash "${SCRIPT_DIR}/init-scenescape.sh"
fi

docker run --rm --user=root \
  -e http_proxy -e https_proxy -e no_proxy \
  -v "$(dirname "$(readlink -f "$0")"):/opt/project" \
   intel/dlstreamer:2026.2.0-ubuntu24 bash -c "$(cat <<EOF

cd /opt/project
export HOST_IP="${1:-$(hostname -I | cut -f1 -d' ')}"
echo "Configuring application to use \$HOST_IP"

# shellcheck disable=SC1091
. ./update_dashboard.sh \$HOST_IP

##############################################################################
# 4. Process YOLO model (if any)
##############################################################################
mkdir -p src/dlstreamer-pipeline-server/models/public

export MODELS_PATH=/opt/project/src/dlstreamer-pipeline-server/models
chmod +x /home/dlstreamer/dlstreamer/samples/download_public_models.sh
if [ ! -e "src/dlstreamer-pipeline-server/models/public/yolo11s/INT8/yolo11s.xml" ]; then
    for attempt in {1..3}; do
        echo "Attempt $attempt: Running model download and quantization..."
        if /home/dlstreamer/dlstreamer/samples/download_public_models.sh yolo11s coco128; then
            echo "Model download and quantization successful!"
            break
        else
            echo "Download attempt $attempt failed. Retrying..."
            sleep 2
        fi
    done
fi

##############################################################################
# Download and setup videos
##############################################################################
mkdir -p src/dlstreamer-pipeline-server/videos
declare -A video_urls=(
    ["new_video_1.mp4"]="https://github.com/open-edge-platform/edge-ai-resources/raw/0d39322d6c6c578413cdf2a3d48c4e0978531e10/videos/smart_parking_720p_30fps.mp4"
    ["new_video_2.mp4"]="https://github.com/open-edge-platform/edge-ai-resources/raw/0d39322d6c6c578413cdf2a3d48c4e0978531e10/videos/smart_parking_720p_30fps.mp4"
    ["new_video_3.mp4"]="https://github.com/open-edge-platform/edge-ai-resources/raw/0d39322d6c6c578413cdf2a3d48c4e0978531e10/videos/smart_parking_720p_30fps.mp4"
    ["new_video_4.mp4"]="https://github.com/open-edge-platform/edge-ai-resources/raw/0d39322d6c6c578413cdf2a3d48c4e0978531e10/videos/smart_parking_720p_30fps.mp4"
)
for video_name in "\${!video_urls[@]}"; do
    if [ ! -f src/dlstreamer-pipeline-server/videos/\${video_name} ]; then
        echo "Download \${video_name}..."
        curl -L -o "src/dlstreamer-pipeline-server/videos/\${video_name}" "\${video_urls[\$video_name]}" 
    fi
done

echo "Fix ownership..."
chown -R "$(id -u):$(id -g)" src/dlstreamer-pipeline-server/models src/dlstreamer-pipeline-server/videos 2>/dev/null || true

mkdir -p src/nginx/ssl
cd src/nginx/ssl
if [ ! -f server.key ] || [ ! -f server.crt ]; then
    echo "Generate self-signed certificate..."
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 -keyout server.key -out server.crt -subj "/C=US/ST=CA/L=San Francisco/O=Intel/OU=Edge AI/CN=localhost"
    chown -R "$(id -u):$(id -g)" server.key server.crt 2>/dev/null || true

fi

EOF

)"