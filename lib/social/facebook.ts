import "server-only";
import { createHmac } from "node:crypto";
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
 * Facebook Pages, through the Graph API with Facebook Login.
 *
 * ## One sign-in, many Pages
 *
 * A person signs in; Pages are what get published to. So this adapter is the
 * first to implement `listAccounts` / `selectAccount`: the callback lists the
 * Pages the person can post to, the operator chooses one, and the chosen
 * Page's **own** token is fetched and stored. The user token is not kept once
 * the choice is made.
 *
 * A Page token obtained from a long-lived user token does not expire. It stops
 * working when the person loses their role on the Page, changes their
 * password, or removes the app — all of which surface as Graph error 190 and
 * mark the account for reconnection. So `expiresAt` is null and `refresh` is
 * never needed; it refuses if called rather than pretending.
 *
 * ## Which call is the dangerous one
 *
 * Each format ends in exactly one call that makes the post visible: the
 * `/feed` post, the published `/photos` upload, the `/videos` upload, or the
 * reel's `finish` phase. A timeout or 504 on that call raises
 * `AmbiguousPublishError`. Everything before it — unpublished photos for a
 * multi-photo post, starting a reel upload — is invisible and safe to repeat.
 *
 * ## Checked against
 *
 * Meta's developer site is not reachable from where this was built. Endpoint
 * and parameter names were taken from Meta's own generated Business SDKs
 * (`facebook-python-business-sdk` / `facebook-nodejs-business-sdk`, 26.x),
 * which are produced from the Graph API's schema and pin v26.0. The reel
 * upload host (`rupload.facebook.com`) and the Page-post insight metric names
 * are not in the SDK and are from Meta's published guides as remembered; see
 * `docs/SOCIAL-MODULE.md` §17. Not run against a real Page.
 */

const facebookLog = log("social");

/** The Graph version Meta's own SDKs pin at the time of writing. */
export const FACEBOOK_API_VERSION = "v26.0";

/**
 * List Pages, read them, post to them, read their insights. Nothing broader:
 * `pages_manage_metadata` and `business_management` are deliberately absent,
 * since each is a separate App Review and neither is needed to publish.
 */
export const FACEBOOK_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
  "read_insights",
] as const;

/** The Page role task needed to publish. A Page without it is not offered. */
const CAN_PUBLISH = "CREATE_CONTENT";

const MULTI_PHOTO_MIN = 2;
const MULTI_PHOTO_MAX = 10;
const VIDEO_TYPES = new Set(["video/mp4", "video/quicktime"]);
/** Pages of `/me/accounts` to follow. 100 a page; an agency with more is rare. */
const MAX_ACCOUNT_PAGES = 10;

export type FacebookOptions = {
  clientId: string;
  clientSecret: string;
  /** Overrides for tests. Default to Meta's own hosts. */
  dialogBase?: string;
  graphBase?: string;
  videoBase?: string;
  ruploadBase?: string;
  timeoutMs?: number;
};

type GraphError = { error?: { message?: unknown; code?: unknown } };

type PageFields = {
  id?: unknown;
  name?: unknown;
  username?: unknown;
  link?: unknown;
  picture?: { data?: { url?: unknown } };
  tasks?: unknown;
  access_token?: unknown;
};

const PAGE_FIELDS = "id,name,username,link,picture{url}";

export class FacebookProvider implements SocialProviderAdapter {
  readonly provider: SocialProvider = "FACEBOOK";
  readonly configured = true;
  readonly capabilities = CAPABILITIES.FACEBOOK;

  private readonly dialog: string;
  private readonly graph: string;
  private readonly video: string;
  private readonly rupload: string;
  private readonly timeoutMs: number;

