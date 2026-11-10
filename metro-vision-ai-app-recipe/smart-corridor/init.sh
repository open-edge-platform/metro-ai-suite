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

VIDEO_DIR="${SOURCE}/dlstreamer-pipeline-server/videos"
if [ ! -d "${VIDEO_DIR}" ] || [ -z "$(find "${VIDEO_DIR}" -maxdepth 1 -type f -name "*.ts" 2>/dev/null)" ]; then
  VIDEO_COMMIT="765c906f46e86480a270fbffcbeb036ed50e2d77"
  VIDEO_URL="https://github.com/open-edge-platform/edge-ai-resources/raw/${VIDEO_COMMIT}/videos"
  VIDEOS=("1122east_h264.ts" "1122west_h264.ts" "1122north_h264.ts" "1122south_h264.ts")

  mkdir -p "${VIDEO_DIR}"
  
  echo "Downloading videos in parallel..."
  for VIDEO in "${VIDEOS[@]}"; do
    # -f makes HTTP errors (e.g. 504) fail instead of saving an error page
    ( curl -fL -sS --retry 3 --retry-delay 5 "${VIDEO_URL}/${VIDEO}" -o "${VIDEO_DIR}/${VIDEO}" \
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

# Name the intersection camera feeds: copy each downloaded video to its
# intersection_4 name, then rename the original to its intersection_5 name
VIDEO_DIR="${SOURCE}/dlstreamer-pipeline-server/videos"
VIDEO_NAMES=(
  "1122north_h264|intersection_5_1|intersection_4_1"
  "1122east_h264|intersection_5_2|intersection_4_2"
  "1122south_h264|intersection_5_3|intersection_4_3"
  "1122west_h264|intersection_5_4|intersection_4_4"
)
for ENTRY in "${VIDEO_NAMES[@]}"; do
  IFS='|' read -r SRC_BASE FIVE_BASE FOUR_BASE <<< "${ENTRY}"
  SRC="${VIDEO_DIR}/${SRC_BASE}.ts"
  if [ -s "${SRC}" ]; then
    cp -f "${SRC}" "${VIDEO_DIR}/${FOUR_BASE}.ts"
    mv -f "${SRC}" "${VIDEO_DIR}/${FIVE_BASE}.ts"
  fi
  for NAME in "${FIVE_BASE}" "${FOUR_BASE}"; do
    if [ ! -s "${VIDEO_DIR}/${NAME}.ts" ]; then
      echo "Error: ${NAME}.ts is missing and its source ${SRC_BASE}.ts is not available"
      exit 1
    fi
  done
done

# Download the intersection detection model from edge-ai-resources if not present
INTERSECTION_MODEL_DIR="${SOURCE}/dlstreamer-pipeline-server/models/intersection"
if [ ! -s "${INTERSECTION_MODEL_DIR}/openvino.xml" ] || [ ! -s "${INTERSECTION_MODEL_DIR}/openvino.bin" ]; then
  MODEL_COMMIT="368e2437d73d39ca28324a03779d9220f3ac65c6"
  MODEL_URL="https://github.com/open-edge-platform/edge-ai-resources/raw/${MODEL_COMMIT}/models/INT8/smart_intersection.zip"
  MODEL_TMP_DIR=$(mktemp -d)

  echo "Downloading intersection model..."
  # -f makes HTTP errors fail instead of saving an error page
  if ! curl -fL -sS --retry 3 --retry-delay 5 "${MODEL_URL}" -o "${MODEL_TMP_DIR}/smart_intersection.zip" \
    || ! python3 -m zipfile -e "${MODEL_TMP_DIR}/smart_intersection.zip" "${MODEL_TMP_DIR}/extracted" \
    || [ ! -s "${MODEL_TMP_DIR}/extracted/openvino.xml" ] || [ ! -s "${MODEL_TMP_DIR}/extracted/openvino.bin" ]; then
    echo "Error: Failed to download or extract the intersection model from ${MODEL_URL}"
    rm -rf "${MODEL_TMP_DIR}"
    exit 1
  fi

  mkdir -p "${INTERSECTION_MODEL_DIR}"
  cp -f "${MODEL_TMP_DIR}/extracted/openvino.xml" "${MODEL_TMP_DIR}/extracted/openvino.bin" "${INTERSECTION_MODEL_DIR}/"
  rm -rf "${MODEL_TMP_DIR}"
  echo "Intersection model downloaded successfully"
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


