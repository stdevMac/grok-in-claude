# Changelog

## 0.2.3

### Added
- **Concurrent multi-agent support**: multiple Grok jobs may run in parallel (no single-agent lock). Background starts report other running jobs.
- Multi-session task history (`taskSessions`) with `--resume-session <id>` in addition to `--resume-last`.
- Specialized Claude Code agents: `grok:grok-review`, `grok:grok-media` (alongside `grok:grok-rescue`).
- `/grok:rescue` fan-out guidance: spawn multiple Agents in one turn for independent workstreams.
- Ambiguous job errors when `status`/`result`/`cancel` omit a job id while several jobs are running.

### Improved
- `task-resume-candidate` returns session list, running jobs, and `canRunConcurrent: true`.
- Status table highlights parallel running jobs.
- Routing + runtime skills document parallel agent usage.

## 0.2.2

### Fixed
- Media output contract: companion **copies** Grok session artifacts (`~/.grok/sessions/…/images|videos`) into `.grok-media/image|video/` after image/video jobs finish (foreground and background). Prompts no longer require Grok to write into the project while shell/`write_file` are denylisted.
- Failure UX: raw Rust `RequirementError` dumps and similar CLI noise are mapped to short human-readable messages (tool config, auth, rate limits, etc.).

### Docs
- Note Grok video resolution ceiling (often 480p) as a model-tier limit, not a plugin bug.

## 0.2.1

### Fixed
- `/grok:image` and `/grok:video` no longer pass `--tools` allowlists (Grok CLI 0.2.93 fails session create with a `run_terminal_cmd` background-param constraint when allowlists are used). Media mode now uses the default toolset plus `--disallowed-tools run_terminal_cmd,write_file,edit_file,search_replace`, without `--yolo`.
- Read-only review mode also switched from `--tools` allowlist to a denylist for the same CLI bug class.

## 0.2.0

### Added
- Structured code reviews with JSON schema + Markdown rendering
- `/grok:adversarial-review` for steerable design challenges
- `/grok:image` and `/grok:video` media generation (artifacts under `.grok-media/`)
- `/grok:transfer` Claude transcript handoff helper
- Rescue flags: `--worktree`, `--check`, `--best-of-n`
- Model presets: `fast`, `deep`
- PR reviews via `--pr <n>` (GitHub CLI)
- Live progress for background jobs (`/grok:status` phase + log tail)
- Optional stop-time review gate (`/grok:setup --enable-review-gate`)
- Brand/media and routing skills

### Improved
- Setup report shows gate status
- Job storage schema v2 with config block
- README for GitHub-only install and full feature surface

## 0.1.0

- Initial marketplace plugin: setup, rescue, review, status, result, cancel
