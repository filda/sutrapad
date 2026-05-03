# SutraPad Agent Notes

## Working Rules

- Read [docs/conventions.md](docs/conventions.md) and [docs/development.md](docs/development.md) before making non-trivial changes.
- A bugfix is not complete without a test that would fail before the fix and pass after it.
- New source files are not done at "tests pass" — they're done when they're under mutation pressure too. Verify the file falls under one of the `mutate:` globs in `stryker.config.mjs`; if it doesn't, add it explicitly in the same change. Pure-data modules (frozen sets/maps, type-only files) get a matching `!` exclusion so they don't drag the score down with meaningless StringLiteral mutants. See [docs/development.md](docs/development.md#run-mutation-testing) for the current mutate scope and the rationale for what's deliberately excluded.
- Prefer small extracted helpers for logic that is otherwise hard to test in UI setup code.
- Verification gate before declaring a task done: run `npm run check` (chains `lint && test && build`, i.e. oxlint + tsc + vitest + vite build). Do not substitute partial runs ("tsc passed elsewhere", "vitest is green in watch"). For truly trivial edits (typo, single-line config tweak) `npm run lint` alone is an acceptable explicit shortcut.
- A task is not finished when `npm run check` goes green. Every non-trivial change then ends with an explicit **cleanup pass**:
  1. Critical code review — re-read the diff as if it were someone else's PR; look for dead code, stale comments, leaked concerns, overly broad types, TODO leftovers.
  2. Refactor candidates — if implementation revealed duplication or awkward abstractions, address them while context is fresh.
  3. Code coverage — check the report for the touched area and cover meaningful gaps.
  4. Mutation testing — check Stryker results; a surviving mutant means a missing assertion, so add it.

## Project Basics

- SutraPad is a client-only PWA running in the browser.
- Authentication uses a Google account.
- User data is stored in Google Drive.

## Language

- Application UI text must be in English.
- Source code, identifiers, and code comments must be in English.
- Repository documentation must be in English.
