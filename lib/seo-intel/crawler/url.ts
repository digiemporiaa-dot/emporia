/**
 * URL handling for the crawler. Pure, shared by the fetcher, the parser and
 * the rules, so every part agrees on when two URLs are the same page.
 */

const SKIP_EXTENSIONS = new Set([
  "jpg", "jpeg", "png", "gif", "webp", "avif", "svg", "ico", "bmp", "tif", "tiff",
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "csv", "txt", "rtf",
  "zip", "gz", "tgz", "rar", "7z", "dmg", "exe", "apk",
  "mp3", "mp4", "m4a", "wav", "ogg", "webm", "mov", "avi", "mkv",
  "css", "js", "mjs", "json", "xml", "rss", "atom", "woff", "woff2", "ttf", "otf", "eot",
]);

/**
 * Absolute, comparable form of a link: http(s) only, no fragment, lower-case
 * host, default port dropped. Null for anything the crawler cannot follow
 * (mailto:, tel:, javascript:, data:, malformed).
 */
export function normalizeUrl(href: string, base?: string): string | null {
  const trimmed = href.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = base ? new URL(trimmed, base) : new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  if ((url.protocol === "http:" && url.port === "80") || (url.protocol === "https:" && url.port === "443")) {
    url.port = "";
  }
  return url.toString();
}

/** The property's host and its www / non-www twin: a site redirecting between them is still itself. */
export function siteHosts(domain: string): Set<string> {
  const host = domain.toLowerCase();
  const bare = host.startsWith("www.") ? host.slice(4) : host;
  return new Set([bare, `www.${bare}`]);
}

export function isOnSite(url: string, hosts: Set<string>): boolean {
  try {
    const parsed = new URL(url);
    return hosts.has(parsed.hostname.toLowerCase()) && !parsed.port;
  } catch {
    return false;
  }
}

/** Files the crawler does not download: images, documents, media, assets. */
export function isLikelyNonHtml(url: string): boolean {
  try {
    const path = new URL(url).pathname;
    const dot = path.lastIndexOf(".");
    if (dot < 0 || dot < path.lastIndexOf("/")) return false;
    return SKIP_EXTENSIONS.has(path.slice(dot + 1).toLowerCase());
  } catch {
    return true;
  }
}

/** Path plus query, which is what robots.txt rules match against. */
export function robotsPath(url: string): string {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
}
