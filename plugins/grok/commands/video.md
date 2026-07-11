---
description: Generate short videos with Grok from prompts, images, or references
argument-hint: "[--background] [--image <path>] [--ref <path>]... [--duration 6|10] [--aspect <ratio>] [prompt]"
allowed-tools: Bash(node:*), Read, Glob
---

Generate a video via Grok.

Raw arguments:
`$ARGUMENTS`

Rules:
- Prefer `--background` for video (renders are slower) unless the user passed `--wait` or an explicit tiny request.
- If neither `--background` nor `--wait` is present, run with `--background` and tell the user to check `/grok:status` / `/grok:result`.
- Return companion stdout verbatim.
- Artifacts are copied into `.grok-media/video/` by the companion (Grok may write session paths first).
- Video resolution is often 480p (Grok model limit).

If running background:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/grok-companion.mjs" video --background $ARGUMENTS
```

If the user explicitly wants to wait:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/grok-companion.mjs" video $ARGUMENTS
```
