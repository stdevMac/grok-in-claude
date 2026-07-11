---
description: Delegate investigation, fixes, best-of-N, or worktree-isolated work to the Grok rescue subagent (supports parallel agents)
argument-hint: "[--background|--wait] [--resume|--resume-session <id>|--fresh] [--model <model|fast|deep>] [--effort <level>] [--worktree] [--check] [--best-of-n <n>] [task]"
allowed-tools: Bash(node:*), AskUserQuestion, Agent
---

Invoke one or more `grok:grok-rescue` subagents via the `Agent` tool (`subagent_type: "grok:grok-rescue"`), forwarding the raw user request as the prompt.
`grok:grok-rescue` is a subagent, not a skill — do not call `Skill(grok:grok-rescue)` or `Skill(grok:rescue)`.
The final user-visible response must include Grok's output (or background job ids) verbatim.

Raw user request:
$ARGUMENTS

## Concurrency (important)

Multiple Grok jobs **can and should** run in parallel when workstreams are independent:

- Fan out by emitting **multiple** `Agent` tool calls in the **same** assistant turn.
- For each parallel agent set `run_in_background: true` on the Agent tool (or pass `--background` so the companion detaches immediately).
- Also safe to run `grok:grok-rescue` alongside `grok:grok-review` / `grok:grok-media` at the same time.
- There is **no** single-agent lock in the companion. Concurrent headless `grok` processes are supported.
- When more than one job is running, always use job ids with `/grok:status`, `/grok:result`, and `/grok:cancel`.

Example: user asks to investigate flaky tests **and** draft a retry redesign → spawn two background `grok:grok-rescue` agents with distinct prompts.

Execution mode:

- If the request includes `--background`, run the `grok:grok-rescue` subagent in the background.
- If the request includes `--wait`, run the `grok:grok-rescue` subagent in the foreground.
- If neither flag is present:
  - Single small task → foreground Agent is fine.
  - Open-ended / multi-step / **parallel fan-out** → background Agent and/or companion `--background`.
- Preserve `--model`, `--effort`, `--worktree`, `--check`, `--best-of-n`, `--resume`, `--resume-session`, and `--fresh` for the subagent/companion.
- Map model alias `fast` → `grok-composer-2.5-fast`. Alias `deep` keeps `grok-4.5` with high effort.
- If the request includes `--resume`, `--resume-session`, or `--fresh`, do not ask whether to continue.
- Otherwise, before starting a **single** Grok thread, check for resumable sessions:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/grok-companion.mjs" task-resume-candidate --json
```

- `canRunConcurrent: true` means other jobs may already be running — do not block starting a new job because of them.
- If `sessions` has multiple entries and the user wants to continue a specific thread, pass `--resume-session <id>` (or ask which session).
- If only one useful session exists (`available: true`), use `AskUserQuestion` once:
  - `Continue current Grok thread` (Recommended when continuing related work)
  - `Start a new Grok thread` (Recommended when the request is unrelated or others may still be running)
- If continue latest → add `--resume`. If continue specific → `--resume-session <id>`. If new → `--fresh`.

Operating rules:

- Return companion stdout verbatim.
- Do not paraphrase.
- If setup is needed, tell the user to run `/grok:setup`.
- If the user did not supply a request, ask what Grok should investigate or fix.