  constructor(private readonly options: FacebookOptions) {
    this.dialog = `${options.dialogBase ?? "https://www.facebook.com"}/${FACEBOOK_API_VERSION}`;
    this.graph = `${options.graphBase ?? "https://graph.facebook.com"}/${FACEBOOK_API_VERSION}`;
    this.video = `${options.videoBase ?? "https://graph-video.facebook.com"}/${FACEBOOK_API_VERSION}`;
    this.rupload = `${options.ruploadBase ?? "https://rupload.facebook.com"}/video-upload/${FACEBOOK_API_VERSION}`;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  get label(): string {
    return PROVIDER_LABEL.FACEBOOK;
  }

  // -------------------------------------------------------------------------
  // Connection
  // -------------------------------------------------------------------------

  authorizationUrl(state: string, redirectUri: string): string {
    const url = new URL(`${this.dialog}/dialog/oauth`);
    url.searchParams.set("client_id", this.options.clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", FACEBOOK_SCOPES.join(","));
    url.searchParams.set("state", state);
    return url.toString();
  }

  /**
   * Code → short-lived user token → long-lived user token.
   *
   * The long-lived one matters even though it is not what gets stored: a Page
   * token fetched with a *short-lived* user token expires with it, an hour
   * later. Fetched with a long-lived one, it does not expire.
   */
  async exchangeCode(code: string, redirectUri: string): Promise<ProviderCredentials> {
    const shortUrl = new URL(`${this.graph}/oauth/access_token`);
    shortUrl.searchParams.set("client_id", this.options.clientId);
    shortUrl.searchParams.set("client_secret", this.options.clientSecret);
    shortUrl.searchParams.set("redirect_uri", redirectUri);
    shortUrl.searchParams.set("code", code);
    const short = await this.token(shortUrl, "exchange an authorization code");

    const longUrl = new URL(`${this.graph}/oauth/access_token`);
    longUrl.searchParams.set("grant_type", "fb_exchange_token");
    longUrl.searchParams.set("client_id", this.options.clientId);
    longUrl.searchParams.set("client_secret", this.options.clientSecret);
    longUrl.searchParams.set("fb_exchange_token", short.accessToken);
    return this.token(longUrl, "exchange for a long-lived token");
  }

  async refresh(): Promise<ProviderCredentials> {
    // Page tokens do not expire, so this is only reachable if a stored expiry
    // is wrong. Saying so beats inventing a refresh Meta does not offer.
    throw new CredentialsRejectedError(
      "Facebook Page access cannot be extended. Reconnect the Page.",
    );
  }

  /** The Pages this sign-in can publish to. No token leaves this method. */
  async listAccounts(credentials: ProviderCredentials): Promise<ProviderAccount[]> {
    const accounts: ProviderAccount[] = [];
    let after: string | null = null;

    for (let page = 0; page < MAX_ACCOUNT_PAGES; page += 1) {
      const url = new URL(`${this.graph}/me/accounts`);
      url.searchParams.set("fields", `${PAGE_FIELDS},tasks`);
      url.searchParams.set("limit", "100");
      if (after) url.searchParams.set("after", after);

      const json = (await this.get(url, credentials, "list your Facebook Pages")) as {
        data?: PageFields[];
        paging?: { cursors?: { after?: unknown }; next?: unknown };
      };

      for (const row of json.data ?? []) {
        const tasks = Array.isArray(row.tasks) ? row.tasks : [];
        // A Page the person can only moderate or analyse would connect fine
        // and fail at the first post. Not offered.
        if (!tasks.includes(CAN_PUBLISH)) continue;
        const account = this.toAccount(row);
        if (account) accounts.push(account);
      }

      const cursor = json.paging?.cursors?.after;
      if (typeof json.paging?.next !== "string" || typeof cursor !== "string") break;
      after = cursor;
    }

    return accounts;
  }

  /** The chosen Page, with its own token in place of the person's. */
  async selectAccount(
    credentials: ProviderCredentials,
    externalId: string,
  ): Promise<{ account: ProviderAccount; credentials: ProviderCredentials }> {
    if (!/^\d+$/.test(externalId)) throw new ValidationError("That is not a Facebook Page id.");

    const url = new URL(`${this.graph}/${externalId}`);
    url.searchParams.set("fields", `${PAGE_FIELDS},access_token`);
    const row = (await this.get(url, credentials, "read the chosen Page")) as PageFields;

    const account = this.toAccount(row);
    if (!account || typeof row.access_token !== "string" || !row.access_token) {
      // No token means this person cannot act for the Page.
      throw new ValidationError("Facebook did not grant access to that Page. Check your role on it.");
    }

    return {
      account,
      credentials: { accessToken: row.access_token, refreshToken: null, expiresAt: null },
    };
  }

  /** With a Page token, `/me` is the Page — which proves the token still works. */
  async getAccount(credentials: ProviderCredentials): Promise<ProviderAccount> {
    const url = new URL(`${this.graph}/me`);
    url.searchParams.set("fields", PAGE_FIELDS);
    const row = (await this.get(url, credentials, "read the Facebook Page")) as PageFields;
    const account = this.toAccount(row);
    if (!account) throw new ValidationError("Facebook did not say which Page this is.");
    return account;
  }

  private toAccount(row: PageFields): ProviderAccount | null {
    if (typeof row.id !== "string" || typeof row.name !== "string" || !row.name) return null;
    const username = typeof row.username === "string" && row.username ? row.username : null;
    return {
      externalId: row.id,
      name: row.name,
      username,
      profileUrl:
        typeof row.link === "string"
          ? row.link
          : `https://www.facebook.com/${username ?? row.id}`,
      avatarUrl: typeof row.picture?.data?.url === "string" ? row.picture.data.url : null,
      scopes: [...FACEBOOK_SCOPES],
    };
  }

  // -------------------------------------------------------------------------
  // Publishing
  // -------------------------------------------------------------------------

  async publish(
    credentials: ProviderCredentials,
    account: { externalId: string },
    input: PublishInput,
  ): Promise<PublishResult> {
    this.assertPublishable(input);
    const pageId = account.externalId;
    const message = this.message(input);

    switch (input.type) {
      case "TEXT":
      case "LINK": {
        const body: Record<string, unknown> = { message };
        if (input.type === "LINK") body["link"] = input.linkUrl;
        const { id } = await this.publishCall(`${this.graph}/${pageId}/feed`, credentials, body);
        return this.published(credentials, id);
      }

      case "SINGLE_IMAGE": {
        const json = await this.publishCall(`${this.graph}/${pageId}/photos`, credentials, {
          url: input.media[0]!.url,
          caption: message,
        });
        // The photo and the post it created are different objects; metrics
        // and the permalink belong to the post.
        return this.published(credentials, json.postId ?? json.id);
      }

      case "CAROUSEL": {
        // Unpublished photos first — invisible, and safe to make again if this
        // run fails before the post.
        const ids: string[] = [];
        for (const item of input.media) {
          const photo = (await this.post(
            `${this.graph}/${pageId}/photos`,
            credentials,
            { url: item.url, published: false },
            "upload a photo for the post",
          )) as { id?: unknown };
          if (typeof photo.id !== "string") {
            throw new ValidationError("Facebook did not return an id for an uploaded photo.");
          }
          ids.push(photo.id);
        }
        const { id } = await this.publishCall(`${this.graph}/${pageId}/feed`, credentials, {
          message,
          attached_media: ids.map((media_fbid) => ({ media_fbid })),
        });
        return this.published(credentials, id);
      }

      case "VIDEO": {
        // Facebook fetches the file itself from the public URL.
        const { id } = await this.publishCall(`${this.video}/${pageId}/videos`, credentials, {
          file_url: input.media[0]!.url,
          description: message,
        });
        return this.publishedVideo(credentials, id);
      }

      case "REEL":
        return this.publishReel(credentials, pageId, input.media[0]!.url, message);

      default:
        throw new ValidationError(`Facebook cannot publish a ${input.type} post.`);
    }
  }

  /**
   * A reel is three calls: reserve an upload, hand Facebook the file's URL,
   * then publish. Only the third makes anything visible.
   */
  private async publishReel(
    credentials: ProviderCredentials,
    pageId: string,
    fileUrl: string,
    message: string,
  ): Promise<PublishResult> {
    const started = (await this.post(
      `${this.graph}/${pageId}/video_reels`,
      credentials,
      { upload_phase: "start" },
      "start the reel upload",
    )) as { video_id?: unknown };
    if (typeof started.video_id !== "string") {
      throw new ValidationError("Facebook did not reserve an upload for the reel.");
    }
    const videoId = started.video_id;

    // Hosted-file upload: the file's URL goes in a header, not the body.
    const uploaded = await this.fetch(`${this.rupload}/${videoId}`, {
      method: "POST",
      headers: {
        authorization: `OAuth ${credentials.accessToken}`,
        file_url: fileUrl,
      },
    });
    if (!uploaded.ok) throw await this.error(uploaded, "upload the reel");

    const { id } = await this.publishCall(
      `${this.graph}/${pageId}/video_reels`,
      credentials,
      { upload_phase: "finish", video_id: videoId, video_state: "PUBLISHED", description: message },
      videoId,
    );
    return this.publishedVideo(credentials, id);
  }

  /**
   * The call that makes a post visible. A lost reply means it may be live.
   *
   * `fallbackId` covers the reel `finish` call, which answers `{success:true}`
   * rather than an id: the video id was already known, so the post is not
   * anonymous.
   */
  private async publishCall(
    url: string,
    credentials: ProviderCredentials,
    body: Record<string, unknown>,
    fallbackId?: string,
  ): Promise<{ id: string; postId: string | null }> {
    let response: Response;
    try {
      response = await this.fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(this.withToken(credentials, body)),
      });
    } catch (error) {
      if (error instanceof ProviderUnreachableError) {
        throw new AmbiguousPublishError(
          "Facebook did not answer in time, so the post may be live. Check the Page before retrying.",
        );
      }
      throw error;
    }
    if (response.status === 504) {
      throw new AmbiguousPublishError(
        "Facebook's gateway timed out, so the post may be live. Check the Page before retrying.",
      );
    }
    if (!response.ok) throw await this.error(response, "publish the post");

    const json = (await response.json().catch(() => ({}))) as {
      id?: unknown;
      post_id?: unknown;
      success?: unknown;
    };
    const id = typeof json.id === "string" ? json.id : json.success === true ? fallbackId : undefined;
    if (!id) {
      throw new AmbiguousPublishError(
        "Facebook accepted the post but did not say which one it is. Check the Page before retrying.",
      );
    }
    return { id, postId: typeof json.post_id === "string" ? json.post_id : null };
  }

