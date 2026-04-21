#!/usr/bin/env bash
# Stop hook — two modes:
#
# Mode 1 (Telegram DM): if the current turn started with a Telegram direct-message
#   channel but no mcp__plugin_telegram_telegram__* tool was called, block the stop
#   and remind the agent to reply. Group chats (chat_id != user_id) are skipped.
#
# Mode 2 (Scheduled task ship): if the current turn was triggered by a scheduled
#   task ("Running scheduled task" in the user prompt) AND the agent did any
#   Edit / Write / MultiEdit (= work landed on disk) AND did NOT call a Telegram
#   tool, block the stop. This catches autonomous cycles that shipped changes but
#   forgot to notify the user.
#
# Input  : stdin JSON { session_id, transcript_path, stop_hook_active, ... }
# Output : exit 0 allows stop; exit 2 blocks and sends stderr back to the model.

INPUT="$(cat)"
export INPUT

exec /usr/bin/python3 -c '
import json, os, re, sys

try:
    payload = json.loads(os.environ.get("INPUT", ""))
except Exception:
    sys.exit(0)

if payload.get("stop_hook_active"):
    sys.exit(0)

path = payload.get("transcript_path") or ""
if not path or not os.path.isfile(path):
    sys.exit(0)

try:
    with open(path, "r") as f:
        lines = [json.loads(l) for l in f if l.strip()]
except Exception:
    sys.exit(0)

last_user_idx = None
for i in range(len(lines) - 1, -1, -1):
    if lines[i].get("type") == "user":
        last_user_idx = i
        break

if last_user_idx is None:
    sys.exit(0)

def extract_text(c):
    if isinstance(c, str):
        return c
    if isinstance(c, list):
        parts = []
        for x in c:
            if isinstance(x, dict) and x.get("type") == "text":
                parts.append(x.get("text", ""))
        return "\n".join(parts)
    return ""

utxt = extract_text(lines[last_user_idx].get("message", {}).get("content", ""))

# Classify the trigger
is_tg_dm = False
is_scheduled = False

if "<channel source=\"plugin:telegram:telegram\"" in utxt:
    m_chat = re.search(r"chat_id=\"([^\"]+)\"", utxt)
    m_user = re.search(r"user_id=\"([^\"]+)\"", utxt)
    # Group chat (chat_id != user_id) → skip, silence is valid
    if m_chat and m_user and m_chat.group(1) != m_user.group(1):
        sys.exit(0)
    is_tg_dm = True
elif "Running scheduled task" in utxt:
    is_scheduled = True
else:
    # Neither trigger we care about — allow stop
    sys.exit(0)

# Scan this turn (events after last_user_idx) for TG tool + file-modifying tool
tg_called = False
file_mod_called = False
FILE_MOD_TOOLS = {"Edit", "Write", "MultiEdit", "NotebookEdit"}

for j in range(last_user_idx + 1, len(lines)):
    evt = lines[j]
    if evt.get("type") != "assistant":
        continue
    content = evt.get("message", {}).get("content", [])
    if not isinstance(content, list):
        continue
    for x in content:
        if not isinstance(x, dict) or x.get("type") != "tool_use":
            continue
        name = str(x.get("name", ""))
        if name.startswith("mcp__plugin_telegram_telegram__"):
            tg_called = True
        elif name in FILE_MOD_TOOLS:
            file_mod_called = True

if tg_called:
    sys.exit(0)

if is_tg_dm:
    sys.stderr.write(
        "STOP HOOK: this turn started with a Telegram direct message from the user, "
        "but you did not call any Telegram tool (reply / edit_message / react). "
        "Deliverables must go through the reply tool — transcript text is invisible "
        "to the user. Send a reply now before stopping. "
        "If staying silent is intentional, call react with an emoji to acknowledge.\n"
    )
    sys.exit(2)

# is_scheduled = True
if not file_mod_called:
    # scheduled task with no file changes → HEARTBEAT_OK path, silence is valid
    sys.exit(0)

sys.stderr.write(
    "STOP HOOK: this turn was a scheduled-task cycle AND you wrote/edited files "
    "(shipped changes to disk), but did not call any Telegram tool. The user needs "
    "to know any cycle that landed code — send a one-to-two sentence Telegram reply "
    "with what shipped + concrete metric delta. If the change was wrong and you "
    "intend to revert, revert the files first (the hook treats on-disk changes as "
    "proof of ship).\n"
)
sys.exit(2)
'
