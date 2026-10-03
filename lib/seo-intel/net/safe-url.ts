import "server-only";
import { BlockList, isIP } from "node:net";
import { hostProblem, UnsafeTargetError } from "@/lib/seo-intel/net/site-input";

export { assertSafeUrl, hostProblem, parseSiteInput, UnsafeTargetError } from "@/lib/seo-intel/net/site-input";

/**
 * What the SEO crawler and every other outbound SEO fetch is allowed to reach.
 *
 * The threat is SSRF: an admin types a "website" that is really the database,
 * the cloud metadata endpoint or a box on the private network, and the server
 * fetches it for them. So a target must be a public host name over http(s) on
 * the default port, and — checked separately, at fetch time, on every redirect
 * hop — every address that name resolves to must be public.
 *
 * Two layers, because they fail differently:
 *
 * - `parseSiteInput` / `assertSafeUrl` are pure and reject what is unsafe by
 *   its spelling: IP literals, `localhost`, single-label names, reserved
 *   suffixes, credentials, odd ports, other schemes.
 * - `resolvePublicHost` resolves the name and rejects it if *any* address is
 *   private, loopback, link-local, multicast, reserved or a mapping of one —
 *   a public-looking name pointing inside is the classic bypass.
 *
 * DNS rebinding (an answer that changes between check and connect) is closed
 * by the crawler connecting to the address this returned, not by re-resolving.
 */

const BLOCKED = new BlockList();
// IPv4 — RFC 6890 special-purpose and everything not globally reachable.
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  BLOCKED.addSubnet(net, prefix, "ipv4");
}
// IPv6.
for (const [net, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["::", 96], // IPv4-compatible (deprecated)
  ["100::", 64], // discard
  ["2001::", 23], // IETF protocol assignments, incl. Teredo/ORCHID
  ["2001:db8::", 32], // documentation
  ["2002::", 16], // 6to4 — embeds an IPv4 address
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["fec0::", 10], // site-local (deprecated)
  ["ff00::", 8], // multicast
] as const) {
  BLOCKED.addSubnet(net, prefix, "ipv6");
}

/** IPv4 carried inside an IPv6 address (mapped `::ffff:a.b.c.d`, NAT64 `64:ff9b::`). */
function embeddedIPv4(address: string): string | null {
  const lower = address.toLowerCase();
  const dotted = /^(?:::ffff:|64:ff9b::)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(lower);
  if (dotted) return dotted[1] as string;
  const hex = /^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
  if (hex) {
    const high = parseInt(hex[1] as string, 16);
    const low = parseInt(hex[2] as string, 16);
    return [high >> 8, high & 255, low >> 8, low & 255].join(".");
  }
  return null;
}

/** True only for an address that is globally reachable. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !BLOCKED.check(address, "ipv4");
  if (family === 6) {
    const v4 = embeddedIPv4(address);
    if (v4) return isPublicAddress(v4);
    if (/^(?:::ffff:|64:ff9b::)/i.test(address)) return false; // a mapping we could not read
    return !BLOCKED.check(address, "ipv6");
  }
  return false;
}

export type Lookup = (host: string) => Promise<{ address: string; family: number }[]>;

/**
 * Resolve a host and insist every answer is public. Returns the addresses so
 * the caller can connect to one of them rather than resolving again.
 */
export async function resolvePublicHost(host: string, lookup: Lookup): Promise<string[]> {
  const problem = hostProblem(host);
  if (problem) throw new UnsafeTargetError(problem);

  let answers: { address: string; family: number }[];
  try {
    answers = await lookup(host);
  } catch {
    throw new UnsafeTargetError(`${host} could not be found.`);
  }
  if (answers.length === 0) throw new UnsafeTargetError(`${host} could not be found.`);

  const blocked = answers.filter((answer) => !isPublicAddress(answer.address));
  if (blocked.length > 0) {
    throw new UnsafeTargetError(`${host} points to a private or reserved network address, so it cannot be fetched.`);
  }
  return answers.map((answer) => answer.address);
}