  private async published(credentials: ProviderCredentials, postId: string): Promise<PublishResult> {
    return { externalPostId: postId, externalUrl: await this.link(credentials, postId) };
  }

  /**
   * A video is processed after the call returns, so its post may not exist
   * yet. The video id is stored — it is what the video's own counts hang off
   * — and the permalink is best-effort.
   */
  private async publishedVideo(credentials: ProviderCredentials, videoId: string): Promise<PublishResult> {
    return { externalPostId: videoId, externalUrl: await this.link(credentials, videoId) };
  }

  /** Best-effort: a live post without a link is still live. */
  private async link(credentials: ProviderCredentials, id: string): Promise<string | null> {
    try {
      const url = new URL(`${this.graph}/${id}`);
      url.searchParams.set("fields", "permalink_url");
      const json = (await this.get(url, credentials, "read the post's link")) as {
        permalink_url?: unknown;
      };
      if (typeof json.permalink_url !== "string") return null;
      // Video permalinks come back relative.
      return json.permalink_url.startsWith("/")
        ? `https://www.facebook.com${json.permalink_url}`
        : json.permalink_url;
    } catch {
      return null;
    }
  }

  /** Facebook's rules, checked before anything is uploaded. */
  private assertPublishable(input: PublishInput): void {
    const media = input.media;
    const images = media.filter((m) => m.mimeType.startsWith("image/"));
    const videos = media.filter((m) => VIDEO_TYPES.has(m.mimeType));

    switch (input.type) {
      case "TEXT":
        if (media.length > 0) {
          throw new ValidationError("A text post carries no creative. Use a single image or a video.");
        }
        if (!input.caption?.trim()) throw new ValidationError("A text post needs some text.");
        return;
      case "LINK":
        if (!input.linkUrl) throw new ValidationError("A link post needs a link.");
        if (media.length > 0) {
          throw new ValidationError("Facebook builds a link post's preview from the page; it takes no creative.");
        }
        return;
      case "SINGLE_IMAGE":
        if (media.length !== 1 || images.length !== 1) {
          throw new ValidationError("A single-image post needs exactly one image.");
        }
        return;
      case "CAROUSEL":
        if (videos.length > 0 || images.length !== media.length) {
          throw new ValidationError("A Facebook multi-photo post takes images only.");
        }
        if (media.length < MULTI_PHOTO_MIN || media.length > MULTI_PHOTO_MAX) {
          throw new ValidationError(
            `A Facebook multi-photo post needs ${MULTI_PHOTO_MIN} to ${MULTI_PHOTO_MAX} images; this one has ${media.length}.`,
          );
        }
        return;
      case "VIDEO":
      case "REEL":
        if (media.length !== 1 || videos.length !== 1) {
          throw new ValidationError("This format needs exactly one MP4 or MOV video.");
        }
        return;
      default:
        throw new ValidationError(`Facebook cannot publish a ${input.type} post.`);
    }
  }

