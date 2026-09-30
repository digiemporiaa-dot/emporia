import "server-only";
import { ValidationError } from "@/lib/errors";
import {
  AmbiguousPublishError,
  CredentialsRejectedError,
  ProviderUnreachableError,
} from "@/lib/social/errors";
import { CAPABILITIES, PROVIDER_LABEL } from "@/lib/social/capabilities";
import {
  googleAuthorizationUrl,
  googleExchangeCode,
  googleRefresh,
  type GoogleOAuthConfig,
} from "@/lib/social/google-oauth";
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
 * YouTube, through the Data API v3.
 *
 * ## Uploading, and the one call that creates the video
 *
 * YouTube does not fetch from a URL the way Meta does; the bytes have to be
 * sent. So publishing is a **resumable upload**: open a session with the
 * metadata (nothing exists yet), then stream the file from its public URL
 * into the session. The video comes into being when the last byte lands —
 * the stream is the dangerous call.
 *
 * A resumable session can be *asked* how far it got, which turns most lost
 * replies from "maybe" into an answer. After a timeout or a 5xx on the
 * stream, the adapter asks once:
 *
 * - **complete** → the video exists; that is a success, with its id;
 * - **incomplete** → no video was created; an ordinary, safe retry;
 * - **no answer** → genuinely unknown: `AmbiguousPublishError`.
 *
 * ## Channels
 *
 * A Google account can own several channels (brand accounts). Google's own
 * consent screen makes the person pick the channel when YouTube scopes are
 * requested, so `channels?mine=true` returns the one chosen and no picker is
 * needed here.
 *
 * ## Checked against
 *
 * Endpoints, parts and field names are from Google's published discovery
 * document for YouTube Data API v3 (revision 20260924). Not run against a
 * real channel. See `docs/SOCIAL-MODULE.md` §18 — especially the upload
 * quota and the API audit, both of which bite in production.
 */

const youtubeLog = log("social");

export const YOUTUBE_SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
] as const;

/** YouTube's limits, checked before a byte is sent. */
const TITLE_MAX = 100;
const DESCRIPTION_MAX_BYTES = 5_000;
const TAGS_MAX_CHARS = 500;
/** "People & Blogs": a category every region has. The operator can change it on YouTube. */
const DEFAULT_CATEGORY = "22";

export type YouTubeOptions = {
  clientId: string;
  clientSecret: string;
  /** Overrides for tests. Default to Google's own hosts. */
  authorizeUrl?: string;
  tokenUrl?: string;
  apiBase?: string;
  timeoutMs?: number;
  /** The stream itself can take minutes for a long video. */
  uploadTimeoutMs?: number;
};

type GoogleError = { error?: { code?: unknown; message?: unknown; errors?: { reason?: unknown }[] } };

type Video = {
  id?: unknown;
  status?: { privacyStatus?: unknown; uploadStatus?: unknown };
};

export class YouTubeProvider implements SocialProviderAdapter {
  readonly provider: SocialProvider = "YOUTUBE";
  readonly configured = true;
  readonly capabilities = CAPABILITIES.YOUTUBE;

  private readonly api: string;
  private readonly timeoutMs: number;
  private readonly uploadTimeoutMs: number;
  private readonly oauth: GoogleOAuthConfig;

  constructor(options: YouTubeOptions) {
    this.api = options.apiBase ?? "https://youtube.googleapis.com";
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.uploadTimeoutMs = options.uploadTimeoutMs ?? 15 * 60_000;
    this.oauth = {
      clientId: options.clientId,
      clientSecret: options.clientSecret,
      scopes: YOUTUBE_SCOPES,
      requiredScopes: YOUTUBE_SCOPES,
      label: "YouTube",
      authorizeUrl: options.authorizeUrl,
      tokenUrl: options.tokenUrl,
    };
  }

  get label(): string {
    return PROVIDER_LABEL.YOUTUBE;
  }

  // -------------------------------------------------------------------------
  // Connection
  // -------------------------------------------------------------------------

  authorizationUrl(state: string, redirectUri: string): string {
    return googleAuthorizationUrl(this.oauth, state, redirectUri);
  }

