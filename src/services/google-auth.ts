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
const GOOGLE_SCOPES = [
  "openid",
  "profile",
  "email",
  "https://www.googleapis.com/auth/drive.file",
].join(" ");

let googleScriptPromise: Promise<void> | null = null;

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
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Failed to load Google Identity Services."));
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

    if (!window.google?.accounts?.oauth2) {
      throw new Error("Google OAuth client is not available.");
    }

    this.#tokenClient = window.google.accounts.oauth2.initTokenClient({
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
      this.#tokenClient = window.google!.accounts.oauth2.initTokenClient({
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
    return this.fetchUserProfile(response.access_token);
  }

  async refreshSession(): Promise<UserProfile | null> {
    if (!this.#tokenClient) {
      await this.initialize();
    }

    try {
      const token = await new Promise<TokenResponse>((resolve, reject) => {
        this.#tokenClient = window.google!.accounts.oauth2.initTokenClient({
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
      return await this.fetchUserProfile(token.access_token);
    } catch {
      return null;
    }
  }

  signOut(): void {
    if (!this.#accessToken || !window.google?.accounts?.oauth2) {
      this.#accessToken = null;
      return;
    }

    window.google.accounts.oauth2.revoke(this.#accessToken, () => undefined);
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
}
