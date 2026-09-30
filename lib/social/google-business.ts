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
  AccountRef,
  ProviderAccount,
  ProviderCredentials,
  ProviderMetrics,
  PublishInput,
  PublishResult,
  SocialProviderAdapter,
} from "@/lib/social/types";

/**
 * Google Business Profile: posts on a business's Google listing.
 *
 * ## Three APIs, and a location that needs its account
 *
 * Google split Business Profile across several services. Accounts come from
 * the Account Management API and locations from the Business Information API
 * (both v1). Posts are still created through the older My Business API v4,
 * which addresses a location *through its account*:
 * `accounts/{a}/locations/{l}/localPosts`. So a connected location stores its
 * account in `SocialAccount.externalParentId`, and the canonical
 * `locations/{l}` stays the `externalId` — which keeps "this location is
 * already another client's" a single-column check.
 *
 * ## One sign-in, many locations
 *
 * Like Facebook Pages: the callback lists every location the sign-in manages
 * that Google says can take posts, and the operator chooses. Unlike Facebook,
 * the credentials stay the person's own Google tokens — there is no
 * per-location token — refreshed through the shared Google OAuth module.
 *
 * ## What it does not do
 *
 * **Metrics.** Google reports performance per location, not per post, so the
 * capability is declared off and nothing is collected. **Events and offers**:
 * only standard posts, which is what the editor produces.
 *
 * ## Checked against
 *
 * Account and location listing are from Google's published discovery
 * documents (Account Management v1 rev 20260512, Business Information v1 rev
 * 20260916), including the `canOperateLocalPost` flag used to decide what is
 * offered. **The v4 post call has no published discovery document**; its
 * shape is from Google's v4 reference as remembered, and it is the least
 * verified call in the social module. See `docs/SOCIAL-MODULE.md` §19.
 */

const gbpLog = log("social");

export const GOOGLE_BUSINESS_SCOPES = ["https://www.googleapis.com/auth/business.manage"] as const;

const LOCATION_ID = /^locations\/\d+$/;
const ACCOUNT_ID = /^accounts\/\d+$/;
const READ_MASK = "name,title,storefrontAddress,metadata";
/** Enough for any agency client; a bound, so one sign-in cannot page for ever. */
const MAX_PAGES = 20;

export type GoogleBusinessOptions = {
  clientId: string;
  clientSecret: string;
  /** Overrides for tests. Default to Google's own hosts. */
  authorizeUrl?: string;
  tokenUrl?: string;
  accountsBase?: string;
  infoBase?: string;
  postsBase?: string;
  timeoutMs?: number;
};

type Location = {
  name?: unknown;
  title?: unknown;
  storefrontAddress?: { locality?: unknown };
  metadata?: { canOperateLocalPost?: unknown; mapsUri?: unknown };
};

type GoogleError = { error?: { code?: unknown; status?: unknown; message?: unknown } };

export class GoogleBusinessProvider implements SocialProviderAdapter {
  readonly provider: SocialProvider = "GOOGLE_BUSINESS_PROFILE";
  readonly configured = true;
  readonly capabilities = CAPABILITIES.GOOGLE_BUSINESS_PROFILE;

  private readonly accountsApi: string;
  private readonly infoApi: string;
  private readonly postsApi: string;
  private readonly timeoutMs: number;
  private readonly oauth: GoogleOAuthConfig;

  constructor(options: GoogleBusinessOptions) {
    this.accountsApi = `${options.accountsBase ?? "https://mybusinessaccountmanagement.googleapis.com"}/v1`;
    this.infoApi = `${options.infoBase ?? "https://mybusinessbusinessinformation.googleapis.com"}/v1`;
    this.postsApi = `${options.postsBase ?? "https://mybusiness.googleapis.com"}/v4`;
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.oauth = {
      clientId: options.clientId,
      clientSecret: options.clientSecret,
      scopes: GOOGLE_BUSINESS_SCOPES,
      requiredScopes: GOOGLE_BUSINESS_SCOPES,
      label: "Google Business Profile",
      authorizeUrl: options.authorizeUrl,
      tokenUrl: options.tokenUrl,
    };
  }

