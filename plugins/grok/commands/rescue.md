---
description: Delegate investigation, fixes, best-of-N, or worktree-isolated work to the Grok rescue subagent
argument-hint: "[--background|--wait] [--resume|--fresh] [--model <model|fast|deep>] [--effort <level>] [--worktree] [--check] [--best-of-n <n>] [task]"
allowed-tools: Bash(node:*), AskUserQuestion, Agent
---

Invoke the `grok:grok-rescue` subagent via the `Agent` tool (`subagent_type: "grok:grok-rescue"`), forwarding the raw user request as the prompt.
`grok:grok-rescue` is a subagent, not a skill — do not call `Skill(grok:grok-rescue)` or `Skill(grok:rescue)`.
The final user-visible response must be Grok's output verbatim.

Raw user request:
$ARGUMENTS

Execution mode:

- If the request includes `--background`, run the `grok:grok-rescue` subagent in the background.
- If the request includes `--wait`, run the `grok:grok-rescue` subagent in the foreground.
- If neither flag is present, default to foreground for small tasks; prefer background for open-ended multi-step work by keeping the Agent call foreground but allowing the subagent to pass `--background` to the companion when appropriate.
- Preserve `--model`, `--effort`, `--worktree`, `--check`, `--best-of-n`, `--resume`, and `--fresh` for the subagent/companion.
- Map model alias `fast` → `grok-composer-2.5-fast`. Alias `deep` keeps `grok-4.5` with high effort.
- If the request includes `--resume` or `--fresh`, do not ask whether to continue.
- Otherwise, before starting Grok, check for a resumable rescue thread:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/grok-companion.mjs" task-resume-candidate --json
```

- If `available: true`, use `AskUserQuestion` once:
  - `Continue current Grok thread`
  - `Start a new Grok thread`
- Put the recommended option first with `(Recommended)`.
- If continue, add `--resume`. If new, add `--fresh`.

Operating rules:

- Return companion stdout verbatim.
- Do not paraphrase.
- If setup is needed, tell the user to run `/grok:setup`.
- If the user did not supply a request, ask what Grok should investigate or fix.
