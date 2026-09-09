import NextAuth from "next-auth";
import { NextResponse, type NextRequest } from "next/server";
import { buildAuthConfig } from "@/lib/auth/config";
import {
  COOKIE,
  COOKIE_MAX_AGE,
  decodeTouch,
  encodeTouch,
  readUtm,
  type TouchData,
} from "@/lib/attribution/cookies";

/**
 * Edge auth gate for /admin and /portal.
 *
 * This exists for the HTTP status code, not for authorization. Without it the
 * response shell (app/loading.tsx) streams first, so by the time a layout calls
 * `redirect()` the 200 is already on the wire and Next has to deliver the
 * redirect in-band — the browser still follows it, but the request looks like a
 * successful 200 to anything that is not a browser. Checking here produces a
 * real 307 before any rendering starts.
 *
 * It only verifies that a session token exists. No database, no permissions —
 * Prisma cannot run on the edge runtime, and the authorization that matters is
 * still done server-side in each layout, page, action and route handler
 * (CLAUDE.md 2 rule 2). A forged or expired token fails signature verification
 * here and, even if it did not, would be rejected downstream.
 *
 * `authorize` is stubbed because middleware never signs anyone in; it only
 * reads the JWT.
 */
const { auth } = NextAuth(buildAuthConfig(async () => null));

// `/preview-frame` renders a draft page for the editor's device preview. It
// sits outside /admin so it does not inherit the admin shell, which means it
// has to be named here too.
const PROTECTED = ["/admin", "/portal", "/preview-frame"];

function isProtected(pathname: string): boolean {
  return PROTECTED.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/**
 * Attribution capture.
 *
 * Runs on the edge, so it does no database work: it only maintains httpOnly
 * cookies. A Node route handler persists them as UTMTracking rows when a lead
 * is actually captured, which avoids writing a row for every bot that loads a
 * page (docs/ARCHITECTURE.md 14.2).
 *
 * First touch is written once and never overwritten. Last touch is replaced
 * whenever a request arrives carrying campaign parameters.
 */
function applyAttribution(request: NextRequest, response: NextResponse): void {
  const { pathname, searchParams } = request.nextUrl;

  const secure = request.nextUrl.protocol === "https:";
  const base = { httpOnly: true, sameSite: "lax", path: "/", secure } as const;

  if (!request.cookies.get(COOKIE.visitorId)) {
    response.cookies.set(COOKIE.visitorId, crypto.randomUUID(), {
      ...base,
      maxAge: COOKIE_MAX_AGE.visitorId,
    });
  }

  // Session marker, used for new-vs-returning targeting and once-per-session
  // frequency. No maxAge, so it expires with the browser session.
  if (!request.cookies.get(COOKIE.session)) {
    response.cookies.set(COOKIE.session, crypto.randomUUID(), base);
  }

  const utm = readUtm(searchParams);
  if (!utm) return;

  const touch: TouchData = {
    ...utm,
    landingPath: pathname,
    referrer: request.headers.get("referer") ?? undefined,
    at: Date.now(),
  };

  if (!decodeTouch(request.cookies.get(COOKIE.firstTouch)?.value)) {
    response.cookies.set(COOKIE.firstTouch, encodeTouch(touch), {
      ...base,
      maxAge: COOKIE_MAX_AGE.firstTouch,
    });
  }

  response.cookies.set(COOKIE.lastTouch, encodeTouch(touch), {
    ...base,
    maxAge: COOKIE_MAX_AGE.lastTouch,
  });
}

export default auth((request) => {
  const { pathname } = request.nextUrl;

  if (isProtected(pathname)) {
    if (!request.auth?.user?.id) {
      const url = new URL("/auth/login", request.nextUrl.origin);
      url.searchParams.set("redirectTo", pathname);
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  const response = NextResponse.next();
  applyAttribution(request, response);
  return response;
});

export const config = {
  // Everything except static assets and the auth endpoints, so attribution is
  // captured on any entry point to the site.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/auth|.*\\.\\w+$).*)"],
};
