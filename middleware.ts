import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

// Route gate. NOTE on the filename: Next.js 16 renamed `middleware.ts` →
// `proxy.ts`, but @opennextjs/cloudflare@1.19.11 (the Workers adapter, latest
// at time of writing) does not yet understand the proxy rename — `proxy.ts`
// builds an empty middleware manifest and OpenNext's bundler then fails looking
// for a standalone `middleware.js`. The still-supported `middleware.ts` name is
// what the Workers toolchain bundles correctly today. Revisit once OpenNext
// ships proxy support. (Resolves research Open Question 2.) Runtime is nodejs.
//
// SECURITY NOTE: getSessionCookie() is an *optimistic* presence check (no DB
// hit — pairs with the cookie cache). It is deliberately NOT the security
// boundary. Gated server components must call requireSession() (src/lib/auth.ts)
// for authoritative DB-backed validation. Relying on a middleware cookie check
// alone is "NOT SECURE" per Better Auth docs (cf. CVE-2025-29927).

// Unauthenticated-reachable path prefixes. Public auth pages (S-01) + the Better
// Auth API itself must stay open so sign-in/sign-up/reset can work.
const PUBLIC_PREFIXES = ["/login", "/signup", "/reset", "/api/auth"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublic(pathname)) {
    return NextResponse.next();
  }

  const sessionCookie = getSessionCookie(request);
  if (!sessionCookie) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  // Run on everything except Next internals and static assets.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
