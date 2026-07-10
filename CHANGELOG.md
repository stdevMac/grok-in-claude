# Changelog

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
