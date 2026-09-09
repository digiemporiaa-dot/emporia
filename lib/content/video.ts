/**
 * Video embeds from an allow-listed provider.
 *
 * The editor pastes a URL or an id; this extracts the id and the renderer
 * builds the iframe. There is no field anywhere that accepts embed markup, and
 * that is deliberate: nothing in this codebase reaches
 * `dangerouslySetInnerHTML`, so there is no sanitiser to keep current and no
 * stored-XSS surface. Supporting "paste your embed code" would give up both.
 *
 * An id that does not match its provider's format returns null, and the
 * renderer shows nothing rather than an iframe pointed at whatever was typed.
 */

export type VideoProvider = "youtube" | "vimeo";

/** YouTube ids are 11 characters of the URL-safe alphabet. Vimeo ids are digits. */
const ID_PATTERN: Record<VideoProvider, RegExp> = {
  youtube: /^[A-Za-z0-9_-]{11}$/,
  vimeo: /^\d{6,12}$/,
};

/**
 * Hosts we will read an id out of.
 *
 * Matching the host rather than searching the string means a URL pointing at
 * another site cannot smuggle something that merely looks like an id.
 */
const HOSTS: Record<VideoProvider, readonly string[]> = {
  youtube: ["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "www.youtu.be"],
  vimeo: ["vimeo.com", "www.vimeo.com", "player.vimeo.com"],
};

function idFromUrl(provider: VideoProvider, url: URL): string | null {
  const host = url.hostname.toLowerCase();
  if (!HOSTS[provider].includes(host)) return null;

  if (provider === "youtube") {
    // youtu.be/<id>, /watch?v=<id>, /embed/<id>, /shorts/<id>, /live/<id>
    if (host.endsWith("youtu.be")) return url.pathname.slice(1).split("/")[0] ?? null;
    const v = url.searchParams.get("v");
    if (v) return v;
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length >= 2 && ["embed", "shorts", "live", "v"].includes(parts[0] ?? "")) {
      return parts[1] ?? null;
    }
    return null;
  }

  // vimeo.com/<id>, player.vimeo.com/video/<id>, vimeo.com/channels/x/<id>
  const digits = url.pathname.split("/").filter(Boolean).reverse();
  return digits.find((part) => /^\d+$/.test(part)) ?? null;
}

/** The id, or null when the value is neither a valid id nor a URL holding one. */
export function videoId(provider: VideoProvider, value: string): string | null {
  const raw = value.trim();
  if (!raw) return null;

  if (ID_PATTERN[provider].test(raw)) return raw;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  // Only http(s): a `javascript:` URL parses fine and must not reach the host
  // check as though it were an address.
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  const id = idFromUrl(provider, url);
  return id && ID_PATTERN[provider].test(id) ? id : null;
}

/**
 * The embed URL for a validated id.
 *
 * Built from the id alone. Nothing the editor typed reaches the src beyond the
 * eleven or so characters that passed the pattern above.
 */
export function videoEmbedUrl(provider: VideoProvider, id: string): string | null {
  if (!ID_PATTERN[provider].test(id)) return null;
  return provider === "youtube"
    ? `https://www.youtube-nocookie.com/embed/${id}`
    : `https://player.vimeo.com/video/${id}`;
}
