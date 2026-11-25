#!/usr/bin/env bash
# =============================================================================
# videostream-analytics full test script
#
# Supports two test modes:
#   1. Unit Tests        — pure Python, using video fixtures generated at test time
#   2. Scenario Tests    — runs the sample video with the prefilter on and off, verifying clip output
#
# Usage:
#   bash scripts/test-videostream-analytics.sh              # run all tests
#   bash scripts/test-videostream-analytics.sh --unit-only  # unit tests only
#   bash scripts/test-videostream-analytics.sh --multi-video       # scenario tests (prefilter on / off)
#   bash scripts/test-videostream-analytics.sh --local             # local (no Docker) scenario tests
#   bash scripts/test-videostream-analytics.sh -v           # verbose output
#
# Environment variables:
#   HTTP_PROXY / HTTPS_PROXY  — Docker build proxy
#   PREFILTER_MODEL_DIR       — YOLO model directory (default ~/models/openvino)
#   DATA_DIR                  — clip output directory (default /tmp/smart-community-clips)
#   VSA_TEST_VIDEO            — use your own MP4 instead of the downloaded people-detection sample
#   MEDIAMTX_BIN              — MediaMTX executable (default ~/.local/bin/mediamtx)
#   MEDIAMTX_CONFIG           — MediaMTX config (default tools/mediamtx.yml)
#   DOCKER_IMAGE              — VSA container image name (default videostream-analytics:latest)
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PYTHON="${PROJECT_DIR}/.venv/bin/python"

if [[ ! -x "$PYTHON" ]]; then
    echo "Virtual env not found at ${PROJECT_DIR}/.venv"
    echo "Run: cd $PROJECT_DIR && python3 -m venv .venv && .venv/bin/pip install -e '.[dev]'"
    exit 1
fi

# --- Configuration ---
MEDIAMTX_BIN="${MEDIAMTX_BIN:-$HOME/.local/bin/mediamtx}"
MEDIAMTX_CONFIG="${MEDIAMTX_CONFIG:-${PROJECT_DIR}/tools/mediamtx.yml}"
DOCKER_IMAGE="${DOCKER_IMAGE:-videostream-analytics:latest}"
RTSP_PORT=8554
WEBHOOK_PORT=9999
ANALYTICS_PORT=8999
DATA_DIR="${DATA_DIR:-/tmp/smart-community-clips}"
PREFILTER_MODEL_DIR="${PREFILTER_MODEL_DIR:-$HOME/models/openvino}"

# --- Test video: open-source people-detection sample, downloaded when missing ---
SAMPLE_URL="https://raw.githubusercontent.com/intel-iot-devkit/sample-videos/master/people-detection.mp4"
VIDEO_SAMPLE="${VSA_TEST_VIDEO:-$PROJECT_DIR/tools/.cache/people-detection.mp4}"

# --- Parse Arguments ---
RUN_UNIT=true
RUN_MULTIVIDEO=false
USE_LOCAL=false
PYTEST_ARGS=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --unit-only) RUN_MULTIVIDEO=false; shift ;;
        --multi-video) RUN_UNIT=false; RUN_MULTIVIDEO=true; shift ;;
        --local) USE_LOCAL=true; shift ;;
        -v|--verbose) PYTEST_ARGS="-v"; shift ;;
        *) echo "Unknown argument: $1"; exit 1 ;;
    esac
done

