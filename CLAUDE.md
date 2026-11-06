# Git and secrets rules (for every agent and session working here)

## Secrets
- `TMDB_API_KEY` lives only in the local, gitignored `.env` (project root) or the shell environment. Never write, print, log, paste or commit its value. Never put it in code, docs, commit messages or screenshots.
- Never `git add -f` an ignored file. Stage files by name, or `git add -A` only after `git status` shows no `.env`.
- Posters are fetched on a machine that has the key (`node scrape/posters.mjs`); only the resulting `assets/posters/*.jpg`, `data/posters.json` and `scrape/logs/tmdb-matches.log` are committed. Cloud sessions have no key and must not ask for one in chat.
- A pre-commit hook (`scripts/hooks/pre-commit`) blocks `.env` files and key-shaped strings. Enable it once per clone: `git config core.hooksPath scripts/hooks`.

## Workflow
- `main` is the deployable branch (GitHub Pages). Do work on a short-lived branch (`feat/...`, `fix/...`, `data/...`), then merge or open a PR into `main`.
- Before starting: `git pull --rebase origin main`. Before pushing: pull --rebase again, resolve conflicts, never force-push `main`.
- Small commits, one concern each, imperative subject line. End every commit message with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. PR descriptions end with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- Parallel agents own disjoint files; don't edit a file another agent owns. Regenerated data (`data/showtimes.json`) is committed by one agent at a time, as `data/...` commits.
- Don't commit `node_modules/`, caches or scratch output (see `.gitignore`).