  exchangeCode(code: string, redirectUri: string): Promise<ProviderCredentials> {
    return googleExchangeCode(this.oauth, (url, init) => this.fetch(url, init), code, redirectUri);
  }

  refresh(credentials: ProviderCredentials): Promise<ProviderCredentials> {
    return googleRefresh(this.oauth, (url, init) => this.fetch(url, init), credentials);
  }

  async getAccount(credentials: ProviderCredentials): Promise<ProviderAccount> {
    const url = new URL(`${this.api}/youtube/v3/channels`);
    url.searchParams.set("part", "snippet");
    url.searchParams.set("mine", "true");
    const response = await this.fetch(url.toString(), { headers: this.auth(credentials) });
    if (!response.ok) throw await this.error(response, "read the YouTube channel");

    const json = (await response.json()) as {
      items?: {
        id?: unknown;
        snippet?: { title?: unknown; customUrl?: unknown; thumbnails?: { default?: { url?: unknown } } };
      }[];
    };
    const channel = json.items?.[0];
    if (!channel || typeof channel.id !== "string") {
      // A Google account with no channel: connecting it would fail at upload.
      throw new ValidationError(
        "That Google account has no YouTube channel. Create one on YouTube, then connect again.",
      );
    }

    const customUrl = typeof channel.snippet?.customUrl === "string" ? channel.snippet.customUrl : null;
    const title = typeof channel.snippet?.title === "string" && channel.snippet.title ? channel.snippet.title : "YouTube channel";
    return {
      externalId: channel.id,
      name: title,
      username: customUrl ? customUrl.replace(/^@/, "") : null,
      profileUrl: customUrl
        ? `https://www.youtube.com/${customUrl.startsWith("@") ? customUrl : `@${customUrl}`}`
        : `https://www.youtube.com/channel/${channel.id}`,
      avatarUrl:
        typeof channel.snippet?.thumbnails?.default?.url === "string"
          ? channel.snippet.thumbnails.default.url
          : null,
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
    const { title, description, tags } = this.metadata(input);
    const media = input.media[0]!;

    // The file, from wherever the media library keeps it. Nothing has been
    // sent to YouTube yet, so any failure here is a plain retry.
    const source = await this.fetch(media.url, {}, this.uploadTimeoutMs).catch(() => null);
    if (!source || !source.ok || !source.body) {
      throw new ValidationError("The video file could not be read from storage. It will be tried again.");
    }
    const size = Number(source.headers.get("content-length"));
    if (!Number.isFinite(size) || size <= 0) {
      await source.body.cancel();
      throw new ValidationError("Storage did not say how large the video is, so it cannot be uploaded.");
    }

    // 1. Open the session. Invisible: no video exists until the bytes arrive.
    const sessionUrl = await this.openSession(credentials, {
      title,
      description,
      tags,
      contentType: media.mimeType,
      size,
    }).catch(async (error: unknown) => {
      await source.body?.cancel().catch(() => undefined);
      throw error;
    });

    // 2. Stream the file in. This is the call that creates the video.
    let video: Video;
    try {
      const response = await this.fetch(
        sessionUrl,
        {
          method: "PUT",
          headers: { "content-type": media.mimeType, "content-length": String(size) },
          body: source.body,
          // Node needs this to send a stream as a request body. Not yet in
          // the DOM RequestInit type, hence the widening below.
          duplex: "half",
        } as RequestInit,
        this.uploadTimeoutMs,
      );
      if (response.ok) {
        video = (await response.json()) as Video;
      } else if (response.status >= 500) {
        video = await this.askSession(sessionUrl, size);
      } else {
        throw await this.error(response, "upload the video");
      }
    } catch (error) {
      if (!(error instanceof ProviderUnreachableError)) throw error;
      video = await this.askSession(sessionUrl, size);
    }

    if (typeof video.id !== "string") {
      throw new AmbiguousPublishError(
        "YouTube accepted the upload but did not say which video it is. Check the channel before retrying.",
      );
    }

    const warnings: string[] = [];
    const privacy = video.status?.privacyStatus;
    if (typeof privacy === "string" && privacy !== "public") {
      // Google locks uploads from API projects that have not passed its audit
      // to private. The video exists — failing the post would invite a retry
      // that uploads it again — so this is a warning the operator acts on.
      warnings.push(
        `YouTube kept this video ${privacy}. Google restricts uploads from API projects that have not passed YouTube's API audit; make it public in YouTube Studio, and see the setup notes.`,
      );
    }

    return {
      externalPostId: video.id,
      externalUrl:
        input.type === "YOUTUBE_SHORT"
          ? `https://www.youtube.com/shorts/${video.id}`
          : `https://www.youtube.com/watch?v=${video.id}`,
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  }

  /** Title, description and tags, refused here if YouTube would refuse them. */
  private metadata(input: PublishInput): { title: string; description: string; tags: string[] } {
    if (input.type !== "YOUTUBE_VIDEO" && input.type !== "YOUTUBE_SHORT") {
      throw new ValidationError(`YouTube cannot publish a ${input.type} post.`);
    }
    if (input.media.length !== 1 || !input.media[0]!.mimeType.startsWith("video/")) {
      throw new ValidationError("A YouTube upload needs exactly one video.");
    }

    const title = input.headline?.trim() ?? "";
    if (!title) throw new ValidationError("A YouTube video needs a title.");
    if (title.length > TITLE_MAX) {
      throw new ValidationError(`A YouTube title can be at most ${TITLE_MAX} characters.`);
    }

    const tags = input.hashtags.map((t) => t.trim().replace(/^#+/, "")).filter(Boolean);
    const parts: string[] = [];
    if (input.caption?.trim()) parts.push(input.caption.trim());
    const hashtags = tags.map((t) => `#${t}`);
    // A Short is recognised by its shape and length, not a flag — the API has
    // none. The hashtag is the one signal the uploader can add.
    if (input.type === "YOUTUBE_SHORT" && !tags.some((t) => t.toLowerCase() === "shorts")) {
      hashtags.push("#Shorts");
    }
    if (hashtags.length > 0) parts.push(hashtags.join(" "));
    const description = parts.join("\n\n");

    if (/[<>]/.test(title) || /[<>]/.test(description)) {
      throw new ValidationError("YouTube does not allow < or > in a title or description.");
    }
    if (Buffer.byteLength(description, "utf8") > DESCRIPTION_MAX_BYTES) {
      throw new ValidationError("That description is too long for YouTube once hashtags are added.");
    }
    if (tags.join(",").length > TAGS_MAX_CHARS) {
      throw new ValidationError(`YouTube allows at most ${TAGS_MAX_CHARS} characters of tags.`);
    }

    return { title, description, tags };
  }

  private async openSession(
    credentials: ProviderCredentials,
    meta: { title: string; description: string; tags: string[]; contentType: string; size: number },
  ): Promise<string> {
    const url = new URL(`${this.api}/upload/youtube/v3/videos`);
    url.searchParams.set("uploadType", "resumable");
    url.searchParams.set("part", "snippet,status");

    const response = await this.fetch(url.toString(), {
      method: "POST",
      headers: {
        ...this.auth(credentials),
        "content-type": "application/json; charset=UTF-8",
        "x-upload-content-length": String(meta.size),
        "x-upload-content-type": meta.contentType,
      },
      body: JSON.stringify({
        snippet: {
          title: meta.title,
          description: meta.description,
          ...(meta.tags.length > 0 ? { tags: meta.tags } : {}),
          categoryId: DEFAULT_CATEGORY,
        },
        // Public now: the engine publishes at the scheduled moment, so there
        // is nothing to hold back with `publishAt`.
        status: { privacyStatus: "public" },
      }),
    });
    if (!response.ok) throw await this.error(response, "start the upload");

    const location = response.headers.get("location");
    if (!location) throw new ValidationError("YouTube did not open an upload session.");
    return location;
  }

  /**
   * Ask a session whether it finished. An empty PUT with `bytes *\/size` is
   * the protocol's "how far did you get".
   */
  private async askSession(sessionUrl: string, size: number): Promise<Video> {
    let response: Response;
    try {
      response = await this.fetch(sessionUrl, {
        method: "PUT",
        headers: { "content-length": "0", "content-range": `bytes */${size}` },
      });
    } catch {
      throw new AmbiguousPublishError(
        "YouTube stopped answering during the upload, so the video may exist. Check the channel before retrying.",
      );
    }

    if (response.status === 200 || response.status === 201) return (await response.json()) as Video;
    if (response.status === 308) {
      // Incomplete: YouTube never creates a video from a partial upload.
      throw new ValidationError("The upload was interrupted before it finished. It will be tried again.");
    }
    throw new AmbiguousPublishError(
      "YouTube could not say whether the upload finished, so the video may exist. Check the channel before retrying.",
    );
  }

  // -------------------------------------------------------------------------
  // Metrics
  // -------------------------------------------------------------------------

  /**
   * Views, likes and comments. YouTube reports them as strings, and omits a
   * count the channel has hidden — which is absent, not zero. Watch time
   * needs the separate Analytics API and its own consent, so it stays null.
   */
  async getMetrics(
    credentials: ProviderCredentials,
    _account: { externalId: string },
    externalPostId: string,
  ): Promise<ProviderMetrics> {
    const url = new URL(`${this.api}/youtube/v3/videos`);
    url.searchParams.set("part", "statistics");
    url.searchParams.set("id", externalPostId);
    const response = await this.fetch(url.toString(), { headers: this.auth(credentials) });
    if (!response.ok) throw await this.error(response, "read video statistics");

    const json = (await response.json()) as {
      items?: { statistics?: { viewCount?: unknown; likeCount?: unknown; commentCount?: unknown } }[];
    };
    const stats = json.items?.[0]?.statistics;
    if (!json.items?.[0]) {
      throw new ValidationError("YouTube has no video with that id. It may have been deleted.");
    }

    const count = (value: unknown): number | null => {
      if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
      const n = Number(value);
      return Number.isSafeInteger(n) ? n : null;
    };

    return {
      videoViews: count(stats?.viewCount),
      likes: count(stats?.likeCount),
      comments: count(stats?.commentCount),
      reach: null,
      impressions: null,
      shares: null,
      saves: null,
      clicks: null,
      watchTimeSeconds: null,
      profileVisits: null,
      followersGained: null,
    };
  }

  // -------------------------------------------------------------------------
  // Plumbing
  // -------------------------------------------------------------------------

  private auth(credentials: ProviderCredentials): Record<string, string> {
    return { authorization: `Bearer ${credentials.accessToken}` };
  }

  private async fetch(url: string, init: RequestInit = {}, timeoutMs = this.timeoutMs): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal, cache: "no-store" });
    } catch (cause) {
      // An upload session URL can be used without the token, so it is logged
      // without its query string, like everything else.
      youtubeLog.error({ err: cause, url: redact(url) }, "youtube request could not be made");
      throw new ProviderUnreachableError("YouTube could not be reached. Try again in a moment.");
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Google errors carry a reason. Quota is the one operators will meet: an
   * upload costs a large share of the default daily quota, and the message
   * says so rather than "403".
   */
  private async error(response: Response, what: string): Promise<Error> {
    const text = await response.text().catch(() => "");
    let reasons: string[] = [];
    try {
      const parsed = JSON.parse(text) as GoogleError;
      reasons = (parsed.error?.errors ?? [])
        .map((e) => e.reason)
        .filter((r): r is string => typeof r === "string");
    } catch {
      // Not JSON; the status is all we have.
    }

    youtubeLog.error(
      { status: response.status, reasons, what, detail: text.slice(0, 500) },
      "youtube request failed",
    );

    if (response.status === 401 || reasons.includes("insufficientPermissions")) {
      return new CredentialsRejectedError(
        "YouTube rejected the credentials. Reconnect the channel to grant access again.",
      );
    }
    if (reasons.includes("quotaExceeded") || reasons.includes("dailyLimitExceeded")) {
      return new ValidationError(
        "YouTube's daily API quota is used up. Uploads resume when it resets at midnight Pacific time.",
      );
    }
    if (reasons.includes("uploadLimitExceeded")) {
      return new ValidationError("This channel has reached YouTube's upload limit for today.");
    }
    if (response.status === 429 || reasons.includes("rateLimitExceeded") || reasons.includes("userRateLimitExceeded")) {
      return new ValidationError("YouTube is rate limiting us. Try again shortly.");
    }
    return new ValidationError(`YouTube refused to ${what} (${response.status}).`);
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
