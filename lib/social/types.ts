import type { SocialPostType, SocialProvider } from "@/generated/prisma/enums";
import type { LengthRule } from "@/lib/social/text-length";

/**
 * The social provider abstraction.
 *
 * Modelled on `lib/payments`: an interface, a `configured` flag the UI reads
 * before offering anything, and an unconfigured implementation that throws a
 * typed error rather than pretending to work (CLAUDE.md 2 rule 5).
 *
 * The important difference from payments is **capabilities**. These six
 * providers are not interchangeable — Instagram cannot post a bare link, a
 * Google Business Profile has no carousel, X has no story — so an adapter
 * declares what it supports and the rest of the system asks rather than
 * assumes. Every "does this provider do X" question in the UI and in the
 * publishing engine resolves through `capabilities`, never through a
 * `provider === "INSTAGRAM"` branch scattered in a component.
 */

/** Copy fields a provider may or may not accept. */
export type SocialField =
  | "caption"
  | "headline"
  | "hashtags"
  | "mentions"
  | "callToAction"
  | "firstComment"
  | "linkUrl";

export type SocialCapabilities = {
  /** Post types this provider can publish. Empty means it cannot publish. */
  readonly postTypes: readonly SocialPostType[];
  /** Fields the editor should offer. Anything absent is not shown. */
  readonly fields: readonly SocialField[];
  /** Maximum caption length, where the provider imposes one. */
  readonly captionLimit: number | null;
  /** Maximum items in a carousel, where it supports one. */
  readonly carouselLimit: number | null;
  /** Whether metrics can be read back after publication. */
  readonly metrics: boolean;
  /**
   * Whether the account's recent posts can be listed — including ones made
   * directly on the platform, outside Emporia (brief §48). Matches whether the
   * adapter implements `listRecentPosts`; a test holds the two together.
   */
  readonly recentPosts: boolean;
  /** Whether the provider can schedule server-side, or we must hold and post. */
  readonly nativeScheduling: boolean;
  /**
   * File types the platform will actually publish. Absent means any image or
   * video. Checked when a creative is attached, so an unusable one is refused
   * in the editor rather than at publication time.
   */
  readonly acceptedMediaTypes?: readonly string[];
  /**
   * Fields the platform will not publish without. Checked before a version is
   * sent for client sign-off, so a post cannot be approved in a state the
   * platform refuses at publication.
   */
  readonly requiredFields?: readonly SocialField[];
  /**
   * Where the platform's call to action is a fixed set of buttons rather than
   * free text: the values it accepts, with how the editor labels them. The
   * editor offers a list instead of a text box, and anything else is refused
   * on save.
   */
  readonly callToActionOptions?: readonly { value: string; label: string; needsLink: boolean }[];
  /**
   * How the caption limit is counted, where it is not plain characters, and
   * what rides in the text alongside the caption. X counts links as 23 and
   * emoji as two, and puts mentions and the link in the post itself.
   */
  readonly lengthRule?: LengthRule;
  readonly linkInText?: boolean;
};

/** What a connected account looks like to us, whatever the provider calls it. */
export type ProviderAccount = {
  externalId: string;
  /** See `SocialAccount.externalParentId`. Absent for most providers. */
  externalParentId?: string | null;
  name: string;
  username: string | null;
  profileUrl: string | null;
  avatarUrl: string | null;
};

/** Credentials as stored. The adapter is the only thing that sees these. */
export type ProviderCredentials = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  /**
   * The permissions the platform said it granted with this token — see
   * `lib/social/scopes.ts`. Absent or null: it did not say. Never filled in
   * with what was requested.
   */
  scopes?: readonly string[] | null;
};

export type PublishInput = {
  type: SocialPostType;
  caption: string | null;
  headline: string | null;
  hashtags: readonly string[];
  mentions: readonly string[];
  callToAction: string | null;
  firstComment: string | null;
  /** Already UTM-tagged by the publishing service — adapters never build it. */
  linkUrl: string | null;
  /** Public URLs of the creatives, in order. */
  media: readonly { url: string; mimeType: string; thumbnailUrl: string | null }[];
};

export type PublishResult = {
  externalPostId: string;
  externalUrl: string | null;
  /**
   * Things that did not work *after* the post went live — a first comment that
   * could not be added, say. Never a reason to fail the publication: the post
   * exists, and failing it would invite a retry that duplicates it.
   */
  warnings?: string[];
};

