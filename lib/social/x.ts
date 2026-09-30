import "server-only";
import { parseGrantedScopes } from "@/lib/social/scopes";
import { ValidationError } from "@/lib/errors";
import {
  AmbiguousPublishError,
  CredentialsRejectedError,
  ProviderUnreachableError,
} from "@/lib/social/errors";
import { CAPABILITIES, PROVIDER_LABEL } from "@/lib/social/capabilities";
import { pkceChallenge } from "@/lib/social/oauth-state";
import { textLength } from "@/lib/social/text-length";
import { log } from "@/lib/logger";
import type { SocialProvider } from "@/generated/prisma/enums";
import type {
  AccountRef,
  Pkce,
  ProviderAccount,
  ProviderCredentials,
  ProviderMetrics,
  PublishInput,
  PublishResult,
  SocialProviderAdapter,
} from "@/lib/social/types";

/**
 * X, through the v2 API with OAuth 2.0 and PKCE.
 *
 * ## Connecting
 *
 * X's OAuth 2.0 requires PKCE. The verifier is derived server-side from the
 * flow's nonce (`pkceVerifier`), so the start and the callback agree on it
 * without a cookie or a table, and it never travels. X's refresh tokens are
 * **single-use and rotate**: each renewal returns a new one and spends the
 * old. The credential service renews one account at a time under a lock for
 * exactly this reason, and stores the new refresh token every time.
 *
 * ## Publishing
 *
 * Creatives are uploaded to X first — X does not fetch from a URL — through
 * the v2 chunked upload: initialise, append the file in segments streamed
 * from storage, finalise, and for video wait for processing. None of that is
 * visible. The post itself is one call, `POST /2/tweets`, the only one that
 * may be ambiguous.
 *
 * X refuses a post whose text duplicates a recent one from the same account.
 * That refusal is surfaced in words: after an uncertain attempt it usually
 * means the first one went out.
 *
 * ## Checked against
 *
 * Post creation and the user lookup are from X's own generated TypeScript
 * SDK (OpenAPI types). The OAuth 2.0 endpoints, scopes and the v2 media
 * upload are from `twitter-api-v2`, the most widely used client, whose
 * current source targets `api.x.com`. X's developer site is not reachable
 * from the build environment. Not run against a real account. See
 * `docs/SOCIAL-MODULE.md` §20.
 */

const xLog = log("social");

export const X_SCOPES = ["tweet.read", "tweet.write", "users.read", "media.write", "offline.access"] as const;

/** Segment size for chunked uploads: X's documented maximum per append is 5 MB. */
const CHUNK_BYTES = 4 * 1024 * 1024;

export type XOptions = {
  clientId: string;
  clientSecret: string;
  /** Overrides for tests. Default to X's own hosts. */
  authorizeBase?: string;
  apiBase?: string;
  timeoutMs?: number;
  /** For video processing: how long to wait in total before trying next run. */
  processingTimeoutMs?: number;
  /** Cap on X's own `check_after_secs`, so tests (and cron runs) are bounded. */
  maxPollIntervalMs?: number;
};

type XProblem = { detail?: unknown; title?: unknown; type?: unknown; errors?: { message?: unknown }[] };

export class XProvider implements SocialProviderAdapter {
  readonly provider: SocialProvider = "X";
  readonly configured = true;
  readonly capabilities = CAPABILITIES.X;

  private readonly authorizeBase: string;
  private readonly api: string;
  private readonly timeoutMs: number;
  private readonly processingTimeoutMs: number;
  private readonly maxPollIntervalMs: number;

  constructor(private readonly options: XOptions) {
    this.authorizeBase = options.authorizeBase ?? "https://x.com";
    this.api = `${options.apiBase ?? "https://api.x.com"}/2`;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.processingTimeoutMs = options.processingTimeoutMs ?? 90_000;
    this.maxPollIntervalMs = options.maxPollIntervalMs ?? 10_000;
  }

  get label(): string {
    return PROVIDER_LABEL.X;
  }

  // -------------------------------------------------------------------------
  // Connection
  // -------------------------------------------------------------------------

  authorizationUrl(state: string, redirectUri: string, pkce?: Pkce): string {
    if (!pkce) throw new ValidationError("X requires PKCE; the flow did not provide a verifier.");
    const url = new URL(`${this.authorizeBase}/i/oauth2/authorize`);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", this.options.clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("scope", X_SCOPES.join(" "));
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", pkceChallenge(pkce.verifier));
    url.searchParams.set("code_challenge_method", "S256");
    return url.toString();
  }

