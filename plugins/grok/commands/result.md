---
description: Show the stored final output for a finished Grok job
argument-hint: "[job-id]"
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/grok-companion.mjs" result "$ARGUMENTS"`

Present the full command output. Preserve structured review findings, media artifact paths, session IDs, and follow-up commands.

When multiple jobs are running, pass an explicit job id. Use `/grok:status` if unsure.
