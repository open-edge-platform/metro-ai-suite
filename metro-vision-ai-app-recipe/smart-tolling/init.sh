#!/bin/bash

SOURCE="src"
if [ ! -f "${SOURCE}/secrets/browser.auth" ]; then
  bash ${SOURCE}/secrets/generate_secrets.sh
fi

# Required by the shared compose-scenescape.yml base's node-red secrets, regardless of
# whether Node-RED adminAuth is actually enabled in settings.js.
bash ${SOURCE}/secrets/generate_nodered_secret.sh

if [ ! -f .env ]; then
  touch .env
fi

USER_UID=$(stat -c '%u' "${SOURCE}"/* | sort -rn | head -1)
USER_GID=$(stat -c '%g' "${SOURCE}"/* | sort -rn | head -1)

echo "UID=$USER_UID" > .env
echo "GID=$USER_GID" >> .env

if [ ! -d "${SOURCE}/dlstreamer-pipeline-server/videos" ] || [ -z "$(find "${SOURCE}/dlstreamer-pipeline-server/videos" -type f -name "*.ts" 2>/dev/null)" ]; then
  VIDEOS=("FrontView_L_30fps.ts" "FrontView_R_30fps.ts" "RearView_L_30fps.ts" "RearView_R_30fps.ts" "SideAxle_Lane_1_30fps.ts" "SideAxle_Lane_2_30fps.ts")
  VIDEO_DIR="${SOURCE}/dlstreamer-pipeline-server/videos"

  mkdir -p "${VIDEO_DIR}"
  
  echo "Downloading videos in parallel..."
  for VIDEO in "${VIDEOS[@]}"; do
    curl -k -L -s --fail --retry 3 --retry-delay 2 --retry-all-errors "${VIDEO_URL}/${VIDEO}" -o "${VIDEO_DIR}/${VIDEO}" &
  done
  
  # # Dummy download to potentially improve bandwidth allocation
  # curl -k -L -s "${VIDEO_URL}/LICENSE" -o "${VIDEO_DIR}/LICENSE" &
  
  wait
  
  for VIDEO in "${VIDEOS[@]}"; do
    if [ ! -f "${VIDEO_DIR}/${VIDEO}" ]; then
        echo "Error: Failed to download ${VIDEO}"
        exit 1
    fi
  done
fi

# Download models on demand (skip any model dir that already has a model.xml, e.g. from git).
MODELS_DIR="${SOURCE}/dlstreamer-pipeline-server/models"
# local_dir:zip_name:folder_inside_zip
MODELS=(
  "axle:axle-detection.zip:axle-detection"
  "vehicle_type:vehicle-type-classification.zip:vehicle-type-classification"
  "vehicle_front_rear:vehicle-front-rear-detection.zip:vehicle-front-rear-detection"
  "color_int8_latest:vehicle-color-classification.zip:vehicle-color-classification"
  "licenseplate_cropped:licenseplate-detection.zip:licenseplate-detection"
)

for entry in "${MODELS[@]}"; do
  IFS=':' read -r local_dir zip_name zip_folder <<< "${entry}"
  if [ -f "${MODELS_DIR}/${local_dir}/model.xml" ]; then
    continue
  fi
  echo "Downloading model ${zip_name}..."
  tmp_zip="$(mktemp -d)/${zip_name}"
  if ! curl -k -L -s --fail --retry 3 --retry-delay 2 --retry-all-errors "${MODEL_URL}/${zip_name}" -o "${tmp_zip}"; then
    echo "Error: Failed to download ${MODEL_URL}/${zip_name}"
    rm -rf "$(dirname "${tmp_zip}")"
    exit 1
  fi
  unzip -qo "${tmp_zip}" -d "$(dirname "${tmp_zip}")"
  mkdir -p "${MODELS_DIR}/${local_dir}"
  cp -r "$(dirname "${tmp_zip}")/${zip_folder}"/. "${MODELS_DIR}/${local_dir}/"
  chmod -R u+rwX "$(dirname "${tmp_zip}")" && rm -rf "$(dirname "${tmp_zip}")"
  if [ ! -f "${MODELS_DIR}/${local_dir}/model.xml" ]; then
    echo "Error: Failed to download model ${zip_name}"
    exit 1
  fi
done

# The OCR model is shared with the license-plate-reader bundle; reuse it rather than duplicating it.
if [ ! -f "${MODELS_DIR}/paddle_ocr_v4/ch_PP-OCRv4_rec_infer.xml" ]; then
  echo "Downloading model license-plate-reader.zip (OCR submodel)..."
  tmp_zip="$(mktemp -d)/license-plate-reader.zip"
  if ! curl -k -L -s --fail --retry 3 --retry-delay 2 --retry-all-errors "" -o "${tmp_zip}"; then
    echo "Error: Failed to download license-plate-reader.zip"
    rm -rf "$(dirname "${tmp_zip}")"
    exit 1
  fi
  unzip -qo "${tmp_zip}" -d "$(dirname "${tmp_zip}")"
  mkdir -p "${MODELS_DIR}/paddle_ocr_v4"
  cp -r "$(dirname "${tmp_zip}")/license-plate-reader/models/ch_PP-OCRv4_rec_infer"/. "${MODELS_DIR}/paddle_ocr_v4/"
  chmod -R u+rwX "$(dirname "${tmp_zip}")" && rm -rf "$(dirname "${tmp_zip}")"
  if [ ! -f "${MODELS_DIR}/paddle_ocr_v4/ch_PP-OCRv4_rec_infer.xml" ]; then
    echo "Error: Failed to download OCR submodel from license-plate-reader.zip"
    exit 1
  fi
fi
