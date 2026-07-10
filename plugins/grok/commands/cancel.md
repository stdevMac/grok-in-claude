---
description: Cancel an active background Grok job
argument-hint: "[job-id]"
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/grok-companion.mjs" cancel "$ARGUMENTS"`
