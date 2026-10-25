#!/bin/bash

SOURCE="src"
if [ ! -f "${SOURCE}/secrets/browser.auth" ]; then
  bash ${SOURCE}/secrets/generate_secrets.sh
fi

# Self-guarded: also backfills this secret on deployments that already ran
# generate_secrets.sh before adminAuth was introduced.
bash ${SOURCE}/secrets/generate_nodered_secret.sh

if [ ! -f .env ]; then
  touch .env
fi

USER_UID=$(stat -c '%u' "${SOURCE}"/* | sort -rn | head -1)
USER_GID=$(stat -c '%g' "${SOURCE}"/* | sort -rn | head -1)

echo "UID=$USER_UID" > .env
echo "GID=$USER_GID" >> .env

if [ ! -d "${SOURCE}/dlstreamer-pipeline-server/videos" ] || [ -z "$(find "${SOURCE}/dlstreamer-pipeline-server/videos" -type f -name "*.ts" 2>/dev/null)" ]; then
  VIDEO_BRANCH="main"
  VIDEO_URL="https://github.com/open-edge-platform/edge-ai-resources/raw/refs/heads/${VIDEO_BRANCH}/videos/synthetic_data"
  VIDEOS=(
    "intersection_2_1.ts"
    "intersection_4_1.ts"
    "intersection_4_2.ts"
    "intersection_4_3.ts"
    "intersection_4_4.ts"
    "intersection_5_1.ts"
    "intersection_5_2.ts"
    "intersection_5_3.ts"
    "intersection_5_4.ts"
    "intersection_9_1.ts"
    "intersection_9_2.ts"
    "intersection_9_3.ts"
    "intersection_9_4.ts"
  )
  VIDEO_DIR="${SOURCE}/dlstreamer-pipeline-server/videos"

  mkdir -p "${VIDEO_DIR}"
  
  echo "Downloading videos in parallel..."
  for VIDEO in "${VIDEOS[@]}"; do
    # -f makes HTTP errors (e.g. 504) fail instead of saving an error page
    ( curl -fkL -sS --retry 3 --retry-delay 5 "${VIDEO_URL}/${VIDEO}" -o "${VIDEO_DIR}/${VIDEO}" \
      || rm -f "${VIDEO_DIR}/${VIDEO}" ) &
  done
  
  # # Dummy download to potentially improve bandwidth allocation
  # curl -k -L -s "${VIDEO_URL}/LICENSE" -o "${VIDEO_DIR}/LICENSE" &
  
  wait
  
  for VIDEO in "${VIDEOS[@]}"; do
    if [ ! -s "${VIDEO_DIR}/${VIDEO}" ] || head -c 64 "${VIDEO_DIR}/${VIDEO}" | grep -qi '<!doctype\|<html'; then
        echo "Error: Failed to download ${VIDEO} (missing, empty, or HTML error page)"
        rm -f "${VIDEO_DIR}/${VIDEO}"
        exit 1
    fi
  done
fi

# Download vehicle-reid-0001 model if not present
if [ ! -d "${SOURCE}/dlstreamer-pipeline-server/models/vehicle_reid" ]; then
  echo "Downloading vehicle-reid-0001 model..."
  MODEL_DIR="${SOURCE}/dlstreamer-pipeline-server/models"
  
  pip install -q openvino-dev[onnx,tensorflow2]
  
  omz_downloader --name vehicle-reid-0001 -o "${MODEL_DIR}"
  omz_converter --name vehicle-reid-0001 -o "${MODEL_DIR}" -d "${MODEL_DIR}"
  
  # Create vehicle_reid directory and move model files
  mkdir -p "${MODEL_DIR}/vehicle_reid"
  if [ -d "${MODEL_DIR}/public/vehicle-reid-0001" ]; then
    cp -r "${MODEL_DIR}/public/vehicle-reid-0001"/* "${MODEL_DIR}/vehicle_reid/"
    rm -rf "${MODEL_DIR}/public"
    echo "Vehicle ReID model downloaded successfully"
  else
    echo "Warning: Vehicle ReID model download may have failed"
  fi
fi


