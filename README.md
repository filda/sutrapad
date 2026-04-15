# SutraPad

Chaotic Google Drive content renderer and Link Capturer filled with TypeScript AI Slop

## Language Policy

- The application UI must be in English.
- Source code, code comments, and repository documentation must be in English.

See [docs/conventions.md](docs/conventions.md) for the project conventions.

## Installation Guide

### Prerequisites

- Node.js 20+ with `npm`
- A Google Cloud project
- A Google account for testing

### 1. Install Dependencies

From the project root:

```bash
npm install
```

If `node` or `npm` is installed but not available in the current PowerShell session, reopen the terminal or prepend Node.js to `PATH` temporarily:

```powershell
$env:Path='C:\Program Files\nodejs;' + $env:Path
```

### 2. Create the Local Environment File

Create `.env` from `.env.example`:

```bash
cp .env.example .env
```

On Windows PowerShell you can also use:

```powershell
Copy-Item .env.example .env
```

Then edit `.env`:

```env
VITE_GOOGLE_CLIENT_ID=your-google-oauth-client-id.apps.googleusercontent.com
VITE_SUTRAPAD_FILE_NAME=sutrapad-data.json
```

### 3. Configure Google Cloud

In Google Cloud Console:

1. Create or open a project.
2. Enable `Google Drive API`.
3. Configure the OAuth consent screen.
4. Create an OAuth client with type `Web application`.

Official references:

- [Enable the Google Drive API](https://developers.google.com/drive/api/guides/enable-sdk)
- [Configure the OAuth consent screen](https://developers.google.com/workspace/guides/configure-oauth-consent)
- [Choose Google Drive API scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
- [Google Identity Services token model for web apps](https://developers.google.com/identity/oauth2/web/guides/use-token-model)
- [Create and manage files in Google Drive](https://developers.google.com/workspace/drive/api/guides/create-file)

Set the OAuth client to include:

- `Authorized JavaScript origins`
  - `http://localhost:5173`
- `Authorized redirect URIs`
  - none is required for the popup token flow used by this app

The app requests these scopes:

- `openid`
- `profile`
- `email`
- `https://www.googleapis.com/auth/drive.file`

Google occasionally moves documentation between `developers.google.com/drive` and `developers.google.com/workspace/drive`. The links above point to the current official guides we are following.

### 4. Start the Development Server

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

### 5. Verify the App

Use this quick test flow:

1. Open the app in the browser.
2. Click `Sign in with Google`.
3. Complete the Google consent flow.
4. Confirm the editor loads with the default note.
5. Edit the title or body.
6. Click `Save to Drive`.
7. Reload the page and click `Load from Drive`.
8. Confirm the saved content is restored.

### 6. Test URL Capture

You can pass a captured URL directly into the app:

- local development: [http://localhost:5173/?url=https%3A%2F%2Fexample.com](http://localhost:5173/?url=https%3A%2F%2Fexample.com)
- production: [https://filda.github.io/sutrapad/?url=https%3A%2F%2Fexample.com](https://filda.github.io/sutrapad/?url=https%3A%2F%2Fexample.com)

Optional query parameters:

- `url` - the captured page URL
- `title` - optional page title passed by a bookmarklet

The app creates a new note, inserts the URL into the note body, and tries to use the provided page title as the note title. If no title is provided, it falls back to a best-effort title derived in the browser.

### 7. Build for Production

```bash
npm run build
```

To preview the production bundle locally:

```bash
npm run preview
```

## Deployment

Production site:

- [https://filda.github.io/sutrapad/](https://filda.github.io/sutrapad/)

GitHub Pages is configured through GitHub Actions and uses the repository subpath `/sutrapad/`.

Manual deployment flow:

1. Push the desired commit to GitHub.
2. Open the repository `Actions` tab.
3. Run the `Deploy to GitHub Pages` workflow manually.
4. Wait for the workflow to finish and then open the production URL above.

GitHub Pages build configuration:

- Add repository variable `VITE_GOOGLE_CLIENT_ID` in `Settings > Secrets and variables > Actions > Variables`.
- The deploy workflow reads this variable during the production build.
- A separate `.env` file is not created in CI; the value is injected directly into the build environment.

## Bookmarklet

The app exposes a bookmarklet link in the UI. Drag `Save to SutraPad` to your bookmarks bar and then click it from any page you want to capture.

For iPhone and iPad, use the Shortcut download:

- [Download `Send_to_Sutrapad.shortcut`](public/Send_to_Sutrapad.shortcut)
- Open the file in Safari on iOS
- Add it to the Shortcuts app
- Enable it in the Share Sheet
- Use `Share → Send to SutraPad`

Compatibility notes:

- Desktop Chrome, Brave, and Opera generally work well with drag-to-bookmarks-bar bookmarklets.
- Desktop Safari supports bookmarklets too, but adding them is often easier by creating a normal bookmark first and then replacing its URL with the bookmarklet code copied from the app.
- On iPhone and iPad, the Shortcut is the recommended capture flow.

## Current Scope

- client-only application with no backend
- PWA foundation powered by `vite-plugin-pwa`
- sign-in with Google Identity Services
- multiple notes stored in Google Drive
- one note per JSON file plus a notebook index file
- a simple note editor with manual load and save actions

## Environment Variables

Create `.env` from `.env.example` and fill in your values:

```bash
cp .env.example .env
```

```env
VITE_GOOGLE_CLIENT_ID=your-google-oauth-client-id.apps.googleusercontent.com
VITE_SUTRAPAD_FILE_NAME=sutrapad-data.json
```

## Google Cloud Console Notes

Create a project in Google Cloud and enable:

1. `Google Drive API`
2. An OAuth client of type `Web application`

Configure the OAuth client with:

- `Authorized JavaScript origins`
  - `http://localhost:5173`
  - your production app domain
- `Authorized redirect URIs`
  - not required for the popup token flow used here

Scopes used by the app:

- `openid`
- `profile`
- `email`
- `https://www.googleapis.com/auth/drive.file`

`drive.file` lets the app work with files it created or explicitly opened.

## Running

After installing Node.js:

```bash
npm install
npm run dev
```

Build:

```bash
npm run build
```

Preview the production build:

```bash
npm run preview
```

## Structure

- `src/services/google-auth.ts` - browser OAuth token flow
- `src/services/drive-store.ts` - notebook index and per-note file storage in Drive
- `src/app.ts` - UI and app state

## Architecture Notes

- Without a backend there are no safe server secrets or refresh tokens.
- The access token only lives in the current browser session.
- Each note is stored as its own JSON file in Google Drive.
- A separate JSON index file keeps the note list and active note selection.
- Production PWA assets and the service worker are generated by `vite-plugin-pwa`.
