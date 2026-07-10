---
name: grok-cli-runtime
description: Internal helper contract for calling the grok-companion runtime from Claude Code
user-invocable: false
---

# Grok Runtime

Use only inside `grok:grok-rescue`.

Primary helper:
- `node "${CLAUDE_PLUGIN_ROOT}/scripts/grok-companion.mjs" task "<args>"`

Rules:
- Exactly one `task` invocation per handoff.
- Return stdout unchanged.
- Map `fast` → `--model grok-composer-2.5-fast`
- Map `deep` → `--model grok-4.5 --effort high`
- `--resume` → `--resume-last`
- `--fresh` → no resume
- Pass `--worktree`, `--check`, `--best-of-n <n>` through when present
- Default write-capable; `--read-only` only when requested
- Do not call setup/review/status/result/cancel/image/video from this subagent
