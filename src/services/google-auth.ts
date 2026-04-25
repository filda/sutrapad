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
}

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
      return null;
    }
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

      return session;
    } catch {
      this.clearStoredSession();
      return null;
    }
  }

  private clearStoredSession(): void {
    window.localStorage.removeItem(GOOGLE_AUTH_SESSION_KEY);
  }
}
