#!/usr/bin/env bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
#
# One-shot launcher: push the open-source video as RTSP, write the
# venue config + monitor into the data dir, then bring the stack up (reusing an
# already-warm model serving).
#
#   examples/venue-monitor/start-demo.sh   # env: PLAYS_PER_HOUR, VIDEO_FILE (stream), RTSP_URL (use your own stream),
#                           #      PROMPT_LANG=en|zh (use-case prompt)
#   examples/venue-monitor/stop-demo.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
DATA_DIR="${SMART_COMMUNITY_DATA_DIR:-$HOME/.mcp-smart-community}"

command -v md5sum >/dev/null || { echo "md5sum not found in PATH" >&2; exit 1; }

# 0. Already running (stream up)? Stop everything first, then start fresh.
for pidfile in "$SCRIPT_DIR/.run/ffmpeg.pid" "$SCRIPT_DIR/.run/mediamtx.pid"; do
  if [[ -f "$pidfile" ]] && kill -0 "$(cat "$pidfile")" 2>/dev/null; then
    echo "demo already running — running stop-demo.sh first…"
    bash "$SCRIPT_DIR/stop-demo.sh"
    break
  fi
done

# 1. Push the RTSP stream, or use an existing one when RTSP_URL is set.
MONITORS_SRC="$SCRIPT_DIR/monitors.example.yaml"
if [[ -n "${RTSP_URL:-}" ]]; then
  echo "using existing RTSP stream $RTSP_URL (not starting the stream)"
  MONITORS_SRC="$(mktemp)"
  trap 'rm -f "$MONITORS_SRC"' EXIT
  awk 'match($0, /source_url:/) { print substr($0, 1, RSTART + RLENGTH - 1) " " ENVIRON["RTSP_URL"]; next } { print }' \
    "$SCRIPT_DIR/monitors.example.yaml" >"$MONITORS_SRC"
else
  bash "$SCRIPT_DIR/start-stream.sh"
fi

# 2. Persist config + monitors into the data dir (the MCP container reads them at startup).
mkdir -p "$DATA_DIR"
DATA_DIR="$(cd "$DATA_DIR" && pwd)"

persist_config() {
  local source="$1" target="$2" backup

  [[ ! -L "$target" ]] || { echo "refusing to overwrite symbolic link: $target" >&2; return 1; }
  [[ ! -e "$target" || -f "$target" ]] || { echo "refusing to overwrite non-regular file: $target" >&2; return 1; }
  if [[ -f "$target" ]] && [[ "$(md5sum "$source" | awk '{print $1}')" == "$(md5sum "$target" | awk '{print $1}')" ]]; then
    return
  fi
  if [[ -f "$target" ]]; then
    backup="$target.$(date '+%Y%m%d-%H%M%S').bak"
    [[ ! -e "$backup" && ! -L "$backup" ]] || { echo "backup already exists: $backup" >&2; return 1; }
    cp -- "$target" "$backup"
    echo "backed up ${target} to ${backup}"
  fi
  cp -- "$source" "$target"
  echo "updated $target from $source"
}

persist_config "$SCRIPT_DIR/config.example.yaml" "$DATA_DIR/config.yaml"
persist_config "$MONITORS_SRC" "$DATA_DIR/monitors.yaml"

# 3. Bring up the stack; bounce the app tier first if running so it reloads the config.
if [ -n "$(docker ps -q \
    --filter name='^smart-community-mcp-server$' \
    --filter name='^multilevel-video-understanding$' \
    --filter name='^videostream-analytics$')" ]; then
  echo "app tier already running — bouncing it (--light-down) to reload the config…"
  bash "$REPO_DIR/setup_docker.sh" --light-down
fi
echo "starting the stack (setup_docker.sh --light)…"
bash "$REPO_DIR/setup_docker.sh" --light

# 4. Register the venue use case (venue_monitor, PROMPT_LANG=en|zh) with the video-summary service.
bash "$SCRIPT_DIR/register-use-case.sh"

cat <<MSG

Example demo is up.
  RTSP stream : rtsp://localhost:8010/live/venue
  Web UI      : http://localhost:3100/
To stop (stream + app tier, keeps the model serving warm):
  bash $SCRIPT_DIR/stop-demo.sh
MSG