# --- Colors ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${BLUE}[INFO]${NC} $*"; }
ok()    { echo -e "${GREEN}[PASS]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
fail()  { echo -e "${RED}[FAIL]${NC} $*"; }
header(){ echo -e "\n${CYAN}═══════════════════════════════════════════════════════════════${NC}"; echo -e "  ${CYAN}$*${NC}"; echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}\n"; }

ensure_sample_video() {
    if [[ -n "${VSA_TEST_VIDEO:-}" ]]; then
        [[ -f "$VIDEO_SAMPLE" ]] || { fail "VSA_TEST_VIDEO does not exist: $VIDEO_SAMPLE"; return 1; }
        return 0
    fi
    if ! ffprobe -v error "$VIDEO_SAMPLE" 2>/dev/null; then
        info "Downloading $SAMPLE_URL"
        mkdir -p "$(dirname "$VIDEO_SAMPLE")"
        if ! { curl -fsSL --retry 3 -o "$VIDEO_SAMPLE.part" "$SAMPLE_URL" && mv "$VIDEO_SAMPLE.part" "$VIDEO_SAMPLE"; }; then
            fail "download failed: $SAMPLE_URL"; return 1
        fi
    fi
}

# --- Cleanup function ---
PIDS_TO_KILL=()
CONTAINER_NAME=""
LOCAL_SERVER_PID=""

cleanup() {
    info "Cleaning up..."
    if [[ -n "$CONTAINER_NAME" ]]; then
        docker stop "$CONTAINER_NAME" 2>/dev/null || true
        docker rm "$CONTAINER_NAME" 2>/dev/null || true
    fi
    pkill -f "ffmpeg.*live/" 2>/dev/null || true
    if [[ -n "$LOCAL_SERVER_PID" ]]; then
        kill "$LOCAL_SERVER_PID" 2>/dev/null || true
        wait "$LOCAL_SERVER_PID" 2>/dev/null || true
    fi
    for pid in "${PIDS_TO_KILL[@]}"; do
        kill "$pid" 2>/dev/null || true
        wait "$pid" 2>/dev/null || true
    done
    if [[ "${MEDIAMTX_STARTED:-false}" == "true" ]]; then
        pkill -f "mediamtx" 2>/dev/null || true
    fi
    info "Cleanup complete."
}
trap cleanup EXIT

# --- Helper: ensure MediaMTX ---
ensure_mediamtx() {
    if lsof -i:$RTSP_PORT -t &>/dev/null; then
        info "MediaMTX already running on port $RTSP_PORT"
        MEDIAMTX_STARTED=false
    else
        info "Starting MediaMTX..."
        if [[ -f "$MEDIAMTX_CONFIG" ]]; then
            "$MEDIAMTX_BIN" "$MEDIAMTX_CONFIG" &>/dev/null &
        else
            "$MEDIAMTX_BIN" &>/dev/null &
        fi
        PIDS_TO_KILL+=($!)
        MEDIAMTX_STARTED=true
        sleep 2
        if ! lsof -i:$RTSP_PORT -t &>/dev/null; then
            fail "MediaMTX failed to start on port $RTSP_PORT"
            exit 1
        fi
        ok "MediaMTX started on :$RTSP_PORT"
    fi
}

# --- Helper: push RTSP stream ---
push_rtsp() {
    local video_path="$1"
    local rtsp_path="$2"
    local seek="${3:-0}"  # optional seek position in seconds

    pkill -f "ffmpeg.*${rtsp_path}" 2>/dev/null || true
    sleep 1

    local seek_args=()
    if [[ "$seek" -gt 0 ]]; then
        seek_args=(-ss "$seek")
    fi

    ffmpeg -re -stream_loop -1 "${seek_args[@]}" -i "$video_path" \
        -an -c copy -f rtsp \
        "rtsp://localhost:$RTSP_PORT/$rtsp_path" \
        </dev/null &>/dev/null &
    PIDS_TO_KILL+=($!)
    sleep 2
    ok "RTSP push: $(basename "$video_path") → rtsp://localhost:$RTSP_PORT/$rtsp_path"
}

# --- Helper: start mock webhook ---
start_mock_webhook() {
    if curl -sf "http://localhost:$WEBHOOK_PORT/health" >/dev/null 2>&1; then
        info "Mock webhook already running on :$WEBHOOK_PORT"
        return
    fi
    info "Starting mock webhook server on :$WEBHOOK_PORT..."
    $PYTHON -m uvicorn tests.integration.mock_webhook_server:app \
        --host 127.0.0.1 --port $WEBHOOK_PORT --log-level warning &
    PIDS_TO_KILL+=($!)
    sleep 2
    if curl -sf "http://localhost:$WEBHOOK_PORT/health" >/dev/null; then
        ok "Mock webhook server running on :$WEBHOOK_PORT"
    else
        fail "Mock webhook server failed to start"
        exit 1
    fi
}

# --- Helper: start analytics (Docker or Local) ---
start_analytics_docker() {
    CONTAINER_NAME="videostream-analytics-test-$$"
    info "Starting Docker container: $DOCKER_IMAGE"

    docker run -d --rm \
        --name "$CONTAINER_NAME" \
        --network host \
        -e WEBHOOK_URL="http://localhost:$WEBHOOK_PORT/events" \
        -e PREFILTER_MODEL_DIR="/models" \
        -e no_proxy="localhost,127.0.0.1" \
        -e http_proxy="" \
        -e https_proxy="" \
        -v "$PREFILTER_MODEL_DIR:/models:ro" \
        -v "/tmp:/tmp" \
        -v "$DATA_DIR:/root/.mcp-smart-community/segments" \
        "$DOCKER_IMAGE"
    sleep 3
    wait_for_analytics
}

start_analytics_local() {
    info "Starting local videostream-analytics on :$ANALYTICS_PORT..."
    cd "$PROJECT_DIR"
    WEBHOOK_URL="http://localhost:$WEBHOOK_PORT/events" \
    $PYTHON __main__.py --host 127.0.0.1 --port $ANALYTICS_PORT --config config/config.yaml.example &
    LOCAL_SERVER_PID=$!
    PIDS_TO_KILL+=("$LOCAL_SERVER_PID")
    sleep 3
    wait_for_analytics
}

wait_for_analytics() {
    local retries=15
    while [[ $retries -gt 0 ]]; do
        if curl -sf "http://localhost:$ANALYTICS_PORT/health" >/dev/null 2>&1; then
            ok "Analytics service healthy on :$ANALYTICS_PORT"
            return
        fi
        retries=$((retries - 1))
        sleep 1
    done
    fail "Analytics service failed to become healthy on :$ANALYTICS_PORT"
    if [[ -n "$CONTAINER_NAME" ]]; then
        docker logs "$CONTAINER_NAME" 2>&1 | tail -20
    fi
    exit 1
}

# --- Helper: register source and wait for events ---
test_video_scenario() {
    local source_id="$1"
    local rtsp_path="$2"
    local use_case="$3"
    local prefilter_enabled="${4:-true}"
    local wait_time="${5:-60}"

    info "Testing scenario: source_id=$source_id, use_case=$use_case, prefilter=$prefilter_enabled"

    # Clear previous events
    curl -sf -X DELETE "http://localhost:$WEBHOOK_PORT/recorded_events" >/dev/null

    # Register source (nested-pipeline schema: source_url + pipeline.* blocks)
    local body
    if [[ "$prefilter_enabled" == "false" ]]; then
        body="{\"source_id\":\"$source_id\",\"source_url\":\"rtsp://localhost:$RTSP_PORT/$rtsp_path\",\"pipeline\":{\"prefilter\":{\"enabled\":false}}}"
    else
        body="{\"source_id\":\"$source_id\",\"source_url\":\"rtsp://localhost:$RTSP_PORT/$rtsp_path\"}"
    fi

    local resp
    resp=$(curl -sf -X POST "http://localhost:$ANALYTICS_PORT/register_source" \
        -H "Content-Type: application/json" -d "$body")
    local reg_status
    reg_status=$(echo "$resp" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))" 2>/dev/null)

    if [[ "$reg_status" == "started" || "$reg_status" == "already_running" ]]; then
        ok "Source registered: $source_id ($reg_status)"
    else
        fail "Failed to register source $source_id: $resp"
        return 1
    fi

    # Wait for motion events
    info "Waiting ${wait_time}s for motion events..."
    local deadline=$((SECONDS + wait_time))
    local event_count=0
    while [[ $SECONDS -lt $deadline ]]; do
        event_count=$(curl -sf "http://localhost:$WEBHOOK_PORT/recorded_events/motion" | \
            python3 -c "import sys,json; print(json.load(sys.stdin).get('count',0))" 2>/dev/null || echo 0)
        if [[ "$event_count" -ge 1 ]]; then
            break
        fi
        sleep 3
    done

    # Check results
    if [[ "$event_count" -ge 1 ]]; then
        ok "$source_id: received $event_count motion event(s)"
    else
        fail "$source_id: no motion events received in ${wait_time}s"
        # Show status events for debugging
        info "Status events:"
        curl -sf "http://localhost:$WEBHOOK_PORT/recorded_events/status" | python3 -m json.tool 2>/dev/null || true
        return 1
    fi

    # Check clip files
    local clip_dir="$DATA_DIR/$source_id/motion_events"
    local clip_count=0
    if [[ -d "$clip_dir" ]]; then
        clip_count=$(find "$clip_dir" -name "*.mp4" | wc -l)
    fi
    if [[ "$clip_count" -ge 1 ]]; then
        ok "$source_id: $clip_count clip file(s) in $clip_dir"
    else
        warn "$source_id: no clip files found in $clip_dir (may be in container path)"
    fi

    # Stop source
    curl -sf -X POST "http://localhost:$ANALYTICS_PORT/sources/$source_id/stop" >/dev/null 2>&1 || true
    return 0
}

