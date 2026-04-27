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

# tmux pane state probe — distinguishes real stuck from stale session-status.json.
# Claude Code's Stop hook can miss on abnormal turn exit (TLS / 500 / AUP /
# scheduled-task interrupt), leaving state=running forever. We double-check
# the tmux pane: "idle" = just ❯ prompt, "churning" = running an animated
# tool/thinking turn. "unknown" means don't trust either signal.
pane_state_check() {
  local session="$1"
  if ! tmux has-session -t "$session" 2>/dev/null; then
    echo "unknown"
    return
  fi
  local pane
  pane=$(tmux capture-pane -t "$session" -p 2>/dev/null)
  [ -z "$pane" ] && { echo "unknown"; return; }
  if echo "$pane" | tail -6 | grep -qE "^[[:space:]]*[✻✢][[:space:]]+(Churn|Cook|Brew|Work|Think|Compact|Running|Saut|Crunch|Actualiz|Cogit|Ponder|Simmer|Processing|Stew|Grilling|Bak|Roast|Digest)"; then
    echo "churning"
    return
  fi
  if echo "$pane" | tail -6 | grep -qE "^❯[[:space:]]*$"; then
    echo "idle"
    return
  fi
  echo "unknown"
}

lines=()
states_joined=""
any_stuck=0
any_active=0
down_list=()

# Consecutive-stuck escalation: if an agent stays stuck across >=2 back-to-back
# digests (20+ min at the default 10-min cadence), the line promotes from
# 🟥 stuck → 🆘 CRITICAL with a restart suggestion. Count resets on any non-stuck
# outcome (idle / healed / running).
prev_stuck_counts_json="{}"
if [ -f "$ALERT_FILE" ]; then
  prev_stuck_counts_json=$(jq -c '.stuck_counts // {}' "$ALERT_FILE" 2>/dev/null)
  [ -z "$prev_stuck_counts_json" ] && prev_stuck_counts_json="{}"
fi
stuck_counts_entries=()

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

  # Self-heal: if state=running for a while but the tmux pane is idle ❯,
  # Stop hook likely missed (TLS / 500 / AUP abort). Reset the state file
  # and report as idle. If the pane is actively churning we trust the state
  # and leave it as stuck.
  if [ "$computed" = "stuck" ]; then
    pane_state=$(pane_state_check "claude-$name")
    if [ "$pane_state" = "idle" ]; then
      tmp_state=$(mktemp)
      jq --argjson ts "$now" '.state="idle" | .last_stop_ts=$ts' "$state_file" > "$tmp_state" 2>/dev/null \
        && mv "$tmp_state" "$state_file"
      computed=idle
      last_stop=$now
      states_joined+="healed_${name};"
    fi
  fi

  # Escalation counter: increment when stuck, reset otherwise.
  prev_stuck=$(echo "$prev_stuck_counts_json" | jq -r --arg k "$name" '.[$k] // 0')
  [ "$prev_stuck" = "null" ] && prev_stuck=0
  if [ "$computed" = "stuck" ]; then
    stuck_count=$((prev_stuck + 1))
  else
    stuck_count=0
  fi
  stuck_counts_entries+=("\"$name\":$stuck_count")

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
      if [ "$stuck_count" -ge 2 ]; then
        lines+=("🆘 $name · CRITICAL stuck $tool_dur (${stuck_count}× · consider restart)")
      else
        lines+=("🟥 $name · stuck $tool_dur")
      fi
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

# ---------- Claude Code usage section ----------
# Three data sources: (1) live 5h+weekly quota via /status panel scraped from a
# throwaway probe REPL — see scripts/claude-quota-probe.sh for the why; (2)
# active 5h block burn rate + projection from ccusage blocks; (3) today's
# per-agent cost+tokens from ccusage daily. Each source fails independently;
# missing data is silently dropped from the section. Requires `npx` and the
# ccusage npm package (auto-fetched by npx); skipped silently if npx is
# unavailable.
fmt_tokens() {
  local n=$1
  if [ "$n" -ge 1000000 ]; then
    printf '%.1fM' "$(echo "$n / 1000000" | bc -l)"
  elif [ "$n" -ge 1000 ]; then
    printf '%dk' "$((n / 1000))"
  else
    echo "$n"
  fi
}
fmt_cost() {
  printf '$%d' "$(printf '%.0f' "$1")"
}

usage_lines=()

