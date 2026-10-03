/**
 * What may be typed as a website, judged by its spelling alone.
 *
 * Pure and dependency-free, so the same rules run in a form, in validation and
 * on the server. Whether the name *resolves* somewhere safe is a separate,
 * server-only check (`./safe-url`).
 */

export class UnsafeTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeTargetError";
  }
}

/** Suffixes that never name a public website (RFC 6761, 6762, 2606, common internal zones). */
const RESERVED_SUFFIXES = [
  "localhost",
  "local",
  "localdomain",
  "internal",
  "intranet",
  "lan",
  "home",
  "home.arpa",
  "corp",
  "test",
  "example",
  "invalid",
  "onion",
  "arpa",
];

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

/**
 * A host name that could be a public website, or the reason it cannot. Expects
 * the ASCII (punycode) form, which is what `URL` produces.
 */
export function hostProblem(host: string): string | null {
  const name = host.replace(/\.$/, "").toLowerCase();
  if (!name) return "Enter a domain.";
  if (name.length > 253) return "That domain is too long.";
  if (/^\[.*\]$/.test(name) || name.includes(":") || /^[0-9.]+$/.test(name) || /^0x[0-9a-f]+$/i.test(name)) {
    return "Enter a domain name, not an IP address.";
  }
  const labels = name.split(".");
  if (labels.length < 2) return "Enter a full domain, such as example.com.";
  if (!labels.every((label) => LABEL.test(label))) return "That is not a valid domain name.";
  const tld = labels.at(-1) as string;
  if (/^[0-9]+$/.test(tld)) return "That is not a valid domain name.";
  if (RESERVED_SUFFIXES.some((suffix) => name === suffix || name.endsWith(`.${suffix}`))) {
    return "That domain is reserved for private or test use and is not a public website.";
  }
  return null;
}

/**
 * What an admin typed into "Website" — `example.com`, `https://www.Example.com/`,
 * `http://example.com/some/page` — reduced to a host and a protocol.
 *
 * The path is dropped on purpose: a property is a whole site. A port, a user
 * name or a scheme other than http(s) is refused rather than dropped, because
 * each is a sign the target is not an ordinary public website.
 */
export function parseSiteInput(raw: string): { domain: string; protocol: "HTTPS" | "HTTP" | null } {
  const trimmed = raw.trim();
  if (!trimmed) throw new UnsafeTargetError("Enter a domain.");
  if (/\s/.test(trimmed)) throw new UnsafeTargetError("A domain cannot contain spaces.");

  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed);
  if (!hasScheme && /^[a-z][a-z0-9+.-]*:/i.test(trimmed) && !/^[^:]+:\d+(\/|$)/.test(trimmed)) {
    throw new UnsafeTargetError("Use a web address starting with http:// or https://, or just the domain.");
  }

  let url: URL;
  try {
    url = new URL(hasScheme ? trimmed : `https://${trimmed}`);
  } catch {
    throw new UnsafeTargetError("That is not a valid domain or web address.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new UnsafeTargetError("Only http:// and https:// websites can be added.");
  }
  if (url.username || url.password) throw new UnsafeTargetError("A web address with a user name or password cannot be added.");
  if (url.port) throw new UnsafeTargetError("Websites on a non-standard port cannot be added.");

  const problem = hostProblem(url.hostname);
  if (problem) throw new UnsafeTargetError(problem);

  return {
    domain: url.hostname.replace(/\.$/, "").toLowerCase(),
    protocol: hasScheme ? (url.protocol === "https:" ? "HTTPS" : "HTTP") : null,
  };
}

/** A URL the crawler may request, by its spelling. Resolution is checked separately. */
export function assertSafeUrl(raw: string | URL): URL {
  let url: URL;
  try {
    url = typeof raw === "string" ? new URL(raw) : new URL(raw.toString());
  } catch {
    throw new UnsafeTargetError("That is not a valid web address.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new UnsafeTargetError("Only http(s) can be fetched.");
  if (url.username || url.password) throw new UnsafeTargetError("Credentials in a URL are not followed.");
  if (url.port && !((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80"))) {
    throw new UnsafeTargetError("Non-standard ports are not followed.");
  }
  const problem = hostProblem(url.hostname);
  if (problem) throw new UnsafeTargetError(problem);
  return url;
}

