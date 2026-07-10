---
description: Locate the latest Claude Code transcript and prepare a handoff into Grok
argument-hint: "[--source <path-to-session.jsonl>]"
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/grok-companion.mjs" transfer $ARGUMENTS`

Present the full output. If an import command is available, show it clearly. If not, explain the transcript path and suggest `/grok:rescue` with a short handoff summary.
