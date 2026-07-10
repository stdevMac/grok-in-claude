---
description: Generate or edit images with Grok (saves under .grok-media/image)
argument-hint: "[--background] [--edit <path>] [--aspect <ratio>] [--model <id>] [prompt]"
allowed-tools: Bash(node:*), Read, Glob
---

Generate or edit an image via Grok.

Raw arguments:
`$ARGUMENTS`

Rules:
- Default to foreground for simple single-image prompts; use background for complex multi-asset briefs if the user asked or it looks heavy.
- Return companion stdout verbatim (includes artifact paths).
- Do not claim images were created unless paths appear in the output.

Run:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/grok-companion.mjs" image $ARGUMENTS
```

If the user provided no prompt and no `--edit`, ask what to generate.
