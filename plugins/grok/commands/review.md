---
description: Run a structured read-only Grok code review (working tree, branch, or PR)
argument-hint: "[--wait|--background] [--base <ref>] [--scope auto|working-tree|branch] [--pr <n>] [focus]"
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Bash(node:*), Bash(git:*), Bash(gh:*), AskUserQuestion
---

Run a structured Grok review through the companion runtime.

Raw slash-command arguments:
`$ARGUMENTS`

Core constraint:
- Review-only. Do not fix issues or apply patches.
- Return Grok's output verbatim.

Execution mode:
- `--wait` → foreground
- `--background` → background Bash
- Otherwise estimate size (`git status` / `git diff --shortstat` / `gh pr diff`) and ask once with `AskUserQuestion`:
  - `Wait for results`
  - `Run in background`
  Recommend background unless clearly tiny (1-2 files).

Foreground:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/grok-companion.mjs" review "$ARGUMENTS"
```

Background:
```typescript
Bash({
  command: `node "${CLAUDE_PLUGIN_ROOT}/scripts/grok-companion.mjs" review --background "$ARGUMENTS"`,
  description: "Grok review",
  run_in_background: true
})
```
Then tell the user to check `/grok:status`.

Notes:
- `--pr <n>` uses GitHub CLI (`gh`) for PR title/body/diff.
- Output is structured (verdict, findings, next steps) when parsing succeeds.
