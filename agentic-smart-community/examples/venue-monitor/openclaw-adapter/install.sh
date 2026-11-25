#!/usr/bin/env bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
#
# Install the smart-community-alerts OpenClaw plugin for the venue monitor: one agent
# (venue-monitor-agent), the Smart Community skills, and one alert route (cam_venue).
# Safe to re-run; existing agents and routes are kept, but the agent persona is replaced on every run.
#
# Env overrides:
#   OPENCLAW_HOME  target home                (default: ~/.openclaw)
#   MCP_URL        Smart Community MCP endpoint  (default: http://localhost:3100/mcp)
#   AGENT_MODEL    model for the new agent    (default: agents.defaults.model.primary)
# shellcheck disable=SC2016 # jq programs are single-quoted on purpose; $vars are jq variables
set -euo pipefail

HERE="$(cd "$(dirname "$(realpath "${BASH_SOURCE[0]}")")" && pwd)"
REPO_ROOT="$(cd "$HERE/../../.." && pwd)"
SDK_DIR="$REPO_ROOT/packages/framework-adapter-sdk"
PLUGIN_INSTALL_SH="$SDK_DIR/examples/openclaw/scripts/install_as_openclaw_plugin.sh"
AGENT_ID="venue-monitor-agent"
PERSONA_DIR="$HERE/agents/$AGENT_ID/workspace"
OPENCLAW_HOME="${OPENCLAW_HOME:-$HOME/.openclaw}"
# The openclaw CLI reads OPENCLAW_HOME as a $HOME override; keep it out of the environment.
export -n OPENCLAW_HOME
PLUGIN_ID="smart-community-alerts"
MCP_URL_EXPLICIT=false
[[ -n "${MCP_URL+x}" ]] && MCP_URL_EXPLICIT=true
MCP_URL="${MCP_URL:-http://localhost:3100/mcp}"
AGENT_MODEL="${AGENT_MODEL:-}"
MONITOR_ID="cam_venue"

for tool in openclaw npm jq; do
  command -v "$tool" >/dev/null 2>&1 || { echo "ERROR: '$tool' not found on PATH." >&2; exit 1; }
done
[[ -f "$PLUGIN_INSTALL_SH" ]] || { echo "ERROR: plugin install script not found: $PLUGIN_INSTALL_SH" >&2; exit 1; }
[[ -d "$PERSONA_DIR" ]] || { echo "ERROR: persona not found: $PERSONA_DIR" >&2; exit 1; }

if [[ ! -x "$SDK_DIR/node_modules/.bin/tsc" && ! -x "$REPO_ROOT/node_modules/.bin/tsc" ]]; then
  echo "==> Installing SDK build dependencies"
  npm --prefix "$REPO_ROOT" ci --include=dev
fi

if [[ -z "$AGENT_MODEL" ]]; then
  configured_model="$(openclaw config get agents.defaults.model.primary --json 2>/dev/null || true)"
  AGENT_MODEL="$(jq -r 'if type == "string" then . else empty end' <<<"$configured_model")"
fi
[[ -n "$AGENT_MODEL" ]] || { echo "ERROR: No default OpenClaw model configured. Set AGENT_MODEL." >&2; exit 1; }

patch_config() {  # patch_config <jq args...> <filter>
  local file; file="$(mktemp)"
  jq -n "$@" > "$file"
  openclaw config patch --file "$file"
  rm -f "$file"
}

echo "==> Preparing the OpenClaw plugin"
bash "$PLUGIN_INSTALL_SH" prepare --openclaw-home "$OPENCLAW_HOME" --plugin-id "$PLUGIN_ID"

echo "==> Registering plugin entry and the $MONITOR_ID alert route"
if openclaw config get "plugins.entries.$PLUGIN_ID" --json >/dev/null 2>&1; then
  if [[ "$MCP_URL_EXPLICIT" == "true" ]]; then
    patch_config --arg id "$PLUGIN_ID" --arg url "$MCP_URL" \
      '{ plugins: { entries: { ($id): { config: { mcpServer: { url: $url } } } } } }'
  fi
else
  patch_config --arg id "$PLUGIN_ID" --arg url "$MCP_URL" \
    '{ plugins: { entries: { ($id): { enabled: true, config: { mcpServer: { url: $url }, monitors: {} } } } } }'
fi
if openclaw config get "plugins.entries.$PLUGIN_ID.config.monitors.$MONITOR_ID" --json >/dev/null 2>&1; then
  echo "    - $MONITOR_ID already routed — left as-is"
else
  patch_config --arg id "$PLUGIN_ID" --arg mon "$MONITOR_ID" --arg agent "$AGENT_ID" \
    '{ plugins: { entries: { ($id): { config: { monitors: { ($mon): {
         alerts: [ { agentId: $agent, sessionKey: ("agent:" + $agent + ":" + $mon), deliver: false } ] } } } } } } }'
fi

echo "==> Adding $AGENT_ID to agents.list"
existing_list="$(openclaw config get agents.list --json 2>/dev/null || true)"
jq -e 'type == "array"' <<<"$existing_list" >/dev/null 2>&1 || existing_list='[]'
merged_list="$(jq -n --argjson existing "$existing_list" --arg model "$AGENT_MODEL" --arg agent "$AGENT_ID" '
  def entry($id): { id: $id, name: $id,
    workspace: ("${HOME}/.openclaw/agents/" + $id + "/workspace"),
    agentDir: ("${HOME}/.openclaw/agents/" + $id + "/agent"),
    model: $model, thinkingDefault: "off" };
  # An empty list means OpenClaw is using the implicit default agent: keep it explicit.
  (if ($existing | length) == 0 then [ entry("main") + { workspace: "${HOME}/.openclaw/workspace", agentDir: "${HOME}/.openclaw/agents/main/agent" } ] else $existing end) as $base
  | if ($base | map(.id) | index($agent)) then $base else $base + [ entry($agent) ] end')"
if [[ "$(jq -c . <<<"$merged_list")" == "$(jq -c . <<<"$existing_list")" ]]; then
  echo "    - already present — left as-is"
else
  patch_config --argjson list "$merged_list" '{ agents: { list: $list } }'
fi

echo "==> Installing skills into $OPENCLAW_HOME/skills"
mkdir -p "$OPENCLAW_HOME/skills"
cp -rf "$REPO_ROOT/skills"/* "$OPENCLAW_HOME/skills"/

echo "==> Replacing $AGENT_ID persona"
mkdir -p "$OPENCLAW_HOME/agents/$AGENT_ID/workspace" "$OPENCLAW_HOME/agents/$AGENT_ID/agent"
cp -f "$PERSONA_DIR"/*.md "$OPENCLAW_HOME/agents/$AGENT_ID/workspace/"

echo "==> Finalizing the OpenClaw plugin (link + validate + gateway restart)"
bash "$PLUGIN_INSTALL_SH" finalize --openclaw-home "$OPENCLAW_HOME" --plugin-id "$PLUGIN_ID"

echo "==> Waking $AGENT_ID"
openclaw agent -m "hi" --agent "$AGENT_ID" >/dev/null 2>&1 \
  && echo "    - $AGENT_ID ✓" \
  || echo "    ! wakeup failed (retry: openclaw agent -m \"hi\" --agent $AGENT_ID)"

echo
echo "==> Done. $MONITOR_ID alerts go to session agent:$AGENT_ID:$MONITOR_ID via $MCP_URL"
