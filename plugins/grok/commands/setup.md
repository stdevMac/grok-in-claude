---
description: Check whether the local Grok CLI is installed and authenticated
argument-hint: ""
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
- If ready, mention they can try `/grok:rescue` or `/grok:review`.
