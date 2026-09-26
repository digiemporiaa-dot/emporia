import "server-only";
import { ValidationError } from "@/lib/errors";
import { CAPABILITIES, PROVIDER_LABEL } from "@/lib/social/capabilities";
import { log } from "@/lib/logger";
import type { SocialProvider } from "@/generated/prisma/enums";
import type {
  ProviderAccount,
  ProviderCredentials,
  ProviderMetrics,
  PublishResult,
  SocialProviderAdapter,
} from "@/lib/social/types";

/**
 * LinkedIn.
 *
 * The first real adapter, and the reason it is first: LinkedIn's OAuth is
 * plain OAuth 2.0 with refresh tokens, and its member profile endpoint is a
 * single OpenID Connect call — so account connection can be built and verified
 * without the page-token dance Meta requires. Instagram and Facebook follow in
 * their own phase precisely because they are not this simple, and pretending
 * otherwise is how an integration ships broken.
 *
 * What this phase implements: the four methods account management needs —
 * `authorizationUrl`, `exchangeCode`, `refresh` and `getAccount`. `publish` and
 * `getMetrics` belong to Phases 6 and 8 and **say so** rather than returning a
 * plausible nothing (CLAUDE.md 2 rule 5).
 *
 * `baseUrl`/`authBase` are injectable so the wire protocol can be exercised
 * end to end against a local double, the same way `lib/ai/anthropic.ts` is
 * tested. The provider code under test is the real one; only the host moves.
 */

const linkedinLog = log("social");

/** The scopes account connection needs. Publishing adds `w_member_social`. */
export const LINKEDIN_SCOPES = ["openid", "profile", "email", "w_member_social"] as const;

export type LinkedInOptions = {
  clientId: string;
  clientSecret: string;
  /** Override for tests. Defaults to LinkedIn's own hosts. */
  authBase?: string;
  apiBase?: string;
  timeoutMs?: number;
};

type TokenResponse = {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
};

type ProfileResponse = {
  sub?: unknown;
  name?: unknown;
  given_name?: unknown;
  family_name?: unknown;
  picture?: unknown;
  email?: unknown;
};

export class LinkedInProvider implements SocialProviderAdapter {
  readonly provider: SocialProvider = "LINKEDIN";
  readonly configured = true;
  readonly capabilities = CAPABILITIES.LINKEDIN;

  private readonly authBase: string;
  private readonly apiBase: string;
  private readonly timeoutMs: number;

  constructor(private readonly options: LinkedInOptions) {
    this.authBase = options.authBase ?? "https://www.linkedin.com/oauth/v2";
    this.apiBase = options.apiBase ?? "https://api.linkedin.com/v2";
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  get label(): string {
    return PROVIDER_LABEL.LINKEDIN;
  }

  authorizationUrl(state: string, redirectUri: string): string {
    const url = new URL(`${this.authBase}/authorization`);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", this.options.clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", state);
    url.searchParams.set("scope", LINKEDIN_SCOPES.join(" "));
    return url.toString();
  }

  async exchangeCode(code: string, redirectUri: string): Promise<ProviderCredentials> {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: this.options.clientId,
      client_secret: this.options.clientSecret,
    });

    return this.token(body, "exchange an authorization code");
  }

  async refresh(credentials: ProviderCredentials): Promise<ProviderCredentials> {
    if (!credentials.refreshToken) {
      // Said plainly: LinkedIn issues refresh tokens only to approved apps, so
      // without one the honest answer is "reconnect", not a silent failure.
      throw new ValidationError(
        "This LinkedIn connection has no refresh token. Reconnect the account.",
      );
    }

    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: credentials.refreshToken,
      client_id: this.options.clientId,
      client_secret: this.options.clientSecret,
    });

    const refreshed = await this.token(body, "refresh a token");
    // A refresh response may omit the refresh token, which means keep the one
    // we hold rather than dropping it and forcing a reconnect next time.
    return { ...refreshed, refreshToken: refreshed.refreshToken ?? credentials.refreshToken };
  }

  async getAccount(credentials: ProviderCredentials): Promise<ProviderAccount> {
    const response = await this.fetch(`${this.apiBase}/userinfo`, {
      headers: { authorization: `Bearer ${credentials.accessToken}` },
    });

    if (!response.ok) {
      throw await this.error(response, "read the LinkedIn profile");
    }

    const profile = (await response.json()) as ProfileResponse;
    const id = typeof profile.sub === "string" ? profile.sub : null;
    if (!id) {
      throw new ValidationError("LinkedIn returned a profile with no id.");
    }

    const name =
      typeof profile.name === "string" && profile.name.trim()
        ? profile.name
        : [profile.given_name, profile.family_name]
            .filter((part): part is string => typeof part === "string" && part.length > 0)
            .join(" ");

    return {
      externalId: id,
      name: name || "LinkedIn member",
      username: null,
      // The member's own page. `sub` is the URN suffix LinkedIn's posting API
      // also takes, so this is stored once and reused at publication.
      profileUrl: "https://www.linkedin.com/in/me",
      avatarUrl: typeof profile.picture === "string" ? profile.picture : null,
      scopes: [...LINKEDIN_SCOPES],
    };
  }

  async publish(): Promise<PublishResult> {
    // Phase 6. Named rather than stubbed: a method that returns a fabricated
    // post id is worse than one that refuses.
    throw new ValidationError(
      "Publishing to LinkedIn is not enabled in this deployment yet.",
    );
  }

  async getMetrics(): Promise<ProviderMetrics> {
    throw new ValidationError(
      "Reading LinkedIn metrics is not enabled in this deployment yet.",
    );
  }

  // -------------------------------------------------------------------------

  private async token(body: URLSearchParams, what: string): Promise<ProviderCredentials> {
    const response = await this.fetch(`${this.authBase}/accessToken`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!response.ok) throw await this.error(response, what);

    const json = (await response.json()) as TokenResponse;
    const accessToken = typeof json.access_token === "string" ? json.access_token : null;
    if (!accessToken) {
      throw new ValidationError("LinkedIn did not return an access token.");
    }

    const expiresIn = typeof json.expires_in === "number" ? json.expires_in : null;

    return {
      accessToken,
      refreshToken: typeof json.refresh_token === "string" ? json.refresh_token : null,
      expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : null,
    };
  }

  private async fetch(url: string, init: RequestInit = {}): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal, cache: "no-store" });
    } catch (cause) {
      // The underlying cause is logged rather than attached: ValidationError's
      // second argument is `details`, which is rendered to the user.
      linkedinLog.error({ err: cause, url }, "linkedin request could not be made");
      throw new ValidationError("LinkedIn could not be reached. Try again in a moment.");
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Turn a provider failure into something an operator can act on.
   *
   * The body is logged, never shown: a token exchange failure can echo the
   * request back, and that request carries the client secret (CLAUDE.md 11).
   */
  private async error(response: Response, what: string): Promise<Error> {
    const detail = await response.text().catch(() => "");
    linkedinLog.error(
      { status: response.status, what, detail: detail.slice(0, 500) },
      "linkedin request failed",
    );

    if (response.status === 401 || response.status === 403) {
      return new ValidationError(
        "LinkedIn rejected the credentials. Reconnect the account to grant access again.",
      );
    }
    if (response.status === 429) {
      return new ValidationError("LinkedIn is rate limiting us. Try again shortly.");
    }
    return new ValidationError(`LinkedIn refused to ${what} (${response.status}).`);
  }
}

