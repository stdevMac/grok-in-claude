# Grok plugin for Claude Code

Use [Grok](https://grok.com) from inside Claude Code for code reviews, delegated coding tasks, and image/video generation.

Claude stays the orchestrator. A thin companion script hands real work to Grok on your machine via the local CLI.

## What you get

| Command | Purpose |
| --- | --- |
| `/grok:setup` | Check CLI + auth; toggle optional stop review gate |
| `/grok:rescue` | Delegate investigation / fixes (write-capable) |
| `/grok:review` | Structured read-only review (tree / branch / PR) |
| `/grok:adversarial-review` | Challenge design, tradeoffs, and assumptions |
| `/grok:image` | Generate or edit images → `.grok-media/image/` |
| `/grok:video` | Generate short videos → `.grok-media/video/` |
| `/grok:transfer` | Locate Claude transcript for handoff into Grok |
| `/grok:status` | Jobs + live progress / log tail |
| `/grok:result` | Final stored output for a job |
| `/grok:cancel` | Cancel a background job |

Also available:

- **`grok:grok-rescue` subagent** in `/agents` for proactive delegation
- Skills: brand/media recipes, routing guidance, runtime contracts

## Requirements

- **Node.js 18.18 or later**
- **[Grok Build CLI](https://grok.com)** (`grok`) on your `PATH`
- **Grok authentication** (`grok login`)
- **GitHub CLI (`gh`)** only if you use `/grok:review --pr`

Typical CLI location: `~/.grok/bin/grok` (ensure it is on `PATH`).

## Install

```text
/plugin marketplace add stdevMac/grok-in-claude
/plugin install grok@grok-in-claude
/reload-plugins
/grok:setup
```

If Grok is installed but not logged in:

```text
!grok login
```

After install you should see the slash commands above and `grok:grok-rescue` under `/agents`.

## Quick start

```text
/grok:rescue --background summarize this repository in five bullets
/grok:status
/grok:result

/grok:review --base main
/grok:image --aspect 16:9 Dark minimal banner for a developer tool
/grok:video --background --image ./.grok-media/image/<file>.png gentle camera push-in
```

## Usage

### `/grok:rescue`

```text
/grok:rescue investigate why the tests started failing
/grok:rescue fix the failing test with the smallest safe patch
/grok:rescue --resume apply the top fix from the last run
/grok:rescue --model fast investigate the flaky integration test
/grok:rescue --model deep --effort high redesign the retry layer
/grok:rescue --worktree --check implement the fix and verify
/grok:rescue --best-of-n 3 propose three approaches and pick the best
/grok:rescue --background investigate the regression
```

Natural language also works:

```text
Ask Grok to redesign the database connection to be more resilient.
```

Notes:

- Default mode is **write-capable** (`grok --yolo`)
- `--worktree` isolates edits in a Grok git worktree
- `--check` appends Grok’s self-verification loop
- `--best-of-n <n>` runs parallel attempts (headless) and keeps the best
- `--model fast` → `grok-composer-2.5-fast`; `deep` → `grok-4.5` + high effort
- Follow-ups can continue the latest task session (`--resume`)

### `/grok:review` and `/grok:adversarial-review`

```text
/grok:review
/grok:review --base main
/grok:review --pr 123
/grok:review --background focus on auth and race conditions
/grok:adversarial-review challenge whether this caching design is correct
```

Reviews are read-only and return structured findings when possible:

- verdict
- summary
- findings (severity, file, lines, recommendation)
- next steps

### `/grok:image` / `/grok:video`

```text
/grok:image --aspect 16:9 Hero banner for a dark SaaS landing page
/grok:image --edit ./assets/logo.png monochrome, tighter padding
/grok:video --background --image ./hero.png --duration 6 soft parallax
/grok:video --ref a.png --ref b.png --aspect 16:9 launch cutdown
```

Artifacts default to `.grok-media/` (gitignored). See the **grok-brand-media** skill for recipes.

### Job control

```text
/grok:status
/grok:status task-abc123
/grok:result task-abc123
/grok:cancel task-abc123
```

Background jobs stream progress into status (phase + recent log lines).

### `/grok:transfer`

```text
/grok:transfer
/grok:transfer --source ~/.claude/projects/.../<session>.jsonl
```

Locates the latest Claude Code transcript for this repo and prints import/resume guidance when supported by your Grok CLI.

### Optional stop review gate

```text
/grok:setup --enable-review-gate
/grok:setup --disable-review-gate
```

When enabled, a Stop hook runs a Grok review of local changes and can block stop on critical/high findings.

**Warning:** This can create long Claude↔Grok loops and consume usage quickly. Keep it off unless you are actively monitoring the session.

## How it works

```text
Claude Code
  └─ slash command or Agent(grok:grok-rescue)
       └─ node .../grok-companion.mjs <command>
            └─ grok -p ... --output-format json|streaming-json
```

Job metadata:

```text
~/.grok/claude-plugin/state/<repo-slug-hash>/
```

(or `$CLAUDE_PLUGIN_DATA/state/...` when provided by Claude Code).

Resume a completed Grok session in the TUI:

```bash
grok --resume <session-id>
```

## Security notes

- Rescue defaults to **full tool auto-approval** (`--yolo`). Use `--worktree` for risky changes and `--read-only` for pure diagnosis.
- Reviews are tool-restricted to read-only file inspection.
- Media commands may write files under `.grok-media/` (or `--out`).
- Stop-gate is **opt-in** and may block Claude from stopping a turn.

## Companion CLI (development)

```bash
node plugins/grok/scripts/grok-companion.mjs setup
node plugins/grok/scripts/grok-companion.mjs task --worktree --check "fix the flaky test"
node plugins/grok/scripts/grok-companion.mjs review --pr 12
node plugins/grok/scripts/grok-companion.mjs adversarial-review --base main
node plugins/grok/scripts/grok-companion.mjs image --aspect 1:1 "app icon concept"
node plugins/grok/scripts/grok-companion.mjs video --image ./frame.png "slow pan"
node plugins/grok/scripts/grok-companion.mjs status
```

## Configuration

Uses your local Grok install, auth, `~/.grok/config.toml`, and project rules (`AGENTS.md` / `CLAUDE.md`).

| Variable | Meaning |
| --- | --- |
| `GROK_BINARY` | Absolute path to `grok` if not on `PATH` |
| `CLAUDE_PLUGIN_DATA` | Claude-provided plugin state directory |

## FAQ

### Does this call Grok through Claude’s cloud?

No. Claude starts your local `grok` process in the same checkout and environment.

### Do I need a separate account?

No — same Grok CLI login (`/grok:setup` / `grok login`).

### Will my Grok config apply?

Yes.

## Layout

```text
grok-in-claude/
├── .claude-plugin/marketplace.json
└── plugins/grok/
    ├── agents/
    ├── commands/
    ├── hooks/
    ├── schemas/
    ├── skills/
    └── scripts/grok-companion.mjs
```

## License

Apache-2.0
