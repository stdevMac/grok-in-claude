---
description: Show the stored final output for a finished Grok job in this repository
argument-hint: "[job-id]"
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/grok-companion.mjs" result "$ARGUMENTS"`

Present the full command output to the user. Do not summarize or condense it. Preserve all details including:
- Job ID and status
- The complete result text
- Grok session ID and resume guidance when present
- Any error messages
- Follow-up commands such as `/grok:status <id>` and `/grok:rescue --resume`
