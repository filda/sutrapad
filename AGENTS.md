# SutraPad Agent Notes

## Working Rules

- Read [docs/conventions.md](docs/conventions.md) and [docs/development.md](docs/development.md) before making non-trivial changes.
- A bugfix is not complete without a test that would fail before the fix and pass after it.
- Prefer small extracted helpers for logic that is otherwise hard to test in UI setup code.
- A task is not finished when tests go green. Every non-trivial change ends with an explicit **cleanup pass**:
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