  async exchangeCode(code: string, redirectUri: string, pkce?: Pkce): Promise<ProviderCredentials> {
    if (!pkce) throw new ValidationError("X requires PKCE; the flow did not provide a verifier.");
    return this.token(
      {
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
        code_verifier: pkce.verifier,
        client_id: this.options.clientId,
      },
      "connect the account",
    );
  }

  refresh(credentials: ProviderCredentials): Promise<ProviderCredentials> {
    if (!credentials.refreshToken) {
      throw new CredentialsRejectedError("X has no lasting access for this account. Reconnect it.");
    }
    return this.token(
      { refresh_token: credentials.refreshToken, grant_type: "refresh_token", client_id: this.options.clientId },
      "renew access",
    );
  }

  async getAccount(credentials: ProviderCredentials): Promise<ProviderAccount> {
    const url = new URL(`${this.api}/users/me`);
    url.searchParams.set("user.fields", "profile_image_url,username,name");
    const response = await this.fetch(url.toString(), { headers: this.auth(credentials) });
    if (!response.ok) throw await this.error(response, "read the X account");

    const json = (await response.json()) as {
      data?: { id?: unknown; name?: unknown; username?: unknown; profile_image_url?: unknown };
    };
    const me = json.data;
    if (!me || typeof me.id !== "string" || typeof me.username !== "string") {
      throw new ValidationError("X did not say which account this is.");
    }
    return {
      externalId: me.id,
      name: typeof me.name === "string" && me.name ? me.name : `@${me.username}`,
      username: me.username,
      profileUrl: `https://x.com/${me.username}`,
      avatarUrl: typeof me.profile_image_url === "string" ? me.profile_image_url : null,
    };
  }

  // -------------------------------------------------------------------------
  // Publishing
  // -------------------------------------------------------------------------

  async publish(
    credentials: ProviderCredentials,
    _account: AccountRef,
    input: PublishInput,
  ): Promise<PublishResult> {
    const text = this.text(input);
    this.assertPublishable(input, text);

    // Invisible until the post references it; safe to repeat.
    const mediaIds: string[] = [];
    for (const item of input.media) mediaIds.push(await this.upload(credentials, item));

    let response: Response;
    try {
      response = await this.fetch(`${this.api}/tweets`, {
        method: "POST",
        headers: { ...this.auth(credentials), "content-type": "application/json" },
        body: JSON.stringify({ text, ...(mediaIds.length > 0 ? { media: { media_ids: mediaIds } } : {}) }),
      });
    } catch (error) {
      if (error instanceof ProviderUnreachableError) {
        throw new AmbiguousPublishError(
          "X did not answer in time, so the post may be live. Check the account before retrying.",
        );
      }
      throw error;
    }
    if (response.status === 504) {
      throw new AmbiguousPublishError(
        "X's gateway timed out, so the post may be live. Check the account before retrying.",
      );
    }
    if (!response.ok) throw await this.error(response, "publish the post");

    const json = (await response.json().catch(() => ({}))) as { data?: { id?: unknown } };
    const id = json.data?.id;
    if (typeof id !== "string") {
      throw new AmbiguousPublishError(
        "X accepted the post but did not say which one it is. Check the account before retrying.",
      );
    }

    // X resolves /i/web/status/{id} to the post whatever the handle.
    return { externalPostId: id, externalUrl: `https://x.com/i/web/status/${id}` };
  }

