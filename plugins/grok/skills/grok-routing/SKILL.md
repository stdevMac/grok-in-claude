---
name: grok-routing
description: When Claude Code should delegate to Grok vs handle work itself
user-invocable: false
---

# When to call Grok

## Prefer Grok (`grok:*` agents or slash commands)

- Substantial debugging after Claude is stuck
- Second-opinion implementation of a non-trivial change
- Best-of-N alternative approaches (`--best-of-n`)
- Risky edits that should land in a worktree (`--worktree`)
- Image/video generation (`/grok:image`, `/grok:video`)
- Structured or adversarial code review before shipping
- Long-running investigation better as a background job

## Prefer staying in Claude

- Quick questions, renames, one-line fixes
- Tiny edits with obvious answers
- Pure conversation / planning without repo mutation

## Parallel agents

When workstreams are independent, **run multiple Grok agents at once**:

| Need | Agent / command |
| --- | --- |
| Fix / investigate | `grok:grok-rescue` or `/grok:rescue` |
| Review | `grok:grok-review` or `/grok:review` |
| Image / video | `grok:grok-media` or `/grok:image` / `/grok:video` |

How:

1. Split into independent prompts.
2. Spawn multiple `Agent` tool calls in the **same** turn with `run_in_background: true`, **or** multiple companion Bash calls with `--background`.
3. Track each job id via `/grok:status`.
4. Collect results with `/grok:result <job-id>`.

Do **not** serialize independent Grok work just because another job is running.

## Command map

| Need | Command |
| --- | --- |
| Fix / investigate | `/grok:rescue` |
| Review | `/grok:review` |
| Challenge design | `/grok:adversarial-review` |
| Image | `/grok:image` |
| Video | `/grok:video` |
| Progress | `/grok:status` |
| Output | `/grok:result` |
| Handoff transcript | `/grok:transfer` |
