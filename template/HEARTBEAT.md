# HEARTBEAT.md — Periodic Check-in Instructions

_This file is loaded when a heartbeat cron fires. Keep it terse and action-oriented._

## What to do every heartbeat

1. Check `memory/YYYY-MM-DD.md` for any open loops flagged from earlier turns.
2. Glance at recent `~/.claude/projects/...` activity if multi-agent.
3. Look for calendar events within 2 hours.
4. If nothing needs attention, reply `HEARTBEAT_OK` and stop.

## What NOT to do

- Don't repeat yesterday's tasks unless explicitly flagged.
- Don't ping the user if it's 23:00–08:00 local time (unless urgent).
- Don't generate summaries or reports unprompted — the user can ask for them.

## Reach-out policy

Reach out via Telegram only if:

- An important event/message arrived.
- A calendar event is < 2 hours away and likely un-prepped.
- Something interesting surfaced in background work.
- It's been > 8 hours since any exchange (a soft "still here" is fine).

Otherwise, `HEARTBEAT_OK` and end the turn.
