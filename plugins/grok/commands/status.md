---
description: Show active and recent Grok jobs for this repository
argument-hint: "[job-id] [--all]"
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/grok-companion.mjs" status "$ARGUMENTS"`

If the user did not pass a job ID:
- Render the command output as a compact Markdown table for recent jobs.
- Preserve job ID, kind, status, and summary.

If the user did pass a job ID:
- Present the full command output to the user.
- Do not summarize or condense it.