  /**
   * The text of the post. Hashtags go at the end. The link goes in the text
   * for formats that are not link posts — Facebook makes it clickable there —
   * and is the `link` parameter for a link post, so it is not said twice.
   */
  private message(input: PublishInput): string {
    const parts: string[] = [];
    if (input.caption?.trim()) parts.push(input.caption.trim());
    if (input.linkUrl && input.type !== "LINK") parts.push(input.linkUrl);
    const tags = input.hashtags.filter((t) => t.trim()).map((t) => `#${t.trim()}`);
    if (tags.length > 0) parts.push(tags.join(" "));
    return parts.join("\n\n");
  }

  // -------------------------------------------------------------------------
  // Metrics
  // -------------------------------------------------------------------------

  /**
   * Engagement for one post or video.
   *
   * Reaction, comment and share counts are fields on the object and are
   * required: if they cannot be read, the read fails. Reach and clicks come
   * from insights, each asked for **separately** — Meta has been retiring
   * Page-post metrics, and one retired name in a combined request would
   * refuse the lot. A refused metric is left absent, never zero.
   */
  async getMetrics(
    credentials: ProviderCredentials,
    _account: { externalId: string },
    externalPostId: string,
  ): Promise<ProviderMetrics> {
    const count = (value: unknown): number | null =>
      typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;

    // Page posts are `{pageId}_{postId}`; a video is a bare number. A video's
    // counts live on the post it became, once it has finished processing.
    const postId = externalPostId.includes("_")
      ? externalPostId
      : await this.videoPost(credentials, externalPostId);

    if (!postId) {
      // Still processing, or never became a post: the video's own counts are
      // what exists. Videos have no share count and no post insights.
      const url = new URL(`${this.graph}/${externalPostId}`);
      url.searchParams.set(
        "fields",
        "reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0)",
      );
      const video = (await this.get(url, credentials, "read video engagement")) as {
        reactions?: { summary?: { total_count?: unknown } };
        comments?: { summary?: { total_count?: unknown } };
      };
      return {
        likes: count(video.reactions?.summary?.total_count),
        comments: count(video.comments?.summary?.total_count),
        shares: null,
        reach: null,
        clicks: null,
        impressions: null,
        saves: null,
        videoViews: null,
        watchTimeSeconds: null,
        profileVisits: null,
        followersGained: null,
      };
    }

    const url = new URL(`${this.graph}/${postId}`);
    url.searchParams.set(
      "fields",
      "reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0),shares",
    );
    const fields = (await this.get(url, credentials, "read post engagement")) as {
      reactions?: { summary?: { total_count?: unknown } };
      comments?: { summary?: { total_count?: unknown } };
      shares?: { count?: unknown };
    };

    return {
      likes: count(fields.reactions?.summary?.total_count),
      comments: count(fields.comments?.summary?.total_count),
      // A post nobody shared has no `shares` field at all. That one absence
      // really is zero: the field exists only once there is a share.
      shares: fields.shares === undefined ? 0 : count(fields.shares.count),
      reach: await this.insight(credentials, postId, "post_impressions_unique"),
      clicks: await this.insight(credentials, postId, "post_clicks"),
      impressions: null,
      saves: null,
      videoViews: null,
      watchTimeSeconds: null,
      profileVisits: null,
      followersGained: null,
    };
  }

