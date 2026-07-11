---
description: Steerable adversarial Grok review that challenges design and tradeoffs
argument-hint: "[--wait|--background] [--base <ref>] [--scope auto|working-tree|branch] [--pr <n>] [challenge focus]"
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Bash(node:*), Bash(git:*), Bash(gh:*), AskUserQuestion
---

Run an adversarial Grok review. Do not fix code. Return output verbatim.

Raw arguments:
`$ARGUMENTS`

Same wait/background selection rules as `/grok:review`.

Foreground:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/grok-companion.mjs" adversarial-review "$ARGUMENTS"
```

Background:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/grok-companion.mjs" adversarial-review --background "$ARGUMENTS"
```

Use this when the user wants design challenges, alternative approaches, failure modes, or pressure-testing assumptions — not a nitpick-only review.

May run in parallel with rescue/media jobs. Prefer `--background` when other Grok work is already in flight.
