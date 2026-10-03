import "server-only";
import { createPrivateKey, sign } from "node:crypto";
import { SeoCredentialsError, SeoProviderError } from "@/lib/seo-intel/providers/errors";

/**
 * Google service-account access tokens (the OAuth 2.0 JWT bearer grant).
 *
 * The agency keeps one service account; a client adds its address as a user
 * on their Search Console or GA4 property, and from then on Emporia reads with
 * a token it mints itself — a JWT signed with the account's private key,
 * exchanged at Google's token endpoint for an hour-long access token. No
 * Google library: the grant is three fields and an RS256 signature.
 *
 * Tokens are cached in memory until a minute before they expire. The private
 * key never leaves this process and is never logged.
 */

export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export type ServiceAccountKey = { email: string; keyId: string | null; privateKey: string };

const b64url = (value: string | Buffer) => Buffer.from(value).toString("base64url");

/** The signed assertion. Exported for tests, which verify it with the public key. */
export function serviceAccountAssertion(key: ServiceAccountKey, scopes: readonly string[], nowSeconds: number, audience = GOOGLE_TOKEN_URL): string {
  const header = { alg: "RS256", typ: "JWT", ...(key.keyId ? { kid: key.keyId } : {}) };
  const claims = { iss: key.email, scope: scopes.join(" "), aud: audience, iat: nowSeconds, exp: nowSeconds + 3600 };
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const signature = sign("RSA-SHA256", Buffer.from(unsigned), createPrivateKey(key.privateKey));
  return `${unsigned}.${b64url(signature)}`;
}

/**
 * What an uploaded key file must contain. Throws a readable message rather
 * than accepting something that would fail at the first sync.
 */
export function parseServiceAccountJson(raw: string): ServiceAccountKey {
  let json: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") throw new Error("not an object");
    json = parsed as Record<string, unknown>;
  } catch {
    throw new Error("That is not a service account key file. Paste the whole JSON file Google gave you.");
  }
  if (json["type"] !== "service_account") throw new Error("That JSON is not a service account key (its type is not service_account).");
  const email = json["client_email"];
  const privateKey = json["private_key"];
  if (typeof email !== "string" || !/^[^@\s]+@[^@\s]+\.iam\.gserviceaccount\.com$/.test(email)) {
    throw new Error("The key file has no service account address (client_email).");
  }
  if (typeof privateKey !== "string" || !privateKey.includes("PRIVATE KEY")) {
    throw new Error("The key file has no private key.");
  }
  try {
    const key = createPrivateKey(privateKey);
    if (key.asymmetricKeyType !== "rsa") throw new Error("not rsa");
  } catch {
    throw new Error("The private key in that file could not be read.");
  }
  const keyId = typeof json["private_key_id"] === "string" ? json["private_key_id"] : null;
  return { email, keyId, privateKey };
}

const cache = new Map<string, { token: string; expiresAt: number }>();

/** Test seam. */
export function clearServiceAccountTokens(): void {
  cache.clear();
}

export async function serviceAccountToken(
  key: ServiceAccountKey,
  scopes: readonly string[],
  fetcher: Fetch = fetch,
  tokenUrl: string = GOOGLE_TOKEN_URL,
): Promise<string> {
  const cacheKey = `${key.email}|${key.keyId ?? ""}|${[...scopes].sort().join(" ")}`;
  const hit = cache.get(cacheKey);
  if (hit && hit.expiresAt > Date.now() + 60_000) return hit.token;

  const assertion = serviceAccountAssertion(key, scopes, Math.floor(Date.now() / 1000), tokenUrl);
  let response: Response;
  try {
    response = await fetcher(tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new SeoProviderError("Google's sign-in service could not be reached. The next sync will try again.");
  }
  const json = (await response.json().catch(() => ({}))) as { access_token?: unknown; expires_in?: unknown; error?: unknown };
  if (response.status === 400 || response.status === 401) {
    // invalid_grant: the key was deleted or disabled, or the clock is badly off.
    throw new SeoCredentialsError("Google refused the service account key. It may have been deleted or disabled — upload a new key in SEO settings.");
  }
  if (!response.ok || typeof json.access_token !== "string") {
    throw new SeoProviderError(`Google's sign-in service answered ${response.status}. The next sync will try again.`);
  }
  const ttl = typeof json.expires_in === "number" ? json.expires_in : 3600;
  cache.set(cacheKey, { token: json.access_token, expiresAt: Date.now() + ttl * 1000 });
  return json.access_token;
}
