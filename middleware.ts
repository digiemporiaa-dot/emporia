import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { buildAuthConfig } from "@/lib/auth/config";

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

export default auth((request) => {
  const { pathname } = request.nextUrl;
  const signedIn = Boolean(request.auth?.user?.id);

  if (!signedIn) {
    const url = new URL("/auth/login", request.nextUrl.origin);
    url.searchParams.set("redirectTo", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/admin/:path*", "/portal/:path*"],
};
