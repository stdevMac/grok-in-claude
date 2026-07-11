---
name: grok-cli-runtime
description: Internal helper contract for calling the grok-companion runtime from Claude Code
user-invocable: false
---

# Grok Runtime

Use inside `grok:grok-rescue`, `grok:grok-review`, and `grok:grok-media`.

## Concurrency

- **Multiple companion jobs may run at once.** There is no global single-agent lock.
- Prefer `--background` when the parent Claude turn is launching more than one Grok job.
- Each agent instance still makes **exactly one** companion invocation.
- Parallelism = multiple Agent/Bash calls (or multiple subagents), not multiple commands inside one agent.
- When several jobs are running, always pass job ids to `status` / `result` / `cancel`.

## Task (`grok-rescue`)

Primary helper:
- `node "${CLAUDE_PLUGIN_ROOT}/scripts/grok-companion.mjs" task "<args>"`

Rules:
- Exactly one `task` invocation per handoff.
- Return stdout unchanged.
- Map `fast` → `--model grok-composer-2.5-fast`
- Map `deep` → `--model grok-4.5 --effort high`
- `--resume` → `--resume-last` (latest session)
- `--resume-session <id>` → resume that specific Grok session
- `--fresh` → no resume
- Pass `--worktree`, `--check`, `--best-of-n <n>` through when present
- Default write-capable; `--read-only` only when requested
- Do not call setup/status/result/cancel/image/video from the rescue subagent

## Review (`grok-review`)

- `node "${CLAUDE_PLUGIN_ROOT}/scripts/grok-companion.mjs" review ...`
- or `... adversarial-review ...` for design challenges
- Read-only; never apply patches

## Media (`grok-media`)

- `node "${CLAUDE_PLUGIN_ROOT}/scripts/grok-companion.mjs" image ...`
- `node "${CLAUDE_PLUGIN_ROOT}/scripts/grok-companion.mjs" video ...`
