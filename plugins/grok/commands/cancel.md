---
description: Cancel an active background Grok job
argument-hint: "[job-id]"
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/grok-companion.mjs" cancel "$ARGUMENTS"`

When multiple jobs are running, a job id is required. Use `/grok:status` to list them.
