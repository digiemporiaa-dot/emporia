import "server-only";
import { ValidationError } from "@/lib/errors";
import {
  AmbiguousPublishError,
  CredentialsRejectedError,
  ProviderUnreachableError,
} from "@/lib/social/errors";
import { CAPABILITIES, PROVIDER_LABEL } from "@/lib/social/capabilities";
import { log } from "@/lib/logger";
import type { SocialProvider } from "@/generated/prisma/enums";
import type {
  ProviderAccount,
  ProviderCredentials,
  ProviderMetrics,
  PublishInput,
  PublishResult,
  SocialProviderAdapter,
} from "@/lib/social/types";

/**
 * Instagram, through the Instagram API with Instagram Login.
 *
 * ## Why this login, not Facebook Login
 *
 * Meta offers two ways in. Facebook Login reaches an Instagram account through
 * the Facebook Page it is linked to — the "page-token dance" that kept
 * Instagram behind LinkedIn in Phase 2. Instagram Login (July 2024) connects
 * the professional account directly, with tokens against `graph.instagram.com`
 * and no Page in the path. Same publishing API, far fewer ways to fail.
 *
 * ## How publishing works, and where the one dangerous call is
 *
 * Instagram does not take uploads. It fetches the creative from a public URL,
 * so publishing is:
 *
 *  1. create a **container** for each creative (and, for a carousel, a parent
 *     container listing the children);
 *  2. for video, wait until Instagram has finished processing it;
 *  3. **publish** the container.
 *
 * Steps 1 and 2 are safe to repeat: an unpublished container is invisible and
 * expires on its own. Step 3 is the only call that puts something on a
 * client's feed, so it is the only one where a timeout or a gateway timeout
 * means "it may be live" — and is raised as `AmbiguousPublishError`, exactly
 * as LinkedIn's create call is.
 *
 * ## What it refuses before calling anything
 *
 * A personal account (the API cannot publish to one), a non-JPEG image
 * (Instagram accepts no other image format), a carousel outside 2–10 items,
 * more than 30 hashtags. Each would fail at Instagram anyway; failing here
 * says why, and happens before any container is made.
 *
 * ## Checked against
 *
 * Meta's developer site is not reachable from where this was built, so the
 * protocol was taken from a working implementation of the same login, and the
 * adapter is exercised end to end against a local wire double
 * (`tests/support/instagram-double.ts`). It has not been run against a real
 * Instagram account. `INSTAGRAM_API_VERSION` is one constant; confirm it
 * against Meta's changelog before going live.
 */

const instagramLog = log("social");

/**
 * Pinned rather than tracking latest, for the same reason LinkedIn's is: Meta
 * ships breaking changes between versions, and following them silently means
 * breaking on their schedule. Meta supports a version for about two years.
 */
export const INSTAGRAM_API_VERSION = "v24.0";

/** Publishing, reading the account, comments, and insights. */
export const INSTAGRAM_SCOPES = [
  "instagram_business_basic",
  "instagram_business_content_publish",
  "instagram_business_manage_comments",
  "instagram_business_manage_insights",
] as const;

/** Instagram's own limits. Checked before a container is made. */
const MAX_HASHTAGS = 30;
const CAROUSEL_MIN = 2;
const CAROUSEL_MAX = 10;
const VIDEO_TYPES = new Set(["video/mp4", "video/quicktime"]);

export type InstagramOptions = {
  clientId: string;
  clientSecret: string;
  /** Overrides for tests. Default to Instagram's own hosts. */
  authorizeBase?: string;
  authBase?: string;
  graphBase?: string;
  timeoutMs?: number;
  /** How often, and for how long, to wait on a video that is processing. */
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
};

type GraphError = { error?: { message?: unknown; code?: unknown; error_subcode?: unknown } };

export class InstagramProvider implements SocialProviderAdapter {
  readonly provider: SocialProvider = "INSTAGRAM";
  readonly configured = true;
  readonly capabilities = CAPABILITIES.INSTAGRAM;
  /** Long-lived tokens are extended by presenting themselves; no refresh token exists. */
  readonly refreshesWithAccessToken = true;

  private readonly authorizeBase: string;
  private readonly authBase: string;
  private readonly graph: string;
  private readonly graphRoot: string;
  private readonly timeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly pollTimeoutMs: number;

