#!/usr/bin/env bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
#
# Push a video as rtsp://localhost:8010/live/venue. Default: the open-source
# people-detection video, downloaded on first run. Set VIDEO_FILE=/abs/path.mp4 to use your own.
#
#   PLAYS_PER_HOUR=6 ./start-stream.sh
#     N > 0  play the video N times per hour; the last frame is held between plays
#            (N too high for the video length = continuous loop)
#     -1     loop continuously, no hold
#     0      play once
#
# Default: 6 (one play every 10 min).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_DIR="$SCRIPT_DIR/.run"
VIDEO="${VIDEO_FILE:-$SCRIPT_DIR/people-detection.mp4}"
VIDEO_URL="https://raw.githubusercontent.com/intel-iot-devkit/sample-videos/master/people-detection.mp4"
RTSP_PORT=8010
RTSP_URL="rtsp://localhost:$RTSP_PORT/live/venue"
PLAYS_PER_HOUR="${PLAYS_PER_HOUR:-6}"

command -v ffmpeg >/dev/null || { echo "ffmpeg not found in PATH" >&2; exit 1; }
command -v ffprobe >/dev/null || { echo "ffprobe not found in PATH" >&2; exit 1; }
MEDIAMTX="$(command -v mediamtx || true)"
[[ -n "$MEDIAMTX" ]] || MEDIAMTX="$HOME/.local/bin/mediamtx"
[[ -x "$MEDIAMTX" ]] || { echo "mediamtx not found (see Get Started prerequisites)" >&2; exit 1; }
[[ "$PLAYS_PER_HOUR" =~ ^(-1|0|[1-9][0-9]*)$ ]] || { echo "PLAYS_PER_HOUR must be -1, 0 or a positive integer" >&2; exit 1; }
mkdir -p "$RUN_DIR"

# 1. Download the video (re-download if missing or corrupt); VIDEO_FILE is never downloaded.
if [[ -n "${VIDEO_FILE:-}" ]]; then
  if ! [[ -f "$VIDEO" ]] || ! ffprobe -v error "$VIDEO" 2>/dev/null; then
    echo "VIDEO_FILE is missing or not a valid video: $VIDEO" >&2; exit 1
  fi
elif ! ffprobe -v error "$VIDEO" 2>/dev/null; then
  echo "downloading $VIDEO_URL"
  curl -fsSL --retry 3 -o "$VIDEO.part" "$VIDEO_URL"
  mv "$VIDEO.part" "$VIDEO"
fi

# 2. Pick the input: the raw video, or one cycle = video + frozen last frame (3600 / N seconds).
DURATION="$(ffprobe -v error -select_streams v:0 -show_entries stream=duration -of csv=p=0 "$VIDEO")"
INPUT="$VIDEO"
LOOP=-1
VFLAGS=(-an -c:v copy)
if [[ "$PLAYS_PER_HOUR" == "0" ]]; then
  LOOP=0
elif [[ "$PLAYS_PER_HOUR" != "-1" ]]; then
  PERIOD=$((3600 / PLAYS_PER_HOUR))
  if awk -v p="$PERIOD" -v d="$DURATION" 'BEGIN { exit !(p > d) }'; then
    INPUT="$RUN_DIR/cycle-${PERIOD}s-$(stat -c %s-%Y "$VIDEO").mp4"
    VFLAGS=(-c copy)
    if [[ ! -s "$INPUT" ]]; then
      echo "building ${PERIOD}s cycle (video ${DURATION}s + last-frame hold)…"
      ffmpeg -hide_banner -loglevel error -y -i "$VIDEO" -an \
        -vf "tpad=stop_mode=clone:stop_duration=$PERIOD" -t "$PERIOD" \
        -c:v libx264 -preset veryfast -pix_fmt yuv420p -g 24 -movflags +faststart "$INPUT"
    fi
  fi
fi

# 3. Start MediaMTX (TCP only, so it does not clash with quick-start on UDP 8000/8001).
if [[ -f "$RUN_DIR/mediamtx.pid" ]] && kill -0 "$(cat "$RUN_DIR/mediamtx.pid")" 2>/dev/null; then
  echo "mediamtx already running"
else
  cat >"$RUN_DIR/mediamtx.yml" <<YML
logLevel: warn
rtspAddress: :$RTSP_PORT
rtspTransports: [tcp]
rtmp: no
hls: no
webrtc: no
srt: no
api: no
paths:
  all:
YML
  nohup "$MEDIAMTX" "$RUN_DIR/mediamtx.yml" >"$RUN_DIR/mediamtx.log" 2>&1 &
  echo $! >"$RUN_DIR/mediamtx.pid"
  for _ in $(seq 25); do ss -tln 2>/dev/null | grep -q ":$RTSP_PORT " && break; sleep 0.2; done
  ss -tln 2>/dev/null | grep -q ":$RTSP_PORT " || { echo "mediamtx failed — see $RUN_DIR/mediamtx.log" >&2; exit 1; }
fi

# 4. Push the cycle.
if [[ -f "$RUN_DIR/ffmpeg.pid" ]] && kill -0 "$(cat "$RUN_DIR/ffmpeg.pid")" 2>/dev/null; then
  echo "stream already running (run stop-stream.sh first to change settings)"
else
  nohup ffmpeg -hide_banner -loglevel warning -re -stream_loop "$LOOP" -i "$INPUT" \
    "${VFLAGS[@]}" -f rtsp -rtsp_transport tcp "$RTSP_URL" >"$RUN_DIR/ffmpeg.log" 2>&1 &
  echo $! >"$RUN_DIR/ffmpeg.pid"
fi
echo "streaming $RTSP_URL (PLAYS_PER_HOUR=$PLAYS_PER_HOUR)"