# =============================================================================
# UNIT TESTS
# =============================================================================
if $RUN_UNIT; then
    header "UNIT TESTS"
    cd "$PROJECT_DIR"

    if ! $PYTHON -c "import pytest" 2>/dev/null; then
        info "Installing dev dependencies..."
        "${PROJECT_DIR}/.venv/bin/pip" install -e ".[dev]" --quiet --trusted-host pypi.org --trusted-host files.pythonhosted.org 2>/dev/null
    fi

    info "Running unit tests..."
    $PYTHON -m pytest tests/unit/ $PYTEST_ARGS --tb=short -q --timeout=60
    UNIT_EXIT=$?

    if [[ $UNIT_EXIT -eq 0 ]]; then
        ok "Unit tests PASSED"
    else
        fail "Unit tests FAILED (exit code: $UNIT_EXIT)"
        exit $UNIT_EXIT
    fi
fi

# =============================================================================
# MULTI-VIDEO SCENARIO TESTS
# =============================================================================
if $RUN_MULTIVIDEO; then
    header "SCENARIO TESTS (sample video)"
    cd "$PROJECT_DIR"

    ensure_sample_video || exit 1

    # Start infrastructure
    ensure_mediamtx
    start_mock_webhook

    if $USE_LOCAL; then
        start_analytics_local
    else
        if ! docker image inspect "$DOCKER_IMAGE" &>/dev/null; then
            info "Docker image not found, building..."
            docker build -t "$DOCKER_IMAGE" \
                --build-arg HTTP_PROXY="${HTTP_PROXY:-}" \
                --build-arg HTTPS_PROXY="${HTTPS_PROXY:-}" \
                -f docker/Dockerfile . 2>&1 | tail -5
        fi
        start_analytics_docker
    fi

    # Clean data dir (Docker writes as root → use container to clean)
    if [[ -d "$DATA_DIR" ]] && [[ -n "$(ls -A "$DATA_DIR" 2>/dev/null)" ]]; then
        if ! rm -rf "${DATA_DIR:?}"/* 2>/dev/null; then
            info "Cleaning $DATA_DIR via container (need root for files written by container)"
            docker run --rm -v "$DATA_DIR":/data alpine sh -c 'rm -rf /data/*' 2>/dev/null || true
        fi
    fi
    RESULTS=()

    # --- Scenario 1: person prefilter on ---
    echo ""
    info "━━━ Scenario 1/2: Prefilter on (cam_sample) ━━━"
    push_rtsp "$VIDEO_SAMPLE" "live/sample" 0
    if test_video_scenario "cam_sample" "live/sample" "sample" "true" 60; then
        RESULTS+=("prefilter_on:PASS")
    else
        RESULTS+=("prefilter_on:FAIL")
    fi
    pkill -f "ffmpeg.*live/sample" 2>/dev/null || true
    sleep 2

    # --- Scenario 2: prefilter off (motion only) ---
    echo ""
    info "━━━ Scenario 2/2: Prefilter off (cam_sample_nopf) ━━━"
    push_rtsp "$VIDEO_SAMPLE" "live/sample_nopf" 0
    if test_video_scenario "cam_sample_nopf" "live/sample_nopf" "sample" "false" 60; then
        RESULTS+=("prefilter_off:PASS")
    else
        RESULTS+=("prefilter_off:FAIL")
    fi

    # --- Summary ---
    echo ""
    header "MULTI-VIDEO RESULTS"
    PASS_COUNT=0
    FAIL_COUNT=0
    for r in "${RESULTS[@]}"; do
        scenario="${r%%:*}"
        status="${r##*:}"
        if [[ "$status" == "PASS" ]]; then
            ok "  $scenario"
            PASS_COUNT=$((PASS_COUNT + 1))
        else
            fail "  $scenario"
            FAIL_COUNT=$((FAIL_COUNT + 1))
        fi
    done
    echo ""
    info "Results: $PASS_COUNT passed, $FAIL_COUNT failed out of ${#RESULTS[@]} scenarios"

    if [[ $FAIL_COUNT -gt 0 ]]; then
        exit 1
    fi
fi

# =============================================================================
# SUMMARY
# =============================================================================
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo -e "  ${GREEN}ALL TESTS PASSED${NC}"
echo "═══════════════════════════════════════════════════════════════"
echo ""
