import type { UserProfile } from "../types";

declare global {
  interface Window {
    google?: GoogleNamespace;
  }
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  scope: string;
  token_type: string;
  error?: string;
}

interface CodeClientConfig {
  client_id: string;
  scope: string;
  callback: (response: TokenResponse) => void;
  error_callback?: (error: { type: string }) => void;
  /**
   * `login_hint` lets us pre-select the right Google account in the
   * silent refresh flow and the interactive popup. It's a hint, not
   * enforcement — the user can still pick a different account in the
   * popup — but providing it materially improves silent-refresh hit
   * rate (especially on iOS Safari, where Google needs to know which
   * of several signed-in accounts to refresh against without UI).
   */
  hint?: string;
}

interface TokenClient {
  requestAccessToken: (options?: { prompt?: string; hint?: string }) => void;
}

interface GoogleNamespace {
  accounts: {
    oauth2: {
      initTokenClient: (config: CodeClientConfig) => TokenClient;
      revoke: (token: string, done: () => void) => void;
    };
  };
}

const GOOGLE_IDENTITY_SCRIPT = "https://accounts.google.com/gsi/client";

/**
 * `localStorage` keys we still keep around even after dropping the
 * persisted access-token cache. Both are user-experience hints, not
 * credentials:
 *
 *   - `EMAIL_HINT_KEY` — last signed-in email. Passed as
 *     `login_hint` on subsequent silent refreshes and the interactive
 *     popup so Google knows which of multiple signed-in accounts to
 *     refresh against without UI. Cleared on explicit sign-out.
 *
 *   - `IS_LOGGED_IN_KEY` — boolean breadcrumb that we've previously
 *     completed an interactive sign-in. Used by the PWA standalone
 *     fast-path: when iOS PWA + ITP would normally block the silent
 *     refresh iframe, we can show the Sign-In button immediately
 *     instead of waiting on a doomed timeout. Cleared on sign-out;
 *     NOT cleared on silent-refresh failure (a failed refresh on
 *     iOS Safari is normal under ITP and doesn't mean the user has
 *     actually signed out).
 *
 * No access tokens or profile JSON are persisted. Tokens live in
 * memory for the lifetime of the document; on every cold load the
 * service re-runs silent refresh against the long-lived
 * `accounts.google.com` first-party session cookie. See
 * `project_sutrapad_token_storage.md` (auto-memory) for the full
 * trade-off rationale that drove this design.
 */
const EMAIL_HINT_KEY = "sutrapad-user-email-hint";
const IS_LOGGED_IN_KEY = "sutrapad-is-logged-in";

const GOOGLE_SCOPES = [
  "openid",
  "profile",
  "email",
  "https://www.googleapis.com/auth/drive.file",
].join(" ");

/**
 * Validates the shape of a Google `oauth2/v3/userinfo` response.
 * Google guarantees `name` and `email` for the `openid profile email`
 * scope set we request, but the previous `as UserProfile` cast was a
 * TS-level lie: an unexpected shape (Google API change, a proxy
 * intercept, a partial response) would surface as runtime `undefined`s
 * deep in the render layer. Exported so the validation can be tested
 * in isolation, without standing up GIS.
 *
 * Throws when required fields are missing or non-string. Returns a
 * fresh, minimal `UserProfile` so unrelated keys never leak into
 * persisted storage.
 */
export function parseUserInfoResponse(raw: unknown): UserProfile {
  if (!raw || typeof raw !== "object") {
    throw new Error("Google profile response missing required fields.");
  }
  const data = raw as Record<string, unknown>;
  if (typeof data.name !== "string" || data.name.trim() === "") {
    throw new Error("Google profile response missing required fields.");
  }
  if (typeof data.email !== "string" || data.email.trim() === "") {
    throw new Error("Google profile response missing required fields.");
  }
  const picture = typeof data.picture === "string" ? data.picture : undefined;
  return {
    name: data.name,
    email: data.email,
    picture,
  };
}

