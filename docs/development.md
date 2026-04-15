# Development Guide

## Language Policy

- The application UI must be in English.
- Source code, code comments, and repository documentation must be in English.

See also [conventions.md](conventions.md).

## Local Development

### Prerequisites

- Node.js 20+ with `npm`
- A Google Cloud project
- A Google account for testing

### Install dependencies

```bash
npm install
```

If `node` or `npm` is installed but not available in the current PowerShell session, reopen the terminal or prepend Node.js to `PATH` temporarily:

```powershell
$env:Path='C:\Program Files\nodejs;' + $env:Path
```

### Create the local environment file

Create `.env` from `.env.example`:

```bash
cp .env.example .env
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Then edit `.env`:

```env
VITE_GOOGLE_CLIENT_ID=your-google-oauth-client-id.apps.googleusercontent.com
VITE_SUTRAPAD_FILE_NAME=sutrapad-data.json
```

### Start the app

```bash
npm run dev
```

The dev server listens on all local interfaces, so you can open it from other devices in your LAN:

- local machine: [http://localhost:5173](http://localhost:5173)
- another device: `http://YOUR-LAN-IP:5173`

### Test PWA features over HTTPS in local development

For full PWA behavior on another device, use a trusted local certificate because service workers require a secure context outside `localhost`.

Add these optional variables to `.env`:

```env
VITE_DEV_HTTPS_KEY_PATH=.cert/dev-key.pem
VITE_DEV_HTTPS_CERT_PATH=.cert/dev-cert.pem
```

Then start the app with the usual command:

```bash
npm run dev
```

If both files exist, Vite serves the app over HTTPS and you can open:

- local machine: `https://localhost:5173`
- another device: `https://YOUR-LAN-IP:5173`

Recommended workflow:

- create a local certificate with `mkcert` for `localhost` and your LAN IP
- trust the generated root CA on the devices you want to test with

If the certificate files are configured but missing, the dev server exits with a clear error.

#### Example setup with mkcert on Windows

1. Install `mkcert`.

If you use `winget`:

```powershell
winget install FiloSottile.mkcert
```

2. Install and trust the local root CA on your development machine:

```powershell
mkcert -install
```

3. Find your LAN IP address.

Example:

```powershell
ipconfig
```

Look for your active adapter and copy the IPv4 address, for example `192.168.1.25`.

4. Generate a certificate for `localhost`, loopback, and your LAN IP:

```powershell
New-Item -ItemType Directory -Force .cert
mkcert -key-file .cert/dev-key.pem -cert-file .cert/dev-cert.pem localhost 127.0.0.1 ::1 192.168.1.25
```

You can also use the helper script, which tries to detect your LAN IP automatically:

```powershell
npm run cert:dev
```

If auto-detection picks the wrong address or cannot find one, pass the IP manually:

```powershell
npm run cert:dev -- 192.168.1.25
```

The script creates `.cert/dev-key.pem` and `.cert/dev-cert.pem` for the selected LAN IP.

5. Add the generated file paths to `.env`:

```env
VITE_DEV_HTTPS_KEY_PATH=.cert/dev-key.pem
VITE_DEV_HTTPS_CERT_PATH=.cert/dev-cert.pem
```

6. Start the dev server:

```bash
npm run dev
```

7. Open the app:

- on your computer: `https://localhost:5173`
- on another device in the same network: `https://192.168.1.25:5173`

#### Trust the certificate on mobile devices

To avoid browser security warnings on phones or tablets, the device must trust the same `mkcert` root CA.

- iPhone/iPad:
  - export the `mkcert` root CA from your computer
  - install it as a profile on the device
  - enable full trust for that certificate in `Settings > General > About > Certificate Trust Settings`
- Android:
  - copy the root CA certificate to the device
  - install it from security certificate settings
  - note that some browsers or work profiles may still apply extra certificate restrictions

If you only need quick UI checks, plain HTTP over LAN is simpler. Use HTTPS when you need realistic PWA behavior such as service worker registration and installability.

### Run checks

```bash
npm run check
```

This runs:

- `npm test`
- `npm run build`

## Google Cloud Setup

In Google Cloud Console:

