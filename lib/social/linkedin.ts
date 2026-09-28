import "server-only";
import { ValidationError } from "@/lib/errors";
import { AmbiguousPublishError } from "@/lib/social/errors";
import { CAPABILITIES, PROVIDER_LABEL } from "@/lib/social/capabilities";
import { log } from "@/lib/logger";
import type { SocialProvider } from "@/generated/prisma/enums";
import type {
  ProviderAccount,
  PublishInput,
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

/**
 * LinkedIn dates its API and requires the header on every versioned call.
 * Pinned rather than tracking latest: LinkedIn ships breaking changes between
 * versions, and an integration that silently follows them breaks on their
 * schedule instead of ours.
 */
export const LINKEDIN_API_VERSION = "202405";

export type LinkedInOptions = {
  clientId: string;
  clientSecret: string;
  /** Override for tests. Defaults to LinkedIn's own hosts. */
  authBase?: string;
  apiBase?: string;
  /** The versioned REST host. Overridable for the same reason as the others. */
  restBase?: string;
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
  private readonly restBase: string;
  private readonly timeoutMs: number;

  constructor(private readonly options: LinkedInOptions) {
    this.authBase = options.authBase ?? "https://www.linkedin.com/oauth/v2";
    this.apiBase = options.apiBase ?? "https://api.linkedin.com/v2";
    this.restBase = options.restBase ?? "https://api.linkedin.com/rest";
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

  /**
   * Post to the member's feed.
   *
   * Uses the Posts API (`/rest/posts`), which is the one LinkedIn still
   * develops; the older `ugcPosts` endpoint takes a different body shape and is
   * on its way out. Both need the `LinkedIn-Version` header — without it the
   * API answers 426, which reads as a protocol error rather than the "you
   * forgot a header" it actually is.
   *
   * Images are a three-step dance: register an upload, PUT the bytes to the
   * URL LinkedIn hands back, then reference the returned image URN in the post.
   * That is why this does more work than "POST some JSON".
   */
  async publish(
    credentials: ProviderCredentials,
    account: { externalId: string },
    input: PublishInput,
  ): Promise<PublishResult> {
    const author = `urn:li:person:${account.externalId}`;
    const commentary = this.commentary(input);

    if (!commentary && input.media.length === 0) {
      throw new ValidationError("There is nothing to post — no text and no creative.");
    }

    // Upload first. A failure here must happen *before* anything is posted,
    // so a broken creative cannot produce a text-only post nobody asked for.
    const images: string[] = [];
    for (const asset of input.media) {
      images.push(await this.uploadImage(credentials, author, asset.url));
    }

    const body: Record<string, unknown> = {
      author,
      commentary,
      visibility: "PUBLIC",
      distribution: {
        feedDistribution: "MAIN_FEED",
        targetEntities: [],
        thirdPartyDistributionChannels: [],
      },
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false,
    };

    if (images.length === 1) {
      body["content"] = { media: { id: images[0] } };
    } else if (images.length > 1) {
      body["content"] = {
        multiImage: { images: images.map((id) => ({ id })) },
      };
    } else if (input.linkUrl) {
      // An article share. LinkedIn renders its own preview card from the URL.
      body["content"] = { article: { source: input.linkUrl } };
    }

    const response = await this.fetch(`${this.restBase}/posts`, {
      method: "POST",
      headers: this.restHeaders(credentials),
      body: JSON.stringify(body),
    });

    if (!response.ok) throw await this.error(response, "publish a post");

    // The id comes back in a header, not the body — the body is empty on 201.
    const externalPostId =
      response.headers.get("x-restli-id") ?? response.headers.get("x-linkedin-id");
    if (!externalPostId) {
      // Refusing here would be wrong: the post *was* created, and saying
      // otherwise invites a second attempt that would duplicate it.
      linkedinLog.error(
        { status: response.status },
        "linkedin accepted a post but returned no id",
      );
      throw new AmbiguousPublishError(
        "LinkedIn accepted the post but did not say which one it is. Check the page before retrying.",
      );
    }

    return {
      externalPostId,
      externalUrl: `https://www.linkedin.com/feed/update/${externalPostId}`,
    };
  }

  /**
   * The post's text.
   *
   * Hashtags are appended rather than expected inline: the editor stores them
   * separately so each platform can place them the way that platform expects,
   * and on LinkedIn that is the end of the copy.
   */
  private commentary(input: PublishInput): string {
    const parts: string[] = [];
    if (input.headline?.trim()) parts.push(input.headline.trim());
    if (input.caption?.trim()) parts.push(input.caption.trim());

    const tags = input.hashtags.filter((tag) => tag.trim()).map((tag) => `#${tag.trim()}`);
    if (tags.length > 0) parts.push(tags.join(" "));

    // A link with no image and no article card still belongs in the text.
    if (input.linkUrl && input.media.length > 0) parts.push(input.linkUrl);

    return parts.join("\n\n");
  }

  /** Register, upload, and return the image URN to reference in the post. */
  private async uploadImage(
    credentials: ProviderCredentials,
    author: string,
    url: string,
  ): Promise<string> {
    const registered = await this.fetch(`${this.restBase}/images?action=initializeUpload`, {
      method: "POST",
      headers: this.restHeaders(credentials),
      body: JSON.stringify({ initializeUploadRequest: { owner: author } }),
    });

    if (!registered.ok) throw await this.error(registered, "register an image upload");

    const json = (await registered.json()) as {
      value?: { uploadUrl?: unknown; image?: unknown };
    };
    const uploadUrl = typeof json.value?.uploadUrl === "string" ? json.value.uploadUrl : null;
    const imageUrn = typeof json.value?.image === "string" ? json.value.image : null;
    if (!uploadUrl || !imageUrn) {
      throw new ValidationError("LinkedIn did not return somewhere to upload the creative to.");
    }

    // Fetch our own copy and stream it up. The creative lives on R2 behind a
    // public URL; LinkedIn will not pull from it itself.
    const source = await this.fetch(url);
    if (!source.ok) {
      throw new ValidationError("The creative could not be read from storage.");
    }
    const bytes = new Uint8Array(await source.arrayBuffer());

    const uploaded = await this.fetch(uploadUrl, {
      method: "PUT",
      headers: {
        authorization: `Bearer ${credentials.accessToken}`,
        "content-type": source.headers.get("content-type") ?? "application/octet-stream",
      },
      body: bytes,
    });

    if (!uploaded.ok) throw await this.error(uploaded, "upload a creative");
    return imageUrn;
  }

  private restHeaders(credentials: ProviderCredentials): Record<string, string> {
    return {
      authorization: `Bearer ${credentials.accessToken}`,
      "content-type": "application/json",
      // Without this LinkedIn answers 426 Upgrade Required, which does not
      // read like the missing header it is.
      "LinkedIn-Version": LINKEDIN_API_VERSION,
      "X-Restli-Protocol-Version": "2.0.0",
    };
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

