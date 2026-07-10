---
name: grok-routing
description: When Claude Code should delegate to Grok vs handle work itself
user-invocable: false
---

# When to call Grok

## Prefer Grok (`grok:grok-rescue` or slash commands)

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
