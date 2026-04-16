# Project Conventions

## Language

- Application UI text must be in English.
- Source code, identifiers, and code comments must be in English.
- Repository documentation must be in English.

## Product Direction

- SutraPad is a client-only PWA running in the browser.
- Authentication uses a Google account.
- User data is stored in Google Drive.

## Engineering

- A bugfix is not complete without a test that would fail before the fix and pass after it.
- Prefer small extracted helpers for logic that is otherwise hard to test in UI setup code.
