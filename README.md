# SutraPad

[![Live Site](https://img.shields.io/badge/live%20site-GitHub%20Pages-c08457?style=for-the-badge)](https://filda.github.io/sutrapad/)
[![Validate and Deploy](https://img.shields.io/github/actions/workflow/status/filda/sutrapad/validate-and-deploy.yml?branch=main&style=for-the-badge&label=validate%20%26%20deploy)](https://github.com/filda/sutrapad/actions/workflows/validate-and-deploy.yml)
[![Daily Mutation Testing](https://img.shields.io/github/actions/workflow/status/filda/sutrapad/mutation-testing.yml?style=for-the-badge&label=mutation%20testing)](https://github.com/filda/sutrapad/actions/workflows/mutation-testing.yml)
[![Repo Activity](https://img.shields.io/github/commit-activity/m/filda/sutrapad?style=for-the-badge&label=repo%20activity)](https://github.com/filda/sutrapad/commits/main)
[![License: MIT](https://img.shields.io/github/license/filda/sutrapad?style=for-the-badge)](LICENSE)

Chaotic Google Drive content renderer and Link Capturer filled with TypeScript AI Slop

Production site:

- [https://filda.github.io/sutrapad/](https://filda.github.io/sutrapad/)

## What It Does

- keeps a notebook of simple text notes
- stores each note as a separate file in your Google Drive
- lets you capture links from the browser
- supports a bookmarklet for desktop browsers
- supports an iPhone/iPad Shortcut for quick sharing

## How To Use It

1. Open the app.
2. Sign in with Google when you want to load or save notes from Drive.
3. Create notes, edit them, and save the notebook.

If you do not sign in yet, you can still type into a local notebook in the browser.

## Save Links Into SutraPad

Inside the app you will find a bookmarklet helper.

Desktop browsers:

- drag `Save to SutraPad` to your bookmarks bar
- open any page
- click the bookmarklet to send that page into a new note

iPhone and iPad:

- [Download `Send_to_Sutrapad.shortcut`](public/Send_to_Sutrapad.shortcut)
- open the file in Safari
- add it to the Shortcuts app
- enable it in the Share Sheet
- use `Share → Send to SutraPad`

## Direct Capture Links

You can also open SutraPad with capture parameters directly:

- link capture:
  - [https://filda.github.io/sutrapad/?url=https%3A%2F%2Fexample.com](https://filda.github.io/sutrapad/?url=https%3A%2F%2Fexample.com)
- text note capture:
  - [https://filda.github.io/sutrapad/?note=Remember%20this](https://filda.github.io/sutrapad/?note=Remember%20this)

## Help

- iPhone Shortcut guide in Czech: [docs/navod-pro-babicku.md](docs/navod-pro-babicku.md)
- iPhone Shortcut guide in English: [docs/grandma-guide.md](docs/grandma-guide.md)

## For Developers

Technical setup and project documentation lives in:

- [docs/development.md](docs/development.md)
- [docs/conventions.md](docs/conventions.md)
