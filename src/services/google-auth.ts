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
}

interface TokenClient {
  requestAccessToken: (options?: { prompt?: string }) => void;
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
const GOOGLE_AUTH_SESSION_KEY = "sutrapad-google-auth-session";
const GOOGLE_SCOPES = [
  "openid",
  "profile",
  "email",
  "https://www.googleapis.com/auth/drive.file",
].join(" ");

interface StoredGoogleAuthSession {
  accessToken: string;
  expiresAt: string;
  profile: UserProfile;
  /**
   * ISO timestamp of when this session was last touched — set on
   * sign-in, refresh, and bootstrap. Drives the rolling-window
   * expiry: if a session has been idle for longer than
   * `MAX_IDLE_DAYS_BEFORE_EXPIRY`, `readStoredSession` invalidates
   * it even when `expiresAt` is still nominally valid. Optional in
   * the type so older persisted sessions (written before the field
   * existed) are still parseable; missing values are treated as
   * "fresh now" by the reader to avoid mass-evicting active users
   * on the rollout.
   */
  lastUsedAt?: string;
}

/**
 * Idle-window cap on the persisted session. Even though the access
 * token's `expires_in` is one hour, refresh-on-401 keeps replacing
 * the token in localStorage and the persisted record can otherwise
 * survive on disk indefinitely as long as someone occasionally
 * reopens the app. This rolling cap means the session is wiped
 * automatically after a week of true non-use — limiting the window
 * during which a stale token sits readable on disk after the user
 * has effectively stopped using the app.
 *
 * Active users are unaffected: every bootstrap and every
 * persistSession (sign-in, refresh) bumps `lastUsedAt`, so anyone
 * opening SutraPad even once a week stays signed in. The cap only
 * bites users who set it down for >7 days, and they pay one
 * sign-in click on return — same UX as a stale Google session
 * cookie expiring.
 */
export const MAX_IDLE_DAYS_BEFORE_EXPIRY = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

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
   */
  #refreshPromise: Promise<UserProfile | null> | null = null;
  /** Active storage-event listener for cross-tab sign-out propagation. */
  #storageListener: ((event: StorageEvent) => void) | null = null;

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
   * Single token-request entry point used by both `signIn` (with
   * `prompt: "consent"`) and `refreshSession` (with `prompt: ""`).
   *
   * Google Identity Services binds the response callback into the
   * token client at construction time, so each call has to spin up a
   * fresh `initTokenClient` — there's no public API to swap the
   * callback on an existing client. The earlier code duplicated this
   * setup across two methods; consolidating here keeps the failure
   * shape consistent (same `error_callback` message label, same
   * `tokenResponse.error → Error` mapping) and makes it impossible
   * for the two flows to drift on edge cases like missing
   * `error_callback`.
   *
   * `errorMessage` is what the caller's outer promise rejects with
   * when GIS reports a transport-level failure (popup closed,
   * network error, scope refused). The `tokenResponse.error` path
   * carries Google's own error code which we surface as-is.
   */
  private async requestToken(
    prompt: "consent" | "",
    errorMessage: string,
  ): Promise<TokenResponse> {
    if (!this.#clientId) {
      throw new Error("Google auth has not been initialized.");
    }
    const clientId = this.#clientId;

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
      });
      tokenClient.requestAccessToken({ prompt });
    });
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
    const profile = await this.fetchUserProfile(response.access_token);
    this.persistSession(response, profile);
    return profile;
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
          "",
          "Unable to refresh the Google session.",
        );
        this.#accessToken = token.access_token;
        const profile = await this.fetchUserProfile(token.access_token);
        this.persistSession(token, profile);
        return profile;
      } catch {
        // Eager invalidate: when silent refresh fails, the persisted
        // token is by definition no longer usable — Google has either
        // revoked it (sign-out on another device, security event) or
        // the GIS session cookie is gone (ITP, browser data clear,
        // user signed out of Google entirely). Leaving the dead token
        // on disk would let the next bootstrap pretend it's signed in,
        // hand the stale token to Drive, and surface as a sync-error
        // pulse on first save instead of a clean signed-out state.
        // Wipe both in-memory and persisted copies immediately.
        this.#accessToken = null;
        this.clearStoredSession();
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

  async restorePersistedSession(): Promise<UserProfile | null> {
    const storedSession = this.readStoredSession();
    if (!storedSession) {
      return null;
    }

    this.#accessToken = storedSession.accessToken;
    return storedSession.profile;
  }

  signOut(): void {
    if (!this.#accessToken || !window.google?.accounts?.oauth2) {
      this.clearStoredSession();
      this.#accessToken = null;
      return;
    }

    // Best-effort revoke. We can't synchronously verify the call
    // succeeded — `revoke` is fire-and-forget by design — but a log
    // gives us a paper trail when devtools is open. The user-visible
    // signed-out state is decoupled from revocation: even if revoke
    // fails (offline, Google unreachable), the local session is gone
    // and the persisted token is wiped.
    try {
      window.google.accounts.oauth2.revoke(this.#accessToken, () => undefined);
    } catch (error) {
      console.warn("Google token revoke failed:", error);
    }
    this.clearStoredSession();
    this.#accessToken = null;
  }

  getAccessToken(): string | null {
    return this.#accessToken;
  }

  /**
   * Subscribe to cross-tab sign-out. When another tab on the same
   * origin removes the persisted auth session (sign-out, manual
   * cache wipe, or the storage event fires for any reason that
   * results in `newValue === null` for our key), this tab clears its
   * own in-memory access token and invokes `handler` so the UI can
   * reflect the signed-out state.
   *
   * Returns a teardown function that removes the listener. `app.ts`
   * registers it from the `import.meta.hot.dispose` hook to avoid
   * stacking listeners on HMR reloads — same pattern as
   * `wirePaletteAccess` and `wireKeyboardShortcuts`.
   *
   * Storage events only fire in *other* tabs (not the one that wrote
   * the change), so a sign-out in tab A reaches tab B but not back
   * to tab A — exactly the propagation shape we want.
   *
   * `signIn` from another tab is intentionally NOT propagated here.
   * Re-hydrating a peer tab's signed-in state from a `newValue`
   * payload would require running `restorePersistedSession`-style
   * logic from inside an event handler and would surprise the user
   * who's looking at a "sign in" screen and suddenly sees their
   * notes; sign-in is a deliberate action that should be triggered
   * by the user reloading the tab they want to use.
   */
  subscribeToCrossTabSignOut(handler: () => void): () => void {
    // Defensive teardown — in normal use the caller registers once
    // per service instance, but the HMR-aware app.ts dispose hook
    // can call this twice if the previous registration didn't run.
    this.unsubscribeFromCrossTabSignOut();

    const listener = (event: StorageEvent): void => {
      // Only react to our own session key. Cross-origin storage
      // events don't fire on this listener (browsers only notify
      // same-origin tabs), but other localStorage slots on the same
      // origin do — filter explicitly.
      if (event.key !== GOOGLE_AUTH_SESSION_KEY) return;
      // `newValue === null` means the key was removed (sign-out) or
      // localStorage was cleared. Other transitions (sign-in,
      // refresh-token rotation in another tab) fall through; see
      // method-level comment for rationale.
      if (event.newValue !== null) return;

      this.#accessToken = null;
      handler();
    };

    window.addEventListener("storage", listener);
    this.#storageListener = listener;
    return () => this.unsubscribeFromCrossTabSignOut();
  }

  private unsubscribeFromCrossTabSignOut(): void {
    if (!this.#storageListener) return;
    window.removeEventListener("storage", this.#storageListener);
    this.#storageListener = null;
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

  private persistSession(tokenResponse: TokenResponse, profile: UserProfile): void {
    const expiresAt = new Date(Date.now() + tokenResponse.expires_in * 1000).toISOString();
    window.localStorage.setItem(
      GOOGLE_AUTH_SESSION_KEY,
      JSON.stringify({
        accessToken: tokenResponse.access_token,
        expiresAt,
        profile,
        // Touch on every persist (sign-in, refresh) so the rolling
        // idle window resets while the user is active.
        lastUsedAt: new Date().toISOString(),
      } satisfies StoredGoogleAuthSession),
    );
  }

  private readStoredSession(): StoredGoogleAuthSession | null {
    const rawValue = window.localStorage.getItem(GOOGLE_AUTH_SESSION_KEY);
    if (!rawValue) {
      return null;
    }

    try {
      const session = JSON.parse(rawValue) as StoredGoogleAuthSession;
      if (!session.accessToken || !session.expiresAt || !session.profile?.email || !session.profile?.name) {
        this.clearStoredSession();
        return null;
      }

      if (new Date(session.expiresAt).getTime() <= Date.now()) {
        this.clearStoredSession();
        return null;
      }

      // Rolling idle expiry. Sessions persisted before this field
      // existed have no `lastUsedAt` — treat them as fresh-now so a
      // version-bump rollout doesn't mass-evict every active user.
      // Subsequent `persistSession` calls (sign-in, refresh) write
      // the field for real.
      if (session.lastUsedAt) {
        const idleMs = Date.now() - new Date(session.lastUsedAt).getTime();
        if (idleMs > MAX_IDLE_DAYS_BEFORE_EXPIRY * MS_PER_DAY) {
          this.clearStoredSession();
          return null;
        }
      }

      // Bump `lastUsedAt` on every successful read so an active
      // user's idle clock resets at every bootstrap. Re-write the
      // session so the on-disk timestamp follows reality. The token
      // / expiresAt / profile are untouched — only the heartbeat
      // moves.
      const touched: StoredGoogleAuthSession = {
        ...session,
        lastUsedAt: new Date().toISOString(),
      };
      window.localStorage.setItem(
        GOOGLE_AUTH_SESSION_KEY,
        JSON.stringify(touched),
      );

      return touched;
    } catch {
      this.clearStoredSession();
      return null;
    }
  }

  private clearStoredSession(): void {
    window.localStorage.removeItem(GOOGLE_AUTH_SESSION_KEY);
  }
}
