/**
 * The origin a visitor used, for building absolute redirects in middleware.
 *
 * `request.nextUrl.origin` is the server's bind address in the standalone
 * build (0.0.0.0 in the image), not the public domain, so a redirect built
 * from it sent signed-out visitors nowhere. The proxy in front passes the real
 * host and scheme; they are checked for shape and only ever send the visitor
 * back to the host they asked for. Pure; no environment needed.
 */

type HeaderSource = { headers: { get(name: string): string | null }; nextUrl: { origin: string; protocol: string } };

const HOST = /^[a-z0-9.-]+(:\d{1,5})?$/i;

export function publicOrigin(request: HeaderSource): string {
  const first = (value: string | null) => (value ?? "").split(",")[0]?.trim() ?? "";
  const host = first(request.headers.get("x-forwarded-host")) || first(request.headers.get("host"));
  if (!HOST.test(host)) return request.nextUrl.origin;
  const proto = first(request.headers.get("x-forwarded-proto")).toLowerCase();
  const scheme = proto === "https" || proto === "http" ? proto : request.nextUrl.protocol.replace(":", "");
  return `${scheme}://${host}`;
}
