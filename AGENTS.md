# SutraPad Agent Notes

## Working Rules

- Read [docs/conventions.md](docs/conventions.md) and [docs/development.md](docs/development.md) before making non-trivial changes.
- A bugfix is not complete without a test that would fail before the fix and pass after it.
- New source files are not done at "tests pass" — they're done when they're under mutation pressure too. Verify the file falls under one of the `mutate:` globs in `stryker.config.mjs`; if it doesn't, add it explicitly in the same change. Pure-data modules (frozen sets/maps, type-only files) get a matching `!` exclusion so they don't drag the score down with meaningless StringLiteral mutants. See [docs/development.md](docs/development.md#run-mutation-testing) for the current mutate scope and the rationale for what's deliberately excluded.
- Prefer small extracted helpers for logic that is otherwise hard to test in UI setup code.
- Verification gate before declaring a task done: run `npm run check` (chains `lint && test && build`, i.e. oxlint + tsc + vitest + vite build). Do not substitute partial runs ("tsc passed elsewhere", "vitest is green in watch"). For truly trivial edits (typo, single-line config tweak) `npm run lint` alone is an acceptable explicit shortcut.
- A task is not finished when `npm run check` goes green. Every non-trivial change then ends with an explicit **cleanup pass**:
  1. Critical code review — re-read the diff as if it were someone else's PR; look for dead code, stale comments, leaked concerns, overly broad types, TODO leftovers.
  2. Refactor candidates — if implementation revealed duplication or awkward abstractions, address them while the context is fresh.
  3. Code coverage — check the report for the touched area and cover meaningful gaps.
  4. Mutation testing — check Stryker results; a surviving mutant means a missing assertion, so add it.

## Local Dev Environment

- A vite dev server is usually already running on `https://localhost:5173` (HTTPS via `VITE_DEV_HTTPS_*` env vars; see [docs/development.md](docs/development.md)). Don't start a second one — port 5173 will be busy and vite silently steps up to 5174/5175/…, so your preview will hit the **other** server and your edits will look invisible. Before starting any preview server, check `curl -ksI https://localhost:5173/` or ask the user.
- The running server watches the main checkout at `C:\Users\fsubr\workspace\sutrapad`. If Claude Code drops you into a `.claude/worktrees/<name>/` worktree (run `git worktree list` to confirm), edits inside that worktree are **invisible to HMR**. Either apply edits in the main checkout path, or have the user restart their dev server against the worktree. Don't spawn a parallel dev server in the worktree as a workaround — it ends up on a different port and the preview gets pinned to the original origin by HSTS/service worker.

## Project Basics

- SutraPad is a client-only PWA running in the browser.
- Authentication uses a Google account.
- User data is stored in Google Drive.

## Language

- Application UI text must be in English.
- Source code, identifiers, and code comments must be in English.
- Repository documentation must be in English.