/** A day of metrics as the provider reports it. Absent ≠ zero. */
export type ProviderMetrics = {
  reach?: number | null;
  impressions?: number | null;
  likes?: number | null;
  comments?: number | null;
  shares?: number | null;
  saves?: number | null;
  clicks?: number | null;
  videoViews?: number | null;
  watchTimeSeconds?: number | null;
  profileVisits?: number | null;
  followersGained?: number | null;
};

/** A flow's PKCE code verifier, derived server-side and never sent to the browser. */
export type Pkce = { verifier: string };

/** How the engine names a connected account to its adapter. */
export type AccountRef = { externalId: string; externalParentId?: string | null };

export interface SocialProviderAdapter {
  readonly provider: SocialProvider;
  /** Human name, for the screen. */
  readonly label: string;
  /** Whether app credentials exist for this provider in this deployment. */
  readonly configured: boolean;
  readonly capabilities: SocialCapabilities;

  /**
   * Where to send the browser to begin OAuth.
   *
   * `pkce` carries the flow's code verifier (see `pkceVerifier`). Every flow
   * has one; adapters whose platform does not use PKCE ignore it.
   */
  authorizationUrl(state: string, redirectUri: string, pkce?: Pkce): string;
  /** Exchange the callback code for credentials. */
  exchangeCode(code: string, redirectUri: string, pkce?: Pkce): Promise<ProviderCredentials>;
  /** Refresh before expiry, where the provider supports it. */
  refresh(credentials: ProviderCredentials): Promise<ProviderCredentials>;
  /**
   * True when the platform extends a token by presenting the token itself
   * rather than a separate refresh token. Instagram works this way: a
   * long-lived token is exchanged for a fresh one before it expires, and no
   * refresh token is ever issued. Without this flag the refresh path would see
   * "no refresh token" and let the account quietly expire at sixty days.
   */
  readonly refreshesWithAccessToken?: boolean;
  /**
   * Read the connected account, and prove the credentials still work.
   *
   * `account` is passed when re-checking one already connected. Adapters whose
   * sign-in *is* the account ignore it; one where a sign-in reaches many
   * (Business Profile locations) needs it to know which to read.
   */
  getAccount(credentials: ProviderCredentials, account?: AccountRef): Promise<ProviderAccount>;
  /**
   * Present when one sign-in reaches several publishable accounts — a
   * Facebook user's Pages, a Google login's business locations. The callback
   * lists them, the operator picks one, and `selectAccount` turns the sign-in
   * into that account's own credentials.
   *
   * Absent for platforms where the sign-in *is* the account (LinkedIn,
   * Instagram): `getAccount` answers directly.
   */
  listAccounts?(credentials: ProviderCredentials): Promise<ProviderAccount[]>;
  selectAccount?(
    credentials: ProviderCredentials,
    externalId: string,
  ): Promise<{ account: ProviderAccount; credentials: ProviderCredentials }>;
  /** Publish. Returns the provider's own id so we never publish it twice. */
  publish(
    credentials: ProviderCredentials,
    account: AccountRef,
    input: PublishInput,
  ): Promise<PublishResult>;
  /** Metrics for one published post. */
  getMetrics(
    credentials: ProviderCredentials,
    account: AccountRef,
    externalPostId: string,
  ): Promise<ProviderMetrics>;
  /**
   * The account's own public posts published since `since`, newest first.
   * Present only where the platform lets this app read them with the
   * permissions it already requests; see `SocialCapabilities.recentPosts`.
   */
  listRecentPosts?(
    credentials: ProviderCredentials,
    account: AccountRef,
    since: Date,
  ): Promise<ProviderRecentPost[]>;
}

/**
 * A post as the platform lists it. Only public, published posts — never a
 * draft, a private video or a story that has already vanished.
 */
export type ProviderRecentPost = {
  externalPostId: string;
  externalUrl: string | null;
  /** The platform's own words, for recognising it; never edited. */
  caption: string | null;
  /** The platform's own format name ("REELS", "VIDEO", "CAROUSEL_ALBUM"...). */
  format: string | null;
  thumbnailUrl: string | null;
  publishedAt: Date;
  /**
   * Other ids the platform knows this post by. Facebook lists a video post by
   * its page-qualified post id, while publishing stores the video's own id;
   * without the alias, a video Emporia published would read as one the
   * client posted directly.
   */
  aliases?: readonly string[];
};