  /** The post a video became, if it has become one yet. */
  private async videoPost(credentials: ProviderCredentials, videoId: string): Promise<string | null> {
    const url = new URL(`${this.graph}/${videoId}`);
    url.searchParams.set("fields", "post_id");
    const json = (await this.get(url, credentials, "read the video")) as { post_id?: unknown };
    if (typeof json.post_id !== "string" || !json.post_id) return null;
    // Returned bare by some versions; the post's id is page-qualified.
    return json.post_id.includes("_") ? json.post_id : null;
  }

  private async insight(
    credentials: ProviderCredentials,
    id: string,
    metric: string,
  ): Promise<number | null> {
    const url = new URL(`${this.graph}/${id}/insights`);
    url.searchParams.set("metric", metric);
    this.sign(url, credentials);
    const response = await this.fetch(url.toString());
    if (response.status === 401) throw await this.error(response, "read post insights");
    if (!response.ok) {
      // 190 is a dead token whatever the endpoint; anything else is this
      // metric being unavailable for this object.
      const error = await this.error(response, "read post insights");
      if (error instanceof CredentialsRejectedError) throw error;
      return null;
    }
    const json = (await response.json()) as { data?: { name?: unknown; values?: { value?: unknown }[] }[] };
    const value = json.data?.find((d) => d.name === metric)?.values?.[0]?.value;
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
  }

