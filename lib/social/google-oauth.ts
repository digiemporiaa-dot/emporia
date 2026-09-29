import "server-only";
import { ValidationError } from "@/lib/errors";
import { CredentialsRejectedError } from "@/lib/social/errors";
import type { ProviderCredentials } from "@/lib/social/types";

/**
 * Google's OAuth, shared by the YouTube and Business Profile adapters.
 *
 * Unlike Meta, Google issues a real refresh token — but only when asked for
 * offline access, and reliably only when consent is shown. So every
 * authorisation asks for `access_type=offline` and `prompt=consent`. Without
 * the second, a reconnect after a disconnect comes back with no refresh token
 * and the account dies an hour later.
 *
 * Google's consent screen lets a person **untick individual permissions**.
 * A connection missing the one permission it exists for would look connected
 * and fail at the first post, so the exchange checks what was actually
 * granted and refuses a connection without it.
 *
 * The endpoints are Google's documented, stable ones; the token travels in
 * form bodies and headers, never in a URL.
 */

export const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export type GoogleOAuthConfig = {
  clientId: string;
  clientSecret: string;
  /** Asked for at consent. */
  scopes: readonly string[];
  /** Must be among those granted, or the connection is refused. */
  requiredScopes: readonly string[];
  /** Which product this is for, in messages. */
  label: string;
  authorizeUrl?: string;
  tokenUrl?: string;
};

export function googleAuthorizationUrl(
  config: GoogleOAuthConfig,
  state: string,
  redirectUri: string,
): string {
  const url = new URL(config.authorizeUrl ?? GOOGLE_AUTHORIZE_URL);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", config.scopes.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", state);
  return url.toString();
}

type TokenResponse = {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  scope?: unknown;
  error?: unknown;
};

async function tokenCall(
  config: GoogleOAuthConfig,
  fetcher: Fetch,
  form: Record<string, string>,
): Promise<{ status: number; json: TokenResponse }> {
  const response = await fetcher(config.tokenUrl ?? GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      ...form,
    }).toString(),
  });
  const json = (await response.json().catch(() => ({}))) as TokenResponse;
  return { status: response.status, json };
}

function expiry(json: TokenResponse): Date | null {
  return typeof json.expires_in === "number" ? new Date(Date.now() + json.expires_in * 1000) : null;
}

export async function googleExchangeCode(
  config: GoogleOAuthConfig,
  fetcher: Fetch,
  code: string,
  redirectUri: string,
): Promise<ProviderCredentials> {
  const { status, json } = await tokenCall(config, fetcher, {
    code,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  if (status !== 200 || typeof json.access_token !== "string") {
    throw new ValidationError(`Google refused to connect ${config.label} (${status}).`);
  }

  const granted = new Set(typeof json.scope === "string" ? json.scope.split(" ") : []);
  const missing = config.requiredScopes.filter((scope) => !granted.has(scope));
  if (missing.length > 0) {
    throw new ValidationError(
      `The ${config.label} permission was not granted. Connect again and leave every box ticked on Google's screen.`,
    );
  }

  if (typeof json.refresh_token !== "string" || !json.refresh_token) {
    // Without one the account would die in an hour. Better refused now.
    throw new ValidationError(
      `Google did not grant lasting access to ${config.label}. Remove the app's access in the Google account's security settings, then connect again.`,
    );
  }

  return { accessToken: json.access_token, refreshToken: json.refresh_token, expiresAt: expiry(json) };
}

export async function googleRefresh(
  config: GoogleOAuthConfig,
  fetcher: Fetch,
  credentials: ProviderCredentials,
): Promise<ProviderCredentials> {
  if (!credentials.refreshToken) {
    throw new CredentialsRejectedError(`${config.label} has no lasting access. Reconnect the account.`);
  }
  const { status, json } = await tokenCall(config, fetcher, {
    refresh_token: credentials.refreshToken,
    grant_type: "refresh_token",
  });

  // `invalid_grant`: revoked, the password changed, or — for an app still in
  // Google's "testing" status — seven days passed. All mean reconnect.
  if (json.error === "invalid_grant" || status === 401) {
    throw new CredentialsRejectedError(
      `Google no longer accepts this ${config.label} connection. Reconnect the account.`,
    );
  }
  if (status !== 200 || typeof json.access_token !== "string") {
    throw new ValidationError(`Google refused to renew access to ${config.label} (${status}).`);
  }

  return {
    accessToken: json.access_token,
    // Google usually keeps the refresh token the same and omits it here.
    refreshToken: typeof json.refresh_token === "string" ? json.refresh_token : credentials.refreshToken,
    expiresAt: expiry(json),
  };
}