  get label(): string {
    return PROVIDER_LABEL.GOOGLE_BUSINESS_PROFILE;
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

  /** Every location this sign-in manages that Google says can take posts. */
  async listAccounts(credentials: ProviderCredentials): Promise<ProviderAccount[]> {
    const accounts = await this.paged<{ name?: unknown }>(
      credentials,
      (pageToken) => {
        const url = new URL(`${this.accountsApi}/accounts`);
        url.searchParams.set("pageSize", "20");
        if (pageToken) url.searchParams.set("pageToken", pageToken);
        return url;
      },
      "accounts",
      "list your Business Profile accounts",
    );

    const found = new Map<string, ProviderAccount>();
    for (const account of accounts) {
      if (typeof account.name !== "string" || !ACCOUNT_ID.test(account.name)) continue;
      const accountName = account.name;
      const locations = await this.paged<Location>(
        credentials,
        (pageToken) => {
          const url = new URL(`${this.infoApi}/${accountName}/locations`);
          url.searchParams.set("readMask", READ_MASK);
          url.searchParams.set("pageSize", "100");
          if (pageToken) url.searchParams.set("pageToken", pageToken);
          return url;
        },
        "locations",
        "list the business locations",
      );

      for (const location of locations) {
        // Google omits false booleans, so only an explicit true counts. A
        // location that cannot take posts would connect and fail every time.
        if (location.metadata?.canOperateLocalPost !== true) continue;
        const parsed = this.toAccount(location, accountName);
        // The same location can be reachable through two accounts (a person's
        // own and an organisation's). Offered once, through the first.
        if (parsed && !found.has(parsed.externalId)) found.set(parsed.externalId, parsed);
      }
    }
    return [...found.values()];
  }

  async selectAccount(
    credentials: ProviderCredentials,
    externalId: string,
  ): Promise<{ account: ProviderAccount; credentials: ProviderCredentials }> {
    if (!LOCATION_ID.test(externalId)) throw new ValidationError("That is not a Business Profile location.");
    // Listed again rather than trusted from the picker: the account it is
    // reached through comes from Google, not from anything the browser sent.
    const account = (await this.listAccounts(credentials)).find((a) => a.externalId === externalId);
    if (!account) throw new ValidationError("That location is not available to this sign-in any more.");
    return { account, credentials };
  }

  async getAccount(credentials: ProviderCredentials, ref?: AccountRef): Promise<ProviderAccount> {
    if (!ref || !LOCATION_ID.test(ref.externalId)) {
      throw new ValidationError("Choose which business location to connect.");
    }
    const url = new URL(`${this.infoApi}/${ref.externalId}`);
    url.searchParams.set("readMask", READ_MASK);
    const response = await this.fetch(url.toString(), { headers: this.auth(credentials) });
    if (!response.ok) throw await this.error(response, "read the business location");

    const account = this.toAccount((await response.json()) as Location, ref.externalParentId ?? null);
    if (!account) throw new ValidationError("Google did not say which location this is.");
    return account;
  }

  private toAccount(location: Location, parent: string | null): ProviderAccount | null {
    if (typeof location.name !== "string" || !LOCATION_ID.test(location.name)) return null;
    const title = typeof location.title === "string" && location.title ? location.title : null;
    if (!title) return null;
    const locality =
      typeof location.storefrontAddress?.locality === "string" ? location.storefrontAddress.locality : null;
    return {
      externalId: location.name,
      externalParentId: parent,
      // Chains have many locations with one name; the town tells them apart.
      name: locality ? `${title} — ${locality}` : title,
      username: null,
      profileUrl: typeof location.metadata?.mapsUri === "string" ? location.metadata.mapsUri : null,
      avatarUrl: null,
    };
  }

  // -------------------------------------------------------------------------
  // Publishing
  // -------------------------------------------------------------------------

  async publish(
    credentials: ProviderCredentials,
    account: AccountRef,
    input: PublishInput,
  ): Promise<PublishResult> {
    const body = this.localPost(input);
    if (!LOCATION_ID.test(account.externalId) || !account.externalParentId || !ACCOUNT_ID.test(account.externalParentId)) {
      // Only reachable for a row connected before this adapter existed.
      throw new ValidationError("This location is missing its Google account. Reconnect it.");
    }
    const url = `${this.postsApi}/${account.externalParentId}/${account.externalId}/localPosts`;

    // The only call: creating the post is publishing it.
    let response: Response;
    try {
      response = await this.fetch(url, {
        method: "POST",
        headers: { ...this.auth(credentials), "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (error) {
      if (error instanceof ProviderUnreachableError) {
        throw new AmbiguousPublishError(
          "Google did not answer in time, so the post may be live. Check the Business Profile before retrying.",
        );
      }
      throw error;
    }
    if (response.status === 504) {
      throw new AmbiguousPublishError(
        "Google's gateway timed out, so the post may be live. Check the Business Profile before retrying.",
      );
    }
    if (!response.ok) throw await this.error(response, "publish the post");

    const post = (await response.json().catch(() => ({}))) as {
      name?: unknown;
      state?: unknown;
      searchUrl?: unknown;
    };
    if (typeof post.name !== "string") {
      throw new AmbiguousPublishError(
        "Google accepted the post but did not say which one it is. Check the Business Profile before retrying.",
      );
    }
    if (post.state === "REJECTED") {
      // It exists, invisibly. Retrying would make another that is rejected
      // the same way, so this is a failure with a reason, not a retry.
      throw new ValidationError(
        "Google rejected the post under its content policies. Edit it — phone numbers and links in the text are common causes — and send it again.",
      );
    }

    const warnings: string[] = [];
    if (post.state === "PROCESSING") {
      warnings.push("Google is still reviewing the post; it appears on the profile once approved.");
    }
    return {
      externalPostId: post.name,
      externalUrl: typeof post.searchUrl === "string" ? post.searchUrl : null,
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  }

  /** The v4 LocalPost for a standard post, refused here if Google would refuse it. */
  private localPost(input: PublishInput): Record<string, unknown> {
    if (input.type !== "GBP_POST") {
      throw new ValidationError(`Google Business Profile cannot publish a ${input.type} post.`);
    }
    const summary = input.caption?.trim() ?? "";
    if (!summary) throw new ValidationError("A Business Profile post needs some text.");

    if (input.media.length > 1) {
      throw new ValidationError("A Business Profile post shows one photo. Attach just one.");
    }
    const photo = input.media[0];
    if (photo && !(this.capabilities.acceptedMediaTypes ?? []).includes(photo.mimeType)) {
      throw new ValidationError("Business Profile posts take a JPEG or PNG photo.");
    }

    // A link with no button chosen gets "Learn more": on a Business Profile
    // post the button *is* the link, there is nowhere else to put it.
    const actionType = input.callToAction ?? (input.linkUrl ? "LEARN_MORE" : null);
    let callToAction: Record<string, string> | null = null;
    if (actionType) {
      const option = this.capabilities.callToActionOptions?.find((o) => o.value === actionType);
      if (!option) throw new ValidationError("Choose one of Google's buttons for the call to action.");
      if (option.needsLink && !input.linkUrl) {
        throw new ValidationError(`The "${option.label}" button needs a link to open.`);
      }
      callToAction = option.needsLink
        ? { actionType: option.value, url: input.linkUrl! }
        : { actionType: option.value };
    }

    return {
      languageCode: "en",
      topicType: "STANDARD",
      summary,
      ...(callToAction ? { callToAction } : {}),
      ...(photo ? { media: [{ mediaFormat: "PHOTO", sourceUrl: photo.url }] } : {}),
    };
  }

  /** Declared off in the capability table; the collector never calls this. */
  async getMetrics(): Promise<ProviderMetrics> {
    throw new ValidationError("Google Business Profile does not report metrics per post.");
  }

  // -------------------------------------------------------------------------
  // Plumbing
  // -------------------------------------------------------------------------

  private auth(credentials: ProviderCredentials): Record<string, string> {
    return { authorization: `Bearer ${credentials.accessToken}` };
  }

  private async paged<T>(
    credentials: ProviderCredentials,
    build: (pageToken: string | null) => URL,
    key: string,
    what: string,
  ): Promise<T[]> {
    const items: T[] = [];
    let token: string | null = null;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const response = await this.fetch(build(token).toString(), { headers: this.auth(credentials) });
      if (!response.ok) throw await this.error(response, what);
      const json = (await response.json()) as Record<string, unknown>;
      const batch = json[key];
      if (Array.isArray(batch)) items.push(...(batch as T[]));
      token = typeof json["nextPageToken"] === "string" && json["nextPageToken"] ? json["nextPageToken"] : null;
      if (!token) break;
    }
    return items;
  }

  private async fetch(url: string, init: RequestInit = {}): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal, cache: "no-store" });
    } catch (cause) {
      gbpLog.error({ err: cause, url: redact(url) }, "google business request could not be made");
      throw new ProviderUnreachableError("Google could not be reached. Try again in a moment.");
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * The failure operators will actually meet first is quota: a Google project
   * not yet approved for the Business Profile APIs has a quota of zero, and
   * every call comes back 429. Said in words, with where to fix it.
   */
  private async error(response: Response, what: string): Promise<Error> {
    const text = await response.text().catch(() => "");
    let status: unknown = null;
    try {
      status = (JSON.parse(text) as GoogleError).error?.status ?? null;
    } catch {
      // Not JSON; the status code is all we have.
    }

    gbpLog.error(
      { status: response.status, googleStatus: status, what, detail: text.slice(0, 500) },
      "google business request failed",
    );

    if (response.status === 401 || status === "UNAUTHENTICATED") {
      return new CredentialsRejectedError(
        "Google rejected the credentials. Reconnect the location to grant access again.",
      );
    }
    if (response.status === 429 || status === "RESOURCE_EXHAUSTED") {
      return new ValidationError(
        "Google is refusing Business Profile requests for quota. A Google project not yet approved for the Business Profile APIs has no quota at all — see the setup notes.",
      );
    }
    if (response.status === 403 || status === "PERMISSION_DENIED") {
      return new ValidationError(
        `Google refused to ${what}: the signed-in person may no longer manage this location, or the Business Profile APIs are not enabled for the project.`,
      );
    }
    return new ValidationError(`Google refused to ${what} (${response.status}).`);
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