  constructor(private readonly options: InstagramOptions) {
    this.authorizeBase = options.authorizeBase ?? "https://www.instagram.com";
    this.authBase = options.authBase ?? "https://api.instagram.com";
    this.graphRoot = options.graphBase ?? "https://graph.instagram.com";
    this.graph = `${this.graphRoot}/${INSTAGRAM_API_VERSION}`;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.pollIntervalMs = options.pollIntervalMs ?? 3_000;
    // Bounded so one slow video cannot hold a cron run hostage. A video that
    // is still processing when this runs out is simply tried again next run —
    // nothing was published, so nothing can be duplicated.
    this.pollTimeoutMs = options.pollTimeoutMs ?? 60_000;
  }

  get label(): string {
    return PROVIDER_LABEL.INSTAGRAM;
  }

  // -------------------------------------------------------------------------
  // Connection
  // -------------------------------------------------------------------------

  authorizationUrl(state: string, redirectUri: string): string {
    const url = new URL(`${this.authorizeBase}/oauth/authorize`);
    url.searchParams.set("client_id", this.options.clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", INSTAGRAM_SCOPES.join(","));
    url.searchParams.set("state", state);
    return url.toString();
  }

  /**
   * Code → short-lived token (an hour) → long-lived token (sixty days).
   *
   * Only the long-lived one is kept. Storing the short-lived token would work
   * for exactly one hour and then fail every scheduled post.
   */
  async exchangeCode(code: string, redirectUri: string): Promise<ProviderCredentials> {
    const response = await this.fetch(`${this.authBase}/oauth/access_token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.options.clientId,
        client_secret: this.options.clientSecret,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
        code,
      }).toString(),
    });
    if (!response.ok) throw await this.error(response, "exchange an authorization code");

    const short = (await response.json()) as { access_token?: unknown };
    if (typeof short.access_token !== "string") {
      throw new ValidationError("Instagram did not return an access token.");
    }

    const url = new URL(`${this.graphRoot}/access_token`);
    url.searchParams.set("grant_type", "ig_exchange_token");
    url.searchParams.set("client_secret", this.options.clientSecret);
    url.searchParams.set("access_token", short.access_token);
    return this.longLivedToken(url, "exchange for a long-lived token");
  }

  async refresh(credentials: ProviderCredentials): Promise<ProviderCredentials> {
    const url = new URL(`${this.graphRoot}/refresh_access_token`);
    url.searchParams.set("grant_type", "ig_refresh_token");
    url.searchParams.set("access_token", credentials.accessToken);
    return this.longLivedToken(url, "refresh the access token");
  }

  async getAccount(credentials: ProviderCredentials): Promise<ProviderAccount> {
    const url = new URL(`${this.graph}/me`);
    url.searchParams.set("fields", "user_id,username,name,profile_picture_url,account_type");
    const response = await this.fetch(url.toString(), { headers: this.auth(credentials) });
    if (!response.ok) throw await this.error(response, "read the Instagram account");

    const me = (await response.json()) as {
      id?: unknown;
      user_id?: unknown;
      username?: unknown;
      name?: unknown;
      profile_picture_url?: unknown;
      account_type?: unknown;
    };

    const id = typeof me.user_id === "string" ? me.user_id : typeof me.id === "string" ? me.id : null;
    if (!id) throw new ValidationError("Instagram did not say which account this is.");

    // Refused at connection, not at 7:30pm. The publishing API only works for
    // Business and Creator accounts, and connecting a personal one would look
    // fine right up to the first scheduled post.
    if (me.account_type === "PERSONAL") {
      throw new ValidationError(
        "This is a personal Instagram account, which cannot be published to. Switch it to a Business or Creator account in Instagram's settings, then connect again.",
      );
    }

    const username = typeof me.username === "string" ? me.username : null;
    return {
      externalId: id,
      name: typeof me.name === "string" && me.name ? me.name : username ? `@${username}` : "Instagram account",
      username,
      profileUrl: username ? `https://www.instagram.com/${username}/` : null,
      avatarUrl: typeof me.profile_picture_url === "string" ? me.profile_picture_url : null,
      scopes: [...INSTAGRAM_SCOPES],
    };
  }

  // -------------------------------------------------------------------------
  // Publishing
  // -------------------------------------------------------------------------

  async publish(
    credentials: ProviderCredentials,
    _account: { externalId: string },
    input: PublishInput,
  ): Promise<PublishResult> {
    this.assertPublishable(input);
    const caption = this.caption(input);

    // 1. Containers. Safe to repeat: an unpublished container is never shown
    //    and expires by itself.
    const containerId = await this.createContainers(credentials, input, caption);

    // 2. Video is processed asynchronously. Publishing before it is ready is
    //    refused by Instagram, so wait — within a bound.
    await this.waitUntilReady(credentials, containerId);

    // 3. The one call that puts something on the feed. A lost reply here means
    //    the post may be live; retrying would duplicate it.
    let response: Response;
    try {
      response = await this.fetch(`${this.graph}/me/media_publish`, {
        method: "POST",
        headers: { ...this.auth(credentials), "content-type": "application/json" },
        body: JSON.stringify({ creation_id: containerId }),
      });
    } catch (error) {
      if (error instanceof ProviderUnreachableError) {
        throw new AmbiguousPublishError(
          "Instagram did not answer in time, so the post may be live. Check the account before retrying.",
        );
      }
      throw error;
    }
    if (response.status === 504) {
      throw new AmbiguousPublishError(
        "Instagram's gateway timed out, so the post may be live. Check the account before retrying.",
      );
    }
    if (!response.ok) throw await this.error(response, "publish the post");

    const published = (await response.json()) as { id?: unknown };
    if (typeof published.id !== "string") {
      // Accepted, but we cannot say which post — same stance as LinkedIn.
      throw new AmbiguousPublishError(
        "Instagram accepted the post but did not say which one it is. Check the account before retrying.",
      );
    }
    const mediaId = published.id;

    // Everything after this point is decoration on a live post. Failures are
    // warnings, never thrown — throwing would mark a published post as failed.
    const warnings: string[] = [];
    const externalUrl = await this.permalink(credentials, mediaId);
    if (input.firstComment?.trim()) {
      const commented = await this.comment(credentials, mediaId, input.firstComment.trim());
      if (!commented) warnings.push("The first comment could not be added. Add it by hand.");
    }

    return {
      externalPostId: mediaId,
      externalUrl,
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  }

  /** Instagram's own rules, checked before any container exists. */
  private assertPublishable(input: PublishInput): void {
    const tags = input.hashtags.filter((tag) => tag.trim());
    if (tags.length > MAX_HASHTAGS) {
      throw new ValidationError(
        `Instagram allows at most ${MAX_HASHTAGS} hashtags on a post; this one has ${tags.length}.`,
      );
    }

    const media = input.media;
    if (media.length === 0) {
      throw new ValidationError("An Instagram post needs a creative — Instagram has no text-only posts.");
    }

    if (input.type === "CAROUSEL") {
      if (media.length < CAROUSEL_MIN || media.length > CAROUSEL_MAX) {
        throw new ValidationError(
          `An Instagram carousel needs ${CAROUSEL_MIN} to ${CAROUSEL_MAX} items; this one has ${media.length}.`,
        );
      }
      for (const item of media) this.assertFormat(item.mimeType, "either");
      return;
    }

    if (media.length !== 1) {
      throw new ValidationError(
        "This Instagram format takes exactly one creative. Use a carousel for more.",
      );
    }
    this.assertFormat(media[0]!.mimeType, input.type === "SINGLE_IMAGE" ? "image" : "video");
  }

  private assertFormat(mimeType: string, expected: "image" | "video" | "either"): void {
    const isJpeg = mimeType === "image/jpeg";
    const isVideo = VIDEO_TYPES.has(mimeType);

    if (mimeType.startsWith("image/") && !isJpeg) {
      throw new ValidationError(
        `Instagram only accepts JPEG images, and this creative is ${mimeType}. Export it as a JPEG and attach it again.`,
      );
    }
    if (expected === "image" && !isJpeg) {
      throw new ValidationError("A single-image Instagram post needs a JPEG image.");
    }
    if (expected === "video" && !isVideo) {
      throw new ValidationError("An Instagram reel needs an MP4 or MOV video.");
    }
    if (expected === "either" && !isJpeg && !isVideo) {
      throw new ValidationError(`Instagram cannot publish ${mimeType} in a carousel.`);
    }
  }

  /**
   * The caption, with hashtags at the end — Instagram has no separate hashtag
   * field — and mentions as `@handle`, which Instagram links by itself.
   */
  private caption(input: PublishInput): string {
    const parts: string[] = [];
    if (input.caption?.trim()) parts.push(input.caption.trim());

    const mentions = input.mentions
      .map((mention) => mention.trim().replace(/^@+/, ""))
      .filter(Boolean)
      .map((mention) => `@${mention}`);
    if (mentions.length > 0) parts.push(mentions.join(" "));

    const tags = input.hashtags.filter((tag) => tag.trim()).map((tag) => `#${tag.trim()}`);
    if (tags.length > 0) parts.push(tags.join(" "));

    return parts.join("\n\n");
  }

  /** Create the container(s) and return the one to publish. */
  private async createContainers(
    credentials: ProviderCredentials,
    input: PublishInput,
    caption: string,
  ): Promise<string> {
    if (input.type === "CAROUSEL") {
      const children: string[] = [];
      for (const item of input.media) {
        const child: Record<string, string | boolean> = VIDEO_TYPES.has(item.mimeType)
          ? { media_type: "VIDEO", video_url: item.url, is_carousel_item: true }
          : { image_url: item.url, is_carousel_item: true };
        const childId = await this.container(credentials, child);
        // A video child has to finish processing before the parent can
        // reference it.
        if (VIDEO_TYPES.has(item.mimeType)) await this.waitUntilReady(credentials, childId);
        children.push(childId);
      }
      return this.container(credentials, {
        media_type: "CAROUSEL",
        children: children.join(","),
        caption,
      });
    }

    const media = input.media[0]!;
    if (input.type === "SINGLE_IMAGE") {
      return this.container(credentials, { image_url: media.url, caption });
    }

    // REEL and VIDEO both publish as reels. Instagram retired the plain VIDEO
    // feed type; a video now goes out as a reel shared to the feed.
    return this.container(credentials, {
      media_type: "REELS",
      video_url: media.url,
      caption,
      share_to_feed: true,
    });
  }

  private async container(
    credentials: ProviderCredentials,
    fields: Record<string, string | boolean>,
  ): Promise<string> {
    const response = await this.fetch(`${this.graph}/me/media`, {
      method: "POST",
      headers: { ...this.auth(credentials), "content-type": "application/json" },
      body: JSON.stringify(fields),
    });
    if (!response.ok) throw await this.error(response, "prepare the post");

    const json = (await response.json()) as { id?: unknown };
    if (typeof json.id !== "string") {
      throw new ValidationError("Instagram did not return a container for the post.");
    }
    return json.id;
  }

  /**
   * Wait for a container to finish processing.
   *
   * Images are ready at once; videos are not. `ERROR` and `EXPIRED` are final
   * and say so; running out of time is not a failure of the post, just of this
   * run — nothing was published, so the next run can safely start again.
   */
  private async waitUntilReady(credentials: ProviderCredentials, containerId: string): Promise<void> {
    const deadline = Date.now() + this.pollTimeoutMs;

    for (;;) {
      const url = new URL(`${this.graph}/${containerId}`);
      url.searchParams.set("fields", "status_code");
      const response = await this.fetch(url.toString(), { headers: this.auth(credentials) });
      if (!response.ok) throw await this.error(response, "check the post's processing");

      const { status_code: status } = (await response.json()) as { status_code?: unknown };
      if (status === "FINISHED" || status === "PUBLISHED") return;
      if (status === "ERROR") {
        throw new ValidationError(
          "Instagram could not process the creative. Check its format and length, then try again.",
        );
      }
      if (status === "EXPIRED") {
        throw new ValidationError("Instagram's copy of the creative expired before it was posted.");
      }

      if (Date.now() + this.pollIntervalMs > deadline) {
        throw new ValidationError(
          "Instagram is still processing the video. It will be tried again on the next run.",
        );
      }
      await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
    }
  }

  /** The post's public link. Best-effort: a live post without one is still live. */
  private async permalink(credentials: ProviderCredentials, mediaId: string): Promise<string | null> {
    try {
      const url = new URL(`${this.graph}/${mediaId}`);
      url.searchParams.set("fields", "permalink");
      const response = await this.fetch(url.toString(), { headers: this.auth(credentials) });
      if (!response.ok) return null;
      const json = (await response.json()) as { permalink?: unknown };
      return typeof json.permalink === "string" ? json.permalink : null;
    } catch {
      return null;
    }
  }

  private async comment(
    credentials: ProviderCredentials,
    mediaId: string,
    message: string,
  ): Promise<boolean> {
    try {
      const response = await this.fetch(`${this.graph}/${mediaId}/comments`, {
        method: "POST",
        headers: { ...this.auth(credentials), "content-type": "application/json" },
        body: JSON.stringify({ message }),
      });
      if (!response.ok) {
        await this.error(response, "add the first comment");
        return false;
      }
      return true;
    } catch (error) {
      instagramLog.error({ err: error }, "instagram first comment could not be added");
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // Metrics
  // -------------------------------------------------------------------------

  /**
   * Engagement for one post.
   *
   * Two sources, because they fail differently. Like and comment counts are
   * plain fields on the media and are always there. Reach, saves and shares
   * come from insights, which refuses the whole request if any one metric is
   * not available for that kind of post — so a refused insights call leaves
   * those three absent rather than failing the read.
   *
   * Impressions stay null. Meta retired them for new media in favour of views,
   * and reporting a retired number as zero would be inventing it.
   */
  async getMetrics(
    credentials: ProviderCredentials,
    _account: { externalId: string },
    externalPostId: string,
  ): Promise<ProviderMetrics> {
    const count = (value: unknown): number | null =>
      typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;

    const fieldsUrl = new URL(`${this.graph}/${externalPostId}`);
    fieldsUrl.searchParams.set("fields", "like_count,comments_count");
    const fields = await this.fetch(fieldsUrl.toString(), { headers: this.auth(credentials) });
    if (!fields.ok) throw await this.error(fields, "read post engagement");
    const counts = (await fields.json()) as { like_count?: unknown; comments_count?: unknown };

    const metrics: ProviderMetrics = {
      likes: count(counts.like_count),
      comments: count(counts.comments_count),
      reach: null,
      impressions: null,
      shares: null,
      saves: null,
      clicks: null,
      videoViews: null,
      watchTimeSeconds: null,
      profileVisits: null,
      followersGained: null,
    };

    const insightsUrl = new URL(`${this.graph}/${externalPostId}/insights`);
    insightsUrl.searchParams.set("metric", "reach,saved,shares");
    const insights = await this.fetch(insightsUrl.toString(), { headers: this.auth(credentials) });
    if (insights.ok) {
      const json = (await insights.json()) as {
        data?: { name?: unknown; values?: { value?: unknown }[] }[];
      };
      for (const entry of json.data ?? []) {
        const value = count(entry.values?.[0]?.value);
        if (entry.name === "reach") metrics.reach = value;
        if (entry.name === "saved") metrics.saves = value;
        if (entry.name === "shares") metrics.shares = value;
      }
    } else if (insights.status === 401 || insights.status === 403) {
      throw await this.error(insights, "read post insights");
    }
    // Any other refusal leaves reach, saves and shares absent — see above.

    return metrics;
  }

  // -------------------------------------------------------------------------

  private auth(credentials: ProviderCredentials): Record<string, string> {
    return { authorization: `Bearer ${credentials.accessToken}` };
  }

  private async longLivedToken(url: URL, what: string): Promise<ProviderCredentials> {
    const response = await this.fetch(url.toString());
    if (!response.ok) throw await this.error(response, what);

    const json = (await response.json()) as { access_token?: unknown; expires_in?: unknown };
    if (typeof json.access_token !== "string") {
      throw new ValidationError("Instagram did not return a long-lived access token.");
    }
    const expiresIn = typeof json.expires_in === "number" ? json.expires_in : null;
    return {
      accessToken: json.access_token,
      refreshToken: null,
      expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : null,
    };
  }

  private async fetch(url: string, init: RequestInit = {}): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal, cache: "no-store" });
    } catch (cause) {
      // Logged without its query string. Meta's token exchange carries the
      // client secret and the access token *in the URL*, and a log line is not
      // a place either belongs (CLAUDE.md 11).
      instagramLog.error({ err: cause, url: redact(url) }, "instagram request could not be made");
      throw new ProviderUnreachableError("Instagram could not be reached. Try again in a moment.");
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Turn a Graph API failure into something an operator can act on.
   *
   * Code 190 is Meta's "this token is no good" — expired, revoked, or the
   * password changed — and is typed as a credentials rejection so the engine
   * marks the account and stops retrying. The body is logged, never shown.
   */
  private async error(response: Response, what: string): Promise<Error> {
    const text = await response.text().catch(() => "");
    let code: unknown = null;
    try {
      code = (JSON.parse(text) as GraphError).error?.code ?? null;
    } catch {
      // Not JSON; the status is all we have.
    }

    instagramLog.error(
      { status: response.status, code, what, detail: text.slice(0, 500) },
      "instagram request failed",
    );

    if (response.status === 401 || code === 190) {
      return new CredentialsRejectedError(
        "Instagram rejected the credentials. Reconnect the account to grant access again.",
      );
    }
    if (response.status === 429 || code === 4 || code === 17 || code === 32 || code === 613) {
      return new ValidationError("Instagram is rate limiting us. Try again shortly.");
    }
    return new ValidationError(`Instagram refused to ${what} (${response.status}).`);
  }
}

/** A URL with its query string removed, for logs. */
function redact(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return "[unparseable url]";
  }
}
