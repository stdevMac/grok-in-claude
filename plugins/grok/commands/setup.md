---
description: Check whether the Grok CLI is ready and optionally toggle the stop-time review gate
argument-hint: "[--enable-review-gate|--disable-review-gate]"
allowed-tools: Bash(node:*)
---

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/grok-companion.mjs" setup --json $ARGUMENTS
```

Output rules:
- Present the setup output clearly to the user.
- If Grok is missing, tell them how to install/ensure `grok` is on PATH (`~/.grok/bin/grok` is common).
- If Grok is installed but not authenticated, tell them to run `!grok login` or `grok login`.
- If ready, mention they can try `/grok:rescue`, `/grok:review`, `/grok:image`, and `/grok:video`.
- Warn clearly when the stop review gate is enabled: it can create long loops and use a lot of quota.
