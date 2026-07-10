# Grok plugin for Claude Code

Use [Grok](https://grok.com) from inside Claude Code for code reviews or to delegate tasks to the local Grok CLI.

This plugin follows the same idea as [openai/codex-plugin-cc](https://github.com/openai/codex-plugin-cc): Claude stays the orchestrator, and a thin companion script hands real work to another coding agent on your machine.

## What you get

| Command | Purpose |
| --- | --- |
| `/grok:setup` | Check that the Grok CLI is installed and authenticated |
| `/grok:rescue` | Delegate investigation / fixes to Grok (write-capable) |
| `/grok:review` | Read-only Grok review of working tree or branch diff |
| `/grok:status` | List running / recent jobs for this repo |
| `/grok:result` | Show final stored output for a job |
| `/grok:cancel` | Cancel a background job |

After install you should also see the `grok:grok-rescue` subagent in `/agents`. Claude can proactively route substantial debugging or implementation work there.

## Requirements

- **Node.js 18.18+**
- **Grok Build CLI** (`grok`) installed and on your `PATH`
- **Grok authentication** (`grok login`)

On this machine the CLI usually lives at `~/.grok/bin/grok`.

## Install

From Claude Code, add this marketplace (local path or GitHub once published):

From a local checkout:

```text
/plugin marketplace add ~/stdevMac/grok-in-claude
```

Or from GitHub:

```text
/plugin marketplace add stdevMac/grok-in-claude
```

Install the plugin:

```text
/plugin install grok@grok-in-claude
```

Reload:

```text
/reload-plugins
```

Then run:

```text
/grok:setup
```

If Grok is installed but not logged in:

```text
!grok login
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
- Pass `--read-only` (via the companion / subagent) for diagnosis without edits
- `--model fast` maps to `grok-composer-2.5-fast`
- Follow-up rescue requests can continue the latest Grok task session in the repo

### `/grok:review`

Read-only review of local git state.

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
  └─ Agent(grok:grok-rescue)   # thin Bash forwarder
       └─ node plugins/grok/scripts/grok-companion.mjs task ...
            └─ grok -p ... --output-format json [--yolo | --tools read-only]
```

Job metadata is stored under:

```text
~/.grok/claude-plugin/state/<repo-slug-hash>/
```

(or `$CLAUDE_PLUGIN_DATA/state/...` when Claude provides plugin data dirs).

Each completed task stores a Grok `sessionId` so you can resume in the Grok TUI:

```bash
grok --resume <session-id>
```

## Companion CLI

You can call the companion directly for debugging:

```bash
node plugins/grok/scripts/grok-companion.mjs setup
node plugins/grok/scripts/grok-companion.mjs task --write "summarize this repo in 3 bullets"
node plugins/grok/scripts/grok-companion.mjs review --scope working-tree
node plugins/grok/scripts/grok-companion.mjs status
node plugins/grok/scripts/grok-companion.mjs result
node plugins/grok/scripts/grok-companion.mjs cancel
```

## Configuration

The plugin uses your local Grok install and auth. Model defaults come from Grok (`~/.grok/config.toml` and project rules such as `AGENTS.md` / `CLAUDE.md`).

Optional environment overrides:

| Variable | Meaning |
| --- | --- |
| `GROK_BINARY` | Absolute path to the `grok` binary |
| `CLAUDE_PLUGIN_DATA` | Provided by Claude Code for plugin-local state |

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