/**
 * Reads the persisted login hint without coupling consumers to the
 * storage key. Used by the PWA fast-path in `app.ts` (alongside
 * `hasLoggedInHint`) to decide whether to wait for silent refresh or
 * surface the Sign-In button immediately.
 */
export function readEmailHint(): string | null {
  return window.localStorage.getItem(EMAIL_HINT_KEY);
}

/**
 * Boolean read of the "user has previously signed in" breadcrumb.
 * `true` doesn't mean the session is currently valid — silent refresh
 * may still fail. It only means we know the user has interactively
 * signed in at least once on this origin and hasn't explicitly signed
 * out. Used by the iOS PWA fast-path to differentiate "first run"
 * from "ITP-blocked silent refresh on a returning user".
 */
export function hasLoggedInHint(): boolean {
  return window.localStorage.getItem(IS_LOGGED_IN_KEY) === "true";
}

let googleScriptPromise: Promise<void> | null = null;

function requireGoogleOAuth(): GoogleNamespace["accounts"]["oauth2"] {
  if (!window.google?.accounts?.oauth2) {
    throw new Error("Google OAuth client is not available.");
  }
  return window.google.accounts.oauth2;
}

async function loadGoogleIdentityScript(): Promise<void> {
  if (window.google?.accounts?.oauth2) {
    return;
  }

  if (!googleScriptPromise) {
    googleScriptPromise = new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = GOOGLE_IDENTITY_SCRIPT;
      script.async = true;
      script.defer = true;
      script.addEventListener("load", () => resolve());
      script.addEventListener("error", () => reject(new Error("Failed to load Google Identity Services.")));
      document.head.append(script);
    });
  }

  return googleScriptPromise;
}

export class GoogleAuthService {
  #accessToken: string | null = null;
  #clientId: string | null = null;
  /**
   * Memoised initialization promise. Without this, parallel callers
   * (e.g. `signIn()` issued from a button click while
   * `refreshSession()` is already in flight on a 401-driven retry)
   * each see `#clientId === null` and start their own `initialize()`
   * — racing the GIS script load. Idempotent in practice, but
   * wasteful and a code-smell. Reuse the existing promise instead.
   */
  #initPromise: Promise<void> | null = null;
  /**
   * Memoised in-flight refresh promise. A 401 from Drive triggers
   * `withAuthRetry → refreshSession`; if three Drive calls run in
   * parallel and all hit a stale token, all three would today launch
   * their own GIS silent-refresh round-trip. Best case wastes
   * iframes; worst case the parallel attempts race each other and
   * one or two fail with a "popup closed" / "rate limit" error
   * before the winner returns a fresh token. Coalesce to a single
   * in-flight refresh and let every concurrent caller await the same
   * resolution.
   *
   * Also covers the bootstrap-vs-401 race: app startup calls
   * `bootstrap()` (which delegates to `refreshSession()`) and an
   * autosave-fired 401 lands in parallel — both paths share the same
   * in-flight promise rather than each spinning up an iframe.
   */
  #refreshPromise: Promise<UserProfile | null> | null = null;

  async initialize(): Promise<void> {
    if (this.#initPromise) return this.#initPromise;

    this.#initPromise = (async () => {
      const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;

      if (!clientId) {
        throw new Error("Missing VITE_GOOGLE_CLIENT_ID in .env.");
      }

      this.#clientId = clientId;
      await loadGoogleIdentityScript();
    })().catch((error) => {
      // Rejected inits must NOT poison subsequent attempts — clear
      // the cache so a later retry can run a fresh initialize().
      this.#initPromise = null;
      throw error;
    });

