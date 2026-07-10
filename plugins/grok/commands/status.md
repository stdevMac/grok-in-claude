---
description: Show active and recent Grok jobs with live progress when available
argument-hint: "[job-id] [--all]"
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/grok-companion.mjs" status "$ARGUMENTS"`

If no job ID:
- Keep a compact table (job, kind, status, progress, summary).

If a job ID is present:
- Show full details including progress phase/message and recent log tail.
- Do not condense the output.
