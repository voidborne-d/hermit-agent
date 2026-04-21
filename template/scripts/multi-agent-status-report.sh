#!/bin/bash
# Multi-agent status digest.
#
# Scans every sibling agent directory under a configurable root (defaults to the
# parent of this agent's directory) and reports a per-agent status digest to the
# Telegram chat configured in this agent's settings.local.json.
#
# Per-agent status is derived from:
#   - agent.pid + kill -0 (alive?)
#   - .claude/state/session-status.json (running / idle / stuck)
#   - last_tool_ts / last_user_prompt_ts / last_stop_ts
#
# Cadence:
#   - any state change vs last_alert → push immediately
#   - any stuck agent → push every 10 min (STUCK_COOLDOWN)
#   - otherwise → push every 30 min (NORMAL_COOLDOWN)
#
# Designed to run as a LaunchAgent every 10 minutes. See
# com.hermit-agent.<name>.status-reporter.plist template.
#
# Env overrides:
#   AGENTS_ROOT  — directory to scan for agent folders (default: parent of this script's agent)
#   DRY_RUN=1    — print the digest instead of pushing to Telegram

set -u
export PATH=/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin:$PATH

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HUB_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
HUB_NAME="$(basename "$HUB_DIR")"
: "${AGENTS_ROOT:=$(cd "$HUB_DIR/.." && pwd)}"
ALERT_FILE="$HUB_DIR/.claude/state/multi-agent-alert.json"

STUCK_THRESHOLD_SEC=300
STUCK_COOLDOWN=600
NORMAL_COOLDOWN=1800

mkdir -p "$(dirname "$ALERT_FILE")"

token=$(jq -r '.env.TELEGRAM_BOT_TOKEN // empty' "$HUB_DIR/.claude/settings.local.json" 2>/dev/null)
chat_id=$(jq -r '.env.TELEGRAM_CHAT_ID // empty' "$HUB_DIR/.claude/settings.local.json" 2>/dev/null)
[ -z "$token" ] && exit 0
[ -z "$chat_id" ] && exit 0

now=$(date +%s)

fmt_duration() {
  local s=$1
  if [ "$s" -lt 0 ]; then echo "?"
  elif [ "$s" -lt 60 ]; then echo "${s}s"
  elif [ "$s" -lt 3600 ]; then echo "$((s/60))m"
  else echo "$((s/3600))h$(( (s%3600)/60 ))m"
  fi
}

lines=()
states_joined=""
any_stuck=0
any_active=0
down_list=()

for dir in "$AGENTS_ROOT"/*/; do
  name=$(basename "$dir")
  [ ! -f "$dir/CLAUDE.md" ] && continue

  pid_file="$dir/agent.pid"
  alive=0
  if [ -f "$pid_file" ]; then
    pid=$(cat "$pid_file" 2>/dev/null)
    [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null && alive=1
  fi

  state_file="$dir/.claude/state/session-status.json"

  if [ "$alive" -eq 0 ]; then
    down_list+=("$name")
    states_joined+="$name=down;"
    continue
  fi

  any_active=1

  if [ ! -f "$state_file" ]; then
    lines+=("🔘 $name · no state")
    states_joined+="$name=nostate;"
    continue
  fi

  state=$(jq -r '.state // "idle"' "$state_file" 2>/dev/null)
  last_user=$(jq -r '.last_user_prompt_ts // 0' "$state_file" 2>/dev/null)
  last_tool=$(jq -r '.last_tool_ts // 0' "$state_file" 2>/dev/null)
  last_stop=$(jq -r '.last_stop_ts // 0' "$state_file" 2>/dev/null)

  if [ "$state" = "running" ]; then
    progress_since=$(( now - (last_tool > last_user ? last_tool : last_user) ))
    if [ "$progress_since" -ge "$STUCK_THRESHOLD_SEC" ]; then
      computed=stuck
    else
      computed=running
    fi
  else
    computed=idle
  fi

  case "$computed" in
    idle)
      if [ "$last_stop" -gt 0 ]; then
        dur=$(fmt_duration $((now - last_stop)))
        lines+=("🟢 $name · idle $dur")
      else
        lines+=("🟢 $name · idle")
      fi
      ;;
    running)
      if [ "$last_tool" -ge "$last_user" ]; then
        dur=$(fmt_duration $((now - last_tool)))
      else
        dur=$(fmt_duration $((now - last_user)))
      fi
      lines+=("🟨 $name · running $dur")
      ;;
    stuck)
      tool_dur=$(fmt_duration $((now - last_tool)))
      lines+=("🟥 $name · stuck $tool_dur")
      any_stuck=1
      ;;
  esac

  states_joined+="$name=$computed;"
done

if [ ${#down_list[@]} -gt 0 ]; then
  IFS=','
  lines+=("⚫ ${down_list[*]} · down")
  unset IFS
fi

# Nothing running and nothing down worth reporting → exit silent
[ "$any_active" -eq 0 ] && [ ${#down_list[@]} -eq 0 ] && exit 0

# Cooldown + change detection
last_alert_ts=0
last_states=""
if [ -f "$ALERT_FILE" ]; then
  last_alert_ts=$(jq -r '.last_alert_ts // 0' "$ALERT_FILE" 2>/dev/null)
  last_states=$(jq -r '.last_states // ""' "$ALERT_FILE" 2>/dev/null)
fi

if [ "$any_stuck" -eq 1 ]; then
  cooldown=$STUCK_COOLDOWN
else
  cooldown=$NORMAL_COOLDOWN
fi

should_alert=0
[ "$last_alert_ts" -eq 0 ] && should_alert=1
[ "$last_states" != "$states_joined" ] && should_alert=1
[ $((now - last_alert_ts)) -ge "$cooldown" ] && should_alert=1

if [ "$should_alert" -eq 0 ]; then
  exit 0
fi

# Compose message
msg="📡 agents"$'\n'
for line in "${lines[@]}"; do
  msg+="$line"$'\n'
done

if [ "${DRY_RUN:-0}" = "1" ]; then
  echo "=== DRY-RUN: would POST to Telegram ==="
  echo "$msg"
  echo "=== END DRY-RUN ==="
else
  curl -sS -m 10 -X POST "https://api.telegram.org/bot${token}/sendMessage" \
    -d "chat_id=${chat_id}" \
    --data-urlencode "text=${msg}" >/dev/null 2>&1
fi

jq -n \
  --argjson ts "$now" \
  --arg s "$states_joined" \
  '{last_alert_ts:$ts, last_states:$s}' \
  > "$ALERT_FILE"

exit 0
