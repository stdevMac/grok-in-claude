# Grok plugin for Claude Code

Use [Grok](https://grok.com) from inside Claude Code for code reviews or to delegate tasks to the Grok CLI.

Claude stays the orchestrator. A thin companion script hands real work to Grok on your machine via the local CLI.

## What you get

| Command | Purpose |
| --- | --- |
| `/grok:setup` | Check that the Grok CLI is installed and authenticated |
| `/grok:rescue` | Delegate investigation / fixes to Grok (write-capable) |
| `/grok:review` | Read-only Grok review of working tree or branch diff |
| `/grok:status` | List running / recent jobs for this repository |
| `/grok:result` | Show final stored output for a job |
| `/grok:cancel` | Cancel a background job |

After install you should also see the `grok:grok-rescue` subagent in `/agents`. Claude can proactively route substantial debugging or implementation work there.

## Requirements

- **Node.js 18.18 or later**
- **[Grok Build CLI](https://grok.com)** (`grok`) installed and available on your `PATH`
- **Grok authentication** (`grok login`)

Typical CLI location after install: `~/.grok/bin/grok` (ensure that directory is on your `PATH`).

## Install

Add the marketplace in Claude Code:

```text
/plugin marketplace add stdevMac/grok-in-claude
```

Install the plugin:

```text
/plugin install grok@grok-in-claude
```

Reload plugins:

```text
/reload-plugins
```

Then run:

```text
/grok:setup
```

If Grok is installed but not logged in yet:

```text
!grok login
```

After install, you should see:

- the slash commands listed above
- the `grok:grok-rescue` subagent in `/agents`

A simple first run:

```text
/grok:rescue --background summarize this repository in five bullets
/grok:status
/grok:result
```

## Usage

### `/grok:rescue`

Hands a task to Grok through the `grok:grok-rescue` subagent.

```text
/grok:rescue investigate why the tests started failing
/grok:rescue fix the failing test with the smallest safe patch
/grok:rescue --resume apply the top fix from the last run
/grok:rescue --model fast investigate the flaky integration test
/grok:rescue --background investigate the regression
```

You can also ask in natural language:

```text
Ask Grok to redesign the database connection to be more resilient.
```

Notes:

- Default mode is **write-capable** (`grok --yolo`)
- Use read-only mode only when you want diagnosis or research without edits
- `--model fast` maps to `grok-composer-2.5-fast`
- Follow-up rescue requests can continue the latest Grok task session for the repository
- `--background` / `--wait` control whether Claude runs the handoff in the background
- `--resume` / `--fresh` control whether Grok continues the previous task thread

### `/grok:review`

Read-only review of local git state. Does not modify files.

```text
/grok:review
/grok:review --base main
/grok:review --background focus on auth and race conditions
```

### Job control

```text
/grok:status
/grok:status task-abc123
/grok:result
/grok:result task-abc123
/grok:cancel task-abc123
```

## Typical flows

### Review before shipping

```text
/grok:review --base main
```

### Hand a problem to Grok

```text
/grok:rescue investigate why the build is failing in CI
```

### Long-running work

```text
/grok:rescue --background dig into the flaky test and propose a fix
/grok:status
/grok:result
```

## How it works

```text
Claude Code
  └─ Agent(grok:grok-rescue)          # thin Bash forwarder
       └─ node .../grok-companion.mjs task ...
            └─ grok -p ... --output-format json [--yolo | read-only tools]
```

The plugin uses your machine's Grok CLI and authentication. Job metadata is stored under:

```text
~/.grok/claude-plugin/state/<repo-slug-hash>/
```

(or `$CLAUDE_PLUGIN_DATA/state/...` when Claude Code provides a plugin data directory).

Each completed task stores a Grok `sessionId` so you can resume in the Grok TUI:

```bash
grok --resume <session-id>
```

## Companion CLI

Useful when developing or debugging the plugin itself:

```bash
node plugins/grok/scripts/grok-companion.mjs setup
node plugins/grok/scripts/grok-companion.mjs task "summarize this repo in 3 bullets"
node plugins/grok/scripts/grok-companion.mjs review --scope working-tree
node plugins/grok/scripts/grok-companion.mjs status
node plugins/grok/scripts/grok-companion.mjs result
node plugins/grok/scripts/grok-companion.mjs cancel
```

## Configuration

Model defaults and behavior come from your Grok install (`~/.grok/config.toml`) and project rules such as `AGENTS.md` / `CLAUDE.md`.

Optional environment overrides:

| Variable | Meaning |
| --- | --- |
| `GROK_BINARY` | Absolute path to the `grok` binary if it is not on `PATH` |
| `CLAUDE_PLUGIN_DATA` | Provided by Claude Code for plugin-local state |

## FAQ

### Do I need a separate Grok account?

No. The plugin uses the same Grok CLI login already on your machine. Run `/grok:setup` to verify, or `!grok login` if needed.

### Does this run Grok in the cloud through Claude?

No. Claude Code starts your local `grok` process. Work runs in the same repository checkout and environment as your other local tools.

### Will it pick up my existing Grok config?

Yes — user and project Grok configuration apply the same way they do when you run `grok` directly.

## Layout

```text
grok-in-claude/
├── .claude-plugin/marketplace.json
└── plugins/grok/
    ├── .claude-plugin/plugin.json
    ├── agents/grok-rescue.md
    ├── commands/
    ├── skills/
    └── scripts/grok-companion.mjs
```

## Roadmap

- Stop-hook review gate (Claude stop → Grok review)
- Adversarial / steerable review command
- Session transfer from Claude transcript → Grok
- Structured review JSON schema + richer rendering

## License

Apache-2.0
