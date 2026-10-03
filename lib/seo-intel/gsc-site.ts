/**
 * Does a Search Console property cover this website's domain?
 *
 * Pure. Used to stop one client's Search Console data being attached to
 * another client's property: the site must be the property's own.
 *
 * - A **domain property** (`sc-domain:example.com`) covers the domain and
 *   every subdomain of it.
 * - A **URL-prefix property** (`https://www.example.com/`) covers its host
 *   only; `www.` and the bare domain are treated as the same site, since that
 *   is how almost every site is set up and the property's host decides which
 *   one Google reports for.
 */
export function siteMatchesDomain(siteUrl: string, domain: string): boolean {
  const target = domain.toLowerCase().replace(/\.$/, "");
  const bare = (host: string) => host.replace(/^www\./, "");

  if (siteUrl.startsWith("sc-domain:")) {
    const covered = siteUrl.slice("sc-domain:".length).toLowerCase().replace(/\.$/, "");
    return Boolean(covered) && (target === covered || target.endsWith(`.${covered}`));
  }

  let host: string;
  try {
    const url = new URL(siteUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    host = url.hostname.toLowerCase();
  } catch {
    return false;
  }
  return host === target || bare(host) === bare(target);
}