    return this.#initPromise;
  }

  /**
   * Single token-request entry point used by `signIn` (with
   * `prompt: "consent"`) and the silent refresh paths
   * (`bootstrap` / `refreshSession`, with `prompt: "none"`).
   *
   * Prompt values:
   *  - `"consent"` — interactive popup, user picks account & confirms
   *    scopes. Used by the explicit Sign-In button.
   *  - `"none"` — strictly silent. No UI ever; if Google needs
   *    consent or account selection, the request fails via
   *    `error_callback` and the caller surfaces signed-out UI. This
   *    is what we want for cold-load bootstrap and 401-driven
   *    refresh — anything else flickers a brief auto-confirm popup
   *    on every page load (the GIS FedCM-style "auto-select" UX),
   *    which feels off for a returning user who's already authorised.
   *
   * Google Identity Services binds the response callback into the
   * token client at construction time, so each call has to spin up a
   * fresh `initTokenClient` — there's no public API to swap the
   * callback on an existing client. Consolidating here keeps the
   * failure shape consistent (same `error_callback` message label,
   * same `tokenResponse.error → Error` mapping) and makes it
   * impossible for the two flows to drift on edge cases like missing
   * `error_callback`.
   *
   * `errorMessage` is what the caller's outer promise rejects with
   * when GIS reports a transport-level failure (popup closed,
   * network error, scope refused). The `tokenResponse.error` path
   * carries Google's own error code which we surface as-is.
   *
   * `login_hint` is read from localStorage if available — it
   * materially improves silent-refresh hit rate by telling Google
   * which of multiple signed-in accounts to refresh against without
   * UI, and pre-selects the right account in the interactive popup.
   * Passing an unknown / stale hint is safe: Google falls back to the
   * default flow, the user sees the picker, life goes on.
   */
  private async requestToken(
    prompt: "consent" | "none",
    errorMessage: string,
  ): Promise<TokenResponse> {
    if (!this.#clientId) {
      throw new Error("Google auth has not been initialized.");
    }
    const clientId = this.#clientId;
    const hint = readEmailHint() ?? undefined;

    return new Promise<TokenResponse>((resolve, reject) => {
      const tokenClient = requireGoogleOAuth().initTokenClient({
        client_id: clientId,
        scope: GOOGLE_SCOPES,
        callback: (tokenResponse) => {
          if (tokenResponse.error) {
            reject(new Error(tokenResponse.error));
            return;
          }
          resolve(tokenResponse);
        },
        error_callback: () => reject(new Error(errorMessage)),
        ...(hint ? { hint } : {}),
      });
      tokenClient.requestAccessToken({ prompt, ...(hint ? { hint } : {}) });
    });
  }

  /**
   * Startup auth probe. Loads the Google Identity Services script
   * (idempotent), attempts a silent token request against the
   * long-lived `accounts.google.com` session cookie, and on success
   * returns the resolved profile so the UI can hydrate as already-
   * signed-in. On failure — no Google session, ITP-blocked iframe,
   * network error — returns `null` and the caller renders the
   * signed-out UI.
   *
   * Mechanically identical to `refreshSession`; semantically distinct
   * because the caller's intent is different (startup hydration vs
   * recovery from a 401). They share the same coalesced
   * `#refreshPromise` so a startup probe and a parallel 401 don't
   * double-launch the iframe.
   */
  async bootstrap(): Promise<UserProfile | null> {
    return this.refreshSession();
  }

  async signIn(): Promise<UserProfile> {
    if (!this.#clientId) {
      await this.initialize();
    }

    const response = await this.requestToken(
      "consent",
      "Google sign-in was cancelled or failed.",
    );
    this.#accessToken = response.access_token;
    try {
      const profile = await this.fetchUserProfile(response.access_token);
      this.recordSignedInHints(profile.email);
      return profile;
    } catch (error) {
      // The token request succeeded but the userinfo follow-up failed
      // (network blip, 403 on profile scope, malformed Google
      // response). Without this catch, `#accessToken` would be set
      // to a working Drive token but no profile would be returned —
      // app.ts treats `profile === null` as "signed out", so the
      // user sees the signed-out UI while the in-memory token sits
      // there orphaned, ready to ride along on any background save.
      // Wipe the same way `refreshSession` does and re-throw so the
      // caller can show the error.
      this.#accessToken = null;
      this.clearSignedInHints();
      throw error;
    }
  }

  async refreshSession(): Promise<UserProfile | null> {
    // Coalesce concurrent refresh attempts. See `#refreshPromise`
    // doc for the rationale.
    if (this.#refreshPromise) return this.#refreshPromise;

    this.#refreshPromise = (async () => {
      if (!this.#clientId) {
        await this.initialize();
      }

      try {
        const token = await this.requestToken(
          "none",
          "Unable to refresh the Google session.",
        );
        this.#accessToken = token.access_token;
        const profile = await this.fetchUserProfile(token.access_token);
        // Refresh the email hint on every successful silent refresh
        // — Google may have rotated which account is "primary" on the
        // session, and a stale hint there could nudge silent refresh
        // toward the wrong account next time. The `is-logged-in` flag
        // is set here too as a defensive write: if it was somehow
        // missing (e.g. cleared by a stale tab), success on a real
        // silent refresh proves the user is in fact signed in.
        this.recordSignedInHints(profile.email);
        return profile;
      } catch {
        // Silent refresh failure is a normal state on iOS Safari with
        // strict ITP — the cross-site iframe to `accounts.google.com`
        // can't read the session cookie and the request fails. We
        // deliberately do NOT clear `IS_LOGGED_IN_KEY` here: that
        // flag exists to remember "user has signed in before" for the
        // PWA fast-path, and a single ITP-driven failure shouldn't
        // erase that. The flag is cleared only on explicit sign-out.
        // The in-memory token IS cleared because by definition we
        // don't have a fresh one.
        this.#accessToken = null;
        return null;
      }
    })().finally(() => {
      // Clear the cache once the in-flight call settles so a later
      // refresh attempt (next 401 round) starts fresh. We don't keep
      // the resolved value cached — refresh is a side-effect-on-state
      // operation, the return value is just a status hand-off.
      this.#refreshPromise = null;
    });

    return this.#refreshPromise;
  }

  signOut(): void {
    if (!this.#accessToken || !window.google?.accounts?.oauth2) {
      this.clearSignedInHints();
      this.#accessToken = null;
      return;
    }

    // Best-effort revoke. We can't synchronously verify the call
    // succeeded — `revoke` is fire-and-forget by design — but a log
    // gives us a paper trail when devtools is open. The user-visible
    // signed-out state is decoupled from revocation: even if revoke
    // fails (offline, Google unreachable), the local session is gone
    // and the persisted hints are wiped.
    try {
      window.google.accounts.oauth2.revoke(this.#accessToken, () => undefined);
    } catch (error) {
      console.warn("Google token revoke failed:", error);
    }
    this.clearSignedInHints();
    this.#accessToken = null;
  }

  getAccessToken(): string | null {
    return this.#accessToken;
  }

  private async fetchUserProfile(accessToken: string): Promise<UserProfile> {
    const response = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      throw new Error("Failed to load the user profile from the Google account.");
    }

    return parseUserInfoResponse(await response.json());
  }

  /**
   * Persists the two non-credential UX hints we keep across sessions.
   * Wrapped in try/catch because localStorage can throw on quota
   * exhaustion or in private-mode contexts where writes are disabled
   * — neither should derail a successful sign-in. The hints are an
   * optimization; if they fail to write, the next bootstrap simply
   * runs without `login_hint` and the PWA fast-path falls through to
   * the regular silent-refresh wait.
   */
  private recordSignedInHints(email: string): void {
    try {
      window.localStorage.setItem(EMAIL_HINT_KEY, email);
      window.localStorage.setItem(IS_LOGGED_IN_KEY, "true");
    } catch (error) {
      console.warn("Failed to persist sign-in hints:", error);
    }
  }

  private clearSignedInHints(): void {
    try {
      window.localStorage.removeItem(EMAIL_HINT_KEY);
      window.localStorage.removeItem(IS_LOGGED_IN_KEY);
    } catch (error) {
      console.warn("Failed to clear sign-in hints:", error);
    }
  }
}
