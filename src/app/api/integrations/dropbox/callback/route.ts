// GET /api/integrations/dropbox/callback — completes the Dropbox OAuth
// exchange. Never trusts the `code` param alone: requires a still-valid
// admin session AND a matching, timing-safe-compared state value bound to
// that same admin (set by the /connect route above).
import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { DROPBOX_OAUTH_STATE_COOKIE } from "@/lib/integrations/dropbox/constants";
import { completeOAuthConnection, recordDropboxError } from "@/lib/integrations/dropbox/service";
import { DropboxIntegrationError, mapDropboxError } from "@/lib/integrations/dropbox/errors";

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function redirectWithError(req: NextRequest, code: string) {
  const url = new URL("/settings", req.nextUrl);
  url.searchParams.set("tab", "dropbox");
  url.searchParams.set("dropbox", "error");
  url.searchParams.set("code", code);
  const response = NextResponse.redirect(url);
  response.cookies.delete({ name: DROPBOX_OAUTH_STATE_COOKIE, path: "/api/integrations/dropbox" });
  return response;
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user || !isAdmin(session.user)) {
    return NextResponse.redirect(new URL("/access-denied", req.nextUrl));
  }

  const dropboxError = req.nextUrl.searchParams.get("error");
  if (dropboxError) {
    await recordDropboxError("OAUTH_DENIED", "Dropbox authorization was denied.").catch(() => {});
    return redirectWithError(req, "OAUTH_DENIED");
  }

  const stateCookie = req.cookies.get(DROPBOX_OAUTH_STATE_COOKIE)?.value;
  const returnedState = req.nextUrl.searchParams.get("state");
  const code = req.nextUrl.searchParams.get("code");

  if (!stateCookie || !returnedState || !code) {
    return redirectWithError(req, "OAUTH_STATE_INVALID");
  }

  const separatorIndex = stateCookie.lastIndexOf(".");
  if (separatorIndex === -1) {
    return redirectWithError(req, "OAUTH_STATE_INVALID");
  }
  const expectedState = stateCookie.slice(0, separatorIndex);
  const boundUserId = stateCookie.slice(separatorIndex + 1);

  if (!safeEqual(expectedState, returnedState) || boundUserId !== session.user.id) {
    return redirectWithError(req, "OAUTH_STATE_INVALID");
  }

  try {
    await completeOAuthConnection({ code, adminUserId: session.user.id });
  } catch (err) {
    const mapped = err instanceof DropboxIntegrationError ? err : mapDropboxError(err);
    await recordDropboxError(mapped.code, mapped.message).catch(() => {});
    return redirectWithError(req, mapped.code);
  }

  const url = new URL("/settings", req.nextUrl);
  url.searchParams.set("tab", "dropbox");
  url.searchParams.set("dropbox", "connected");
  const response = NextResponse.redirect(url);
  response.cookies.delete({ name: DROPBOX_OAUTH_STATE_COOKIE, path: "/api/integrations/dropbox" });
  return response;
}
