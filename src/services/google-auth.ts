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
  #tokenClient: TokenClient | null = null;

  async initialize(): Promise<void> {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;

    if (!clientId) {
      throw new Error("Missing VITE_GOOGLE_CLIENT_ID in .env.");
    }

    await loadGoogleIdentityScript();

    this.#tokenClient = requireGoogleOAuth().initTokenClient({
      client_id: clientId,
      scope: GOOGLE_SCOPES,
      callback: () => undefined,
    });
  }

  async signIn(): Promise<UserProfile> {
    if (!this.#tokenClient) {
      await this.initialize();
    }

    const response = await new Promise<TokenResponse>((resolve, reject) => {
      this.#tokenClient = requireGoogleOAuth().initTokenClient({
        client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID,
        scope: GOOGLE_SCOPES,
        callback: (tokenResponse) => {
          if (tokenResponse.error) {
            reject(new Error(tokenResponse.error));
            return;
          }

          resolve(tokenResponse);
        },
        error_callback: () => reject(new Error("Google sign-in was cancelled or failed.")),
      });

      this.#tokenClient.requestAccessToken({ prompt: "consent" });
    });

    this.#accessToken = response.access_token;
    const profile = await this.fetchUserProfile(response.access_token);
    this.persistSession(response, profile);
    return profile;
  }

  async refreshSession(): Promise<UserProfile | null> {
    if (!this.#tokenClient) {
      await this.initialize();
    }

    try {
      const token = await new Promise<TokenResponse>((resolve, reject) => {
        this.#tokenClient = requireGoogleOAuth().initTokenClient({
          client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID,
          scope: GOOGLE_SCOPES,
          callback: (tokenResponse) => {
            if (tokenResponse.error) {
              reject(new Error(tokenResponse.error));
              return;
            }

            resolve(tokenResponse);
          },
          error_callback: () => reject(new Error("Unable to refresh the Google session.")),
        });

        this.#tokenClient.requestAccessToken({ prompt: "" });
      });

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

    window.google.accounts.oauth2.revoke(this.#accessToken, () => undefined);
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

    const data = (await response.json()) as UserProfile;
    return {
      name: data.name,
      email: data.email,
      picture: data.picture,
    };
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
