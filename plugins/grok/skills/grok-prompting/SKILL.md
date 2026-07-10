---
name: grok-prompting
description: Internal guidance for composing clear Grok task prompts from Claude Code rescue handoffs
user-invocable: false
---

# Grok prompting

Use this only to reshape a rescue request into a tighter prompt before the single `task` call.

## Goals

- Keep the user's intent intact.
- Make success criteria explicit.
- Prefer concrete repository actions over vague exploration.

## Prompt shape

When helpful, rewrite into this structure:

1. **Goal** — one sentence
2. **Context** — what already failed / what matters
3. **Constraints** — read-only vs write, no drive-by refactors, test expectations
4. **Done when** — measurable completion checks

## Do

- Preserve file names, error messages, and commands the user mentioned
- Ask Grok to verify with tests/build commands when the task is a fix
- Keep the prompt short enough to scan

## Do not

- Inspect the repository yourself
- Invent stack traces or file paths
- Solve the problem in the prompt
- Add model/effort/resume flags into the natural-language prompt body