  /** Caption, mentions, link, hashtags — in the order a reader meets them. */
  private text(input: PublishInput): string {
    const parts: string[] = [];
    if (input.caption?.trim()) parts.push(input.caption.trim());
    const mentions = input.mentions.map((m) => m.trim().replace(/^@+/, "")).filter(Boolean);
    if (mentions.length > 0) parts.push(mentions.map((m) => `@${m}`).join(" "));
    if (input.linkUrl) parts.push(input.linkUrl);
    const tags = input.hashtags.map((t) => t.trim().replace(/^#+/, "")).filter(Boolean);
    if (tags.length > 0) parts.push(tags.map((t) => `#${t}`).join(" "));
    return parts.join("\n\n");
  }

  private assertPublishable(input: PublishInput, text: string): void {
    const limit = this.capabilities.captionLimit ?? 280;
    const length = textLength(text, "x-weighted");
    if (length > limit) {
      throw new ValidationError(
        `That post is ${length} characters the way X counts them; the limit is ${limit}.`,
      );
    }

    const accepted = this.capabilities.acceptedMediaTypes ?? [];
    switch (input.type) {
      case "TEXT":
        if (!text) throw new ValidationError("A text post needs some text.");
        if (input.media.length > 0) {
          throw new ValidationError("A text post carries no creative. Use a single image or a video.");
        }
        return;
      case "SINGLE_IMAGE":
        if (input.media.length !== 1 || !input.media[0]!.mimeType.startsWith("image/")) {
          throw new ValidationError("A single-image post needs exactly one image.");
        }
        if (!accepted.includes(input.media[0]!.mimeType)) {
          throw new ValidationError("X takes JPEG, PNG, GIF or WebP images.");
        }
        return;
      case "VIDEO":
        if (input.media.length !== 1 || input.media[0]!.mimeType !== "video/mp4") {
          throw new ValidationError("A video post on X needs exactly one MP4 video.");
        }
        return;
      default:
        throw new ValidationError(`X cannot publish a ${input.type} post.`);
    }
  }

  /**
   * Chunked upload, streamed from storage: initialise, append in segments,
   * finalise, then wait for video to process. Returns the media id.
   */
  private async upload(
    credentials: ProviderCredentials,
    item: PublishInput["media"][number],
  ): Promise<string> {
    const source = await this.fetch(item.url).catch(() => null);
    if (!source || !source.ok || !source.body) {
      throw new ValidationError("The creative could not be read from storage. It will be tried again.");
    }
    const size = Number(source.headers.get("content-length"));
    if (!Number.isFinite(size) || size <= 0) {
      await source.body.cancel();
      throw new ValidationError("Storage did not say how large the creative is, so it cannot be uploaded.");
    }

    const video = item.mimeType.startsWith("video/");
    const init = (await this.json(
      `${this.api}/media/upload/initialize`,
      credentials,
      {
        media_type: item.mimeType,
        total_bytes: size,
        media_category: video ? "tweet_video" : item.mimeType === "image/gif" ? "tweet_gif" : "tweet_image",
      },
      "start the upload",
    )) as { data?: { id?: unknown } };
    const mediaId = init.data?.id;
    if (typeof mediaId !== "string") throw new ValidationError("X did not open an upload.");

    // Segments are cut from the stream as it arrives, so a large video is
    // never held in memory whole.
    let segment = 0;
    let buffered: Uint8Array[] = [];
    let bufferedBytes = 0;
    const flush = async () => {
      if (bufferedBytes === 0) return;
      const form = new FormData();
      form.set("segment_index", String(segment));
      // One contiguous segment, in a buffer of its own.
      const joined = new Uint8Array(bufferedBytes);
      let offset = 0;
      for (const piece of buffered) {
        joined.set(piece, offset);
        offset += piece.byteLength;
      }
      form.set("media", new Blob([joined], { type: "application/octet-stream" }));
      const response = await this.fetch(`${this.api}/media/upload/${mediaId}/append`, {
        method: "POST",
        headers: this.auth(credentials),
        body: form,
      });
      if (!response.ok) throw await this.error(response, "upload the creative");
      segment += 1;
      buffered = [];
      bufferedBytes = 0;
    };
    const reader = source.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffered.push(value);
      bufferedBytes += value.byteLength;
      if (bufferedBytes >= CHUNK_BYTES) await flush();
    }
    await flush();

    const finalized = (await this.json(
      `${this.api}/media/upload/${mediaId}/finalize`,
      credentials,
      undefined,
      "finish the upload",
    )) as { data?: { processing_info?: { state?: unknown; check_after_secs?: unknown } } };

    if (finalized.data?.processing_info) await this.waitForProcessing(credentials, mediaId, finalized.data.processing_info);
    return mediaId;
  }

  private async waitForProcessing(
    credentials: ProviderCredentials,
    mediaId: string,
    initial: { state?: unknown; check_after_secs?: unknown },
  ): Promise<void> {
    const deadline = Date.now() + this.processingTimeoutMs;
    let info = initial;
    for (;;) {
      if (info.state === "succeeded") return;
      if (info.state === "failed") {
        throw new ValidationError("X could not process the video. Check its format and length.");
      }
      const wait = Math.min(
        typeof info.check_after_secs === "number" ? info.check_after_secs * 1000 : 1000,
        this.maxPollIntervalMs,
      );
      if (Date.now() + wait > deadline) {
        // Nothing has been posted; the next run starts the upload again.
        throw new ValidationError("X is still processing the video. It will be tried again on the next run.");
      }
      await new Promise((resolve) => setTimeout(resolve, wait));

      const url = new URL(`${this.api}/media/upload`);
      url.searchParams.set("command", "STATUS");
      url.searchParams.set("media_id", mediaId);
      const response = await this.fetch(url.toString(), { headers: this.auth(credentials) });
      if (!response.ok) throw await this.error(response, "check the video's processing");
      const json = (await response.json()) as { data?: { processing_info?: typeof info } };
      info = json.data?.processing_info ?? { state: "succeeded" };
    }
  }

  /** Declared off in the capability table: reading metrics needs a paid tier. */
  async getMetrics(): Promise<ProviderMetrics> {
    throw new ValidationError("Reading post metrics from X needs a paid API tier.");
  }

  // -------------------------------------------------------------------------
  // Plumbing
  // -------------------------------------------------------------------------

  private auth(credentials: ProviderCredentials): Record<string, string> {
    return { authorization: `Bearer ${credentials.accessToken}` };
  }

  /** X's token endpoint takes a confidential client's secret as Basic auth. */
  private async token(form: Record<string, string>, what: string): Promise<ProviderCredentials> {
    const basic = Buffer.from(`${this.options.clientId}:${this.options.clientSecret}`).toString("base64");
    const response = await this.fetch(`${this.api}/oauth2/token`, {
      method: "POST",
      headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form).toString(),
    });

    if (!response.ok) {
      const error = await this.error(response, what);
      // A refused grant — revoked, or a refresh token already spent — is a
      // dead connection, not a bad minute.
      if (response.status === 400 || response.status === 401) {
        throw new CredentialsRejectedError("X no longer accepts this connection. Reconnect the account.");
      }
      throw error;
    }

    const json = (await response.json()) as {
      access_token?: unknown;
      refresh_token?: unknown;
      expires_in?: unknown;
      scope?: unknown;
    };
    if (typeof json.access_token !== "string") throw new ValidationError("X did not return an access token.");
    if (typeof json.refresh_token !== "string") {
      // Without offline access the connection dies in two hours.
      throw new ValidationError("X did not grant lasting access. Connect again and allow every permission.");
    }
    const granted = new Set(typeof json.scope === "string" ? json.scope.split(" ") : []);
    if (granted.size > 0 && (!granted.has("tweet.write") || !granted.has("media.write"))) {
      throw new ValidationError("X did not grant permission to post. Connect again and allow every permission.");
    }
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      expiresAt: typeof json.expires_in === "number" ? new Date(Date.now() + json.expires_in * 1000) : null,
      scopes: parseGrantedScopes(json.scope),
    };
  }

  private async json(
    url: string,
    credentials: ProviderCredentials,
    body: Record<string, unknown> | undefined,
    what: string,
  ): Promise<unknown> {
    const response = await this.fetch(url, {
      method: "POST",
      headers: { ...this.auth(credentials), ...(body ? { "content-type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) throw await this.error(response, what);
    return response.json();
  }

  private async fetch(url: string, init: RequestInit = {}): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal, cache: "no-store" });
    } catch (cause) {
      xLog.error({ err: cause, url: redact(url) }, "x request could not be made");
      throw new ProviderUnreachableError("X could not be reached. Try again in a moment.");
    } finally {
      clearTimeout(timer);
    }
  }

  private async error(response: Response, what: string): Promise<Error> {
    const text = await response.text().catch(() => "");
    let detail = "";
    try {
      const problem = JSON.parse(text) as XProblem;
      detail = [problem.detail, problem.title, ...(problem.errors ?? []).map((e) => e.message)]
        .filter((d): d is string => typeof d === "string")
        .join(" ");
    } catch {
      // Not JSON; the status is all we have.
    }

    xLog.error({ status: response.status, what, detail: text.slice(0, 500) }, "x request failed");

    if (/duplicate content/i.test(detail)) {
      return new ValidationError(
        "X refused this as a duplicate of a recent post from this account. If an earlier attempt already went out, mark it published; otherwise change the text.",
      );
    }
    if (response.status === 401) {
      return new CredentialsRejectedError("X rejected the credentials. Reconnect the account to grant access again.");
    }
    if (response.status === 429) {
      const reset = Number(response.headers.get("x-rate-limit-reset"));
      const when = Number.isFinite(reset) && reset > 0 ? ` after ${new Date(reset * 1000).toISOString().slice(11, 16)} UTC` : " shortly";
      return new ValidationError(`X is rate limiting this app. Try again${when}.`);
    }
    if (response.status === 403) {
      return new ValidationError(
        `X refused to ${what}. The app may lack write access, or the X API plan may not allow it.`,
      );
    }
    return new ValidationError(`X refused to ${what} (${response.status}).`);
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
