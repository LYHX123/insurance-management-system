// GET /api/integrations/dropbox/connect — starts the Dropbox OAuth 2
// Authorization Code flow (offline access). Admin-only; a real browser
// navigation (not a server action), since it must end in a redirect to
// Dropbox's own authorization page.
import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { getDropboxEnv, DROPBOX_OAUTH_STATE_COOKIE, DROPBOX_OAUTH_STATE_MAX_AGE_SECONDS } from "@/lib/integrations/dropbox/constants";
import { buildAuthorizationUrl } from "@/lib/integrations/dropbox/auth";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user || !isAdmin(session.user)) {
    return NextResponse.redirect(new URL("/access-denied", req.nextUrl));
  }

  const envResult = getDropboxEnv();
  if (!envResult.ok) {
    return NextResponse.redirect(new URL("/settings?tab=dropbox&dropbox=error&code=CONFIGURATION_MISSING", req.nextUrl));
  }

  // State is bound to the initiating admin's user id (not just held in an
  // opaque cookie) so the callback can positively confirm the same admin
  // who started the flow is the one completing it (Part 5, requirement 9).
  const state = randomBytes(32).toString("base64url");
  const cookieValue = `${state}.${session.user.id}`;

  let authorizationUrl: string;
  try {
    authorizationUrl = await buildAuthorizationUrl(envResult.config, state);
  } catch {
    return NextResponse.redirect(new URL("/settings?tab=dropbox&dropbox=error&code=UNKNOWN_ERROR", req.nextUrl));
  }

  const response = NextResponse.redirect(authorizationUrl);
  response.cookies.set(DROPBOX_OAUTH_STATE_COOKIE, cookieValue, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: DROPBOX_OAUTH_STATE_MAX_AGE_SECONDS,
    path: "/api/integrations/dropbox",
  });
  return response;
}
