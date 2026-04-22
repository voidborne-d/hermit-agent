#!/bin/bash
# hook-tg-strip-markdown.sh — PreToolUse safety net.
#
# Strips markdown syntax from Telegram reply/edit text before it hits the bot.
# Telegram renders plain text by default; raw "**bold**", "# header", "`code`"
# appear as literal noise. AGENTS.md says "no markdown in reply text" but
# agents drift; this hook is the last line of defense.
#
# Skipped when the caller opts into markdownv2 rendering explicitly.

# NOTE: can't use `python3 <<EOF` here — that would pipe the heredoc as python3's
# stdin, clobbering the hook-event JSON we need to read. Pass code via -c.
exec /usr/bin/env python3 -c '
import json, sys, re

try:
    event = json.load(sys.stdin)
except (json.JSONDecodeError, ValueError):
    sys.exit(0)

tool_name = event.get("tool_name", "")
TARGETS = {
    "mcp__plugin_telegram_telegram__reply",
    "mcp__plugin_telegram_telegram__edit_message",
}
if tool_name not in TARGETS:
    sys.exit(0)

tool_input = event.get("tool_input") or {}
text = tool_input.get("text") or ""
if not text:
    sys.exit(0)

# Caller explicitly opted into Telegram MarkdownV2 rendering — leave untouched.
if tool_input.get("format") == "markdownv2":
    sys.exit(0)


def strip_markdown(s):
    # 1. Fenced code blocks ```lang ... ``` — keep the inner content, drop the fences.
    s = re.sub(r"```[a-zA-Z0-9_+-]*\n", "", s)
    s = s.replace("```", "")

    # 2. Inline code `foo` -> foo (single-line, non-greedy).
    s = re.sub(r"`([^`\n]+)`", r"\1", s)

    # 3. Bold **foo** -> foo. Require non-whitespace non-* adjacent chars on both
    #    sides to avoid chewing `**kwargs`-style tokens without a closing pair.
    s = re.sub(r"\*\*([^\s*][^*\n]*?[^\s*]|\S)\*\*", r"\1", s)

    # 4. Bold __foo__ -> foo (same conservative boundary).
    s = re.sub(r"__([^\s_][^_\n]*?[^\s_]|\S)__", r"\1", s)

    # 5. Strikethrough ~~foo~~ -> foo.
    s = re.sub(r"~~([^~\n]+)~~", r"\1", s)

    # 6. Links [text](url) -> text (url). Image links ![alt](url) -> alt (url).
    def link_sub(m):
        label = m.group(1).strip()
        url = m.group(2).strip()
        if not url:
            return label
        if label == url or not label:
            return url
        return label + " (" + url + ")"
    s = re.sub(r"!?\[([^\]\n]*)\]\(([^)\n]+)\)", link_sub, s)

    # 7. ATX headers at line start: "## Heading" -> "Heading".
    s = re.sub(r"^[ \t]*#{1,6}[ \t]+", "", s, flags=re.MULTILINE)

    # 8. Horizontal rules: a line of only --- / *** / ___ -> blank line.
    s = re.sub(r"^[ \t]*[-*_]{3,}[ \t]*$", "", s, flags=re.MULTILINE)

    # 9. Blockquotes: "> foo" -> "foo" (unindented).
    s = re.sub(r"^[ \t]*>[ \t]?", "", s, flags=re.MULTILINE)

    # 10. Collapse triple+ blank lines that arose from strips.
    s = re.sub(r"\n{3,}", "\n\n", s)

    return s


cleaned = strip_markdown(text)
if cleaned == text:
    sys.exit(0)

new_input = dict(tool_input)
new_input["text"] = cleaned

sys.stdout.write(json.dumps({
    "hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "updatedInput": new_input,
    }
}))
sys.stdout.flush()
'