# Quota probe (best-effort).
if [ -x "$SCRIPT_DIR/claude-quota-probe.sh" ]; then
  probe_out=$("$SCRIPT_DIR/claude-quota-probe.sh" 2>/dev/null)
  if [ -n "$probe_out" ] && grep -q "PROBE_OK=1" <<< "$probe_out"; then
    eval "$probe_out"
    reset5_short=$(echo "$QUOTA_5H_RESET" | sed 's/ (.*//')
    resetw_short=$(echo "$QUOTA_WEEKLY_RESET" | sed 's/ (.*//; s/ at .*//')
    usage_lines+=("5h: ${QUOTA_5H_PCT}% (resets $reset5_short)")
    usage_lines+=("week: ${QUOTA_WEEKLY_PCT}% (resets $resetw_short)")
  fi
fi

# Active 5h block burn / projection. Skip if npx missing.
if command -v npx >/dev/null 2>&1; then
  blocks_json=$(npx -y ccusage@latest blocks --json --active 2>/dev/null)
  if [ -n "$blocks_json" ]; then
    block_cost=$(echo "$blocks_json" | jq -r '.blocks[0].costUSD // empty' 2>/dev/null)
    burn_per_h=$(echo "$blocks_json" | jq -r '.blocks[0].burnRate.costPerHour // empty' 2>/dev/null)
    proj_cost=$(echo "$blocks_json" | jq -r '.blocks[0].projection.totalCost // empty' 2>/dev/null)
    rem_min=$(echo "$blocks_json" | jq -r '.blocks[0].projection.remainingMinutes // empty' 2>/dev/null)
    if [ -n "$block_cost" ]; then
      line="block: $(fmt_cost "$block_cost")"
      [ -n "$burn_per_h" ] && line+=" · burn $(fmt_cost "$burn_per_h")/h"
      [ -n "$proj_cost" ] && line+=" · proj $(fmt_cost "$proj_cost")"
      if [ -n "$rem_min" ]; then
        h=$((rem_min / 60))
        m=$((rem_min % 60))
        [ "$h" -gt 0 ] && line+=" (${h}h${m}m left)" || line+=" (${m}m left)"
      fi
      usage_lines+=("$line")
    fi
  fi

  # Today's per-agent breakdown.
  daily_json=$(npx -y ccusage@latest daily --json --since "$(date +%Y%m%d)" -i 2>/dev/null)
  if [ -n "$daily_json" ]; then
    total_cost=$(echo "$daily_json" | jq -r '.totals.totalCost // 0')
    total_tok=$(echo "$daily_json" | jq -r '.totals.totalTokens // 0')
    if [ -n "$total_cost" ] && [ "$total_cost" != "0" ]; then
      usage_lines+=("today: $(fmt_cost "$total_cost") / $(fmt_tokens "$total_tok") tok")
      # Top 3 spenders today.
      top=$(echo "$daily_json" | jq -r '
        .projects | to_entries
        | map({name: .key, cost: ([.value[] | .totalCost] | add // 0)})
        | sort_by(-.cost)
        | .[0:3]
        | .[] | "\(.cost) \(.name)"
      ' 2>/dev/null)
      if [ -n "$top" ]; then
        top_line=""
        # Strip the encoded user/home prefix so the project shows as just its
        # leaf name. Prefix encoding is /a/b/c → -a-b-c, so the last segment
        # after the final '-' is usually meaningful.
        agents_root_enc=$(echo "$AGENTS_ROOT" | sed 's|/|-|g')
        while IFS=' ' read -r c name; do
          [ -z "$c" ] && continue
          short=$(echo "$name" | sed -E "s|^${agents_root_enc}-||; s|^-Users-[^-]+-||; s|^-home-[^-]+-||; s|-$||")
          if [ ${#short} -gt 18 ]; then
            short="${short:0:17}…"
          fi
          [ -n "$top_line" ] && top_line+=" · "
          top_line+="$short $(fmt_cost "$c")"
        done <<< "$top"
        [ -n "$top_line" ] && usage_lines+=("$top_line")
      fi
    fi
  fi
fi

if [ ${#usage_lines[@]} -gt 0 ]; then
  msg+=$'\n'"💰 claude code"$'\n'
  for line in "${usage_lines[@]}"; do
    msg+="$line"$'\n'
  done
fi

if [ "${DRY_RUN:-0}" = "1" ]; then
  echo "=== DRY-RUN: would POST to Telegram ==="
  echo "$msg"
  echo "=== END DRY-RUN ==="
else
  curl -sS -m 10 -X POST "https://api.telegram.org/bot${token}/sendMessage" \
    -d "chat_id=${chat_id}" \
    --data-urlencode "text=${msg}" >/dev/null 2>&1
fi

stuck_counts_json="{$(IFS=,; echo "${stuck_counts_entries[*]}")}"
jq -n \
  --argjson ts "$now" \
  --arg s "$states_joined" \
  --argjson stuck "$stuck_counts_json" \
  '{last_alert_ts:$ts, last_states:$s, stuck_counts:$stuck}' \
  > "$ALERT_FILE"

exit 0