  // -------------------------------------------------------------------------
  // Plumbing
  // -------------------------------------------------------------------------

  /**
   * `appsecret_proof` proves the call comes from the app's server. Meta lets
   * an app require it; sending it always means turning that on breaks nothing.
   */
  private proof(credentials: ProviderCredentials): string {
    return createHmac("sha256", this.options.clientSecret).update(credentials.accessToken).digest("hex");
  }

  private sign(url: URL, credentials: ProviderCredentials): void {
    url.searchParams.set("access_token", credentials.accessToken);
    url.searchParams.set("appsecret_proof", this.proof(credentials));
  }

  /** Token in the body, as Meta's SDKs send it — never in a POST's URL. */
  private withToken(credentials: ProviderCredentials, body: Record<string, unknown>) {
    return { ...body, access_token: credentials.accessToken, appsecret_proof: this.proof(credentials) };
  }

  private async get(url: URL, credentials: ProviderCredentials, what: string): Promise<unknown> {
    this.sign(url, credentials);
    const response = await this.fetch(url.toString());
    if (!response.ok) throw await this.error(response, what);
    return response.json();
  }

  private async post(
    url: string,
    credentials: ProviderCredentials,
    body: Record<string, unknown>,
    what: string,
  ): Promise<unknown> {
    const response = await this.fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(this.withToken(credentials, body)),
    });
    if (!response.ok) throw await this.error(response, what);
    return response.json();
  }

  private async token(url: URL, what: string): Promise<ProviderCredentials> {
    const response = await this.fetch(url.toString());
    if (!response.ok) throw await this.error(response, what);
    const json = (await response.json()) as { access_token?: unknown; expires_in?: unknown };
    if (typeof json.access_token !== "string") {
      throw new ValidationError("Facebook did not return an access token.");
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
      // Without the query string: Meta carries the secret and the token there.
      facebookLog.error({ err: cause, url: redact(url) }, "facebook request could not be made");
      throw new ProviderUnreachableError("Facebook could not be reached. Try again in a moment.");
    } finally {
      clearTimeout(timer);
    }
  }

  /** Same mapping as Instagram's: both are the Graph API underneath. */
  private async error(response: Response, what: string): Promise<Error> {
    const text = await response.text().catch(() => "");
    let code: unknown = null;
    try {
      code = (JSON.parse(text) as GraphError).error?.code ?? null;
    } catch {
      // Not JSON; the status is all we have.
    }

    facebookLog.error(
      { status: response.status, code, what, detail: text.slice(0, 500) },
      "facebook request failed",
    );

    if (response.status === 401 || code === 190) {
      return new CredentialsRejectedError(
        "Facebook rejected the credentials. Reconnect the Page to grant access again.",
      );
    }
    if (response.status === 429 || code === 4 || code === 17 || code === 32 || code === 613) {
      return new ValidationError("Facebook is rate limiting us. Try again shortly.");
    }
    return new ValidationError(`Facebook refused to ${what} (${response.status}).`);
  }
}

function redact(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return "[unparseable url]";
  }
}