1. Create or open a project.
2. Enable `Google Drive API`.
3. Configure the OAuth consent screen.
4. Create an OAuth client with type `Web application`.

Set the OAuth client to include:

- `Authorized JavaScript origins`
  - `http://localhost:5173`
  - `https://localhost:5173`
  - `http://YOUR-LAN-IP:5173` when testing over LAN without HTTPS
  - `https://YOUR-LAN-IP:5173` when testing over LAN with HTTPS
  - `https://filda.github.io`
- `Authorized redirect URIs`
  - none is required for the popup token flow used by this app

Notes:

- The OAuth client type must be `Web application`.
- The origin must match exactly, including protocol, host, and port.
- If you switch from `localhost` to a LAN IP such as `192.168.88.40`, that LAN origin must be added explicitly.
- `redirect_uri_mismatch` in this app usually means the current page origin is missing from `Authorized JavaScript origins`, or the wrong OAuth client ID is being used.

Scopes used by the app:

- `openid`
- `profile`
- `email`
- `https://www.googleapis.com/auth/drive.file`

Official references:

- [Enable the Google Drive API](https://developers.google.com/drive/api/guides/enable-sdk)
- [Configure the OAuth consent screen](https://developers.google.com/workspace/guides/configure-oauth-consent)
- [Choose Google Drive API scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
- [Google Identity Services token model for web apps](https://developers.google.com/identity/oauth2/web/guides/use-token-model)
- [Create and manage files in Google Drive](https://developers.google.com/workspace/drive/api/guides/create-file)

## Deployment

Production site:

- [https://filda.github.io/sutrapad/](https://filda.github.io/sutrapad/)

GitHub Pages is configured through GitHub Actions and uses the repository subpath `/sutrapad/`.

### Manual deployment flow

1. Push the desired commit to GitHub.
2. Open the repository `Actions` tab.
3. Run the `Validate and Deploy` workflow manually.
4. Wait for the workflow to finish and then open the production URL above.

### GitHub Pages build configuration

- Add repository variable `VITE_GOOGLE_CLIENT_ID` in `Settings > Secrets and variables > Actions > Variables`.
- The `Validate and Deploy` workflow reads this variable during the production build.
- A separate `.env` file is not created in CI; the value is injected directly into the build environment.

## Capture Features

### Link capture

- local development:
  - [http://localhost:5173/?url=https%3A%2F%2Fexample.com](http://localhost:5173/?url=https%3A%2F%2Fexample.com)
- production:
  - [https://filda.github.io/sutrapad/?url=https%3A%2F%2Fexample.com](https://filda.github.io/sutrapad/?url=https%3A%2F%2Fexample.com)

Optional query parameters:

- `url` - the captured page URL
- `title` - optional page title passed by a bookmarklet

### Text note capture

- [https://filda.github.io/sutrapad/?note=Remember%20this](https://filda.github.io/sutrapad/?note=Remember%20this)

The app can enrich note titles with:

- time-of-day labels such as `early morning` or `high noon`
- reverse geocoded place labels via Nominatim
- cached location labels in `localStorage`

## Bookmarklet And Shortcut

The app exposes a bookmarklet link in the UI.

Compatibility notes:

- Desktop Chrome, Brave, and Opera generally work well with drag-to-bookmarks-bar bookmarklets.
- Desktop Safari supports bookmarklets too, but adding them is often easier by creating a normal bookmark first and then replacing its URL with the copied bookmarklet code.
- On iPhone and iPad, the Shortcut is the recommended capture flow.

## Architecture Notes

- Client-only application with no backend
- PWA foundation powered by `vite-plugin-pwa`
- Sign-in with Google Identity Services
- Multiple notes stored in Google Drive
- One note per JSON file plus a notebook index file
- Each note is stored as its own JSON file in Google Drive
- A separate JSON index file keeps the note list and active note selection
- Production PWA assets and the service worker are generated by `vite-plugin-pwa`
- Location labels are powered by [OpenStreetMap](https://www.openstreetmap.org/) and [Nominatim](https://nominatim.openstreetmap.org/)

## Structure

- `src/services/google-auth.ts` - browser OAuth token flow
- `src/services/drive-store.ts` - notebook index and per-note file storage in Drive
- `src/app.ts` - UI and app state
