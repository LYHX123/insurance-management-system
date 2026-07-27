import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  firstAccessibleMenu,
  hasMenuAccess,
  hasPermission,
  isAdmin,
  moduleKeyFromPathname,
  subPermissionForPathname,
} from "@/lib/permissions";

export default auth((req) => {
  const user = req.auth?.user;
  const isLoggedIn = !!user;
  const { pathname } = req.nextUrl;

  const isLoginPage = pathname === "/login";

  if (!isLoggedIn && !isLoginPage) {
    return NextResponse.redirect(new URL("/login", req.nextUrl));
  }

  // Where to send a logged-in user who just hit a route they cannot access:
  // Dashboard if they have it, otherwise their first accessible module,
  // otherwise the terminal Unauthorized page. Never loops: /access-denied
  // itself is not a recognized module key, so it is never re-redirected.
  const fallbackPath = () => {
    if (hasPermission(user, "dashboard") || isAdmin(user)) return "/dashboard";
    const first = firstAccessibleMenu(user);
    return first ? `/${first}` : "/access-denied";
  };

  if (isLoggedIn && isLoginPage) {
    return NextResponse.redirect(new URL(fallbackPath(), req.nextUrl));
  }

  if (isLoggedIn) {
    const moduleKey = moduleKeyFromPathname(pathname);

    // hasMenuAccess already treats "users" and "settings" as admin-only
    // (see src/lib/permissions.ts), so this single check covers both.
    if (moduleKey && !hasMenuAccess(user, moduleKey)) {
      return NextResponse.redirect(new URL(fallbackPath(), req.nextUrl));
    } else if (moduleKey) {
      // Direct-URL guard for Policy/Ledger/Task & Claim sub-categories (e.g.
      // /policy/bond) — a user may have the parent module but only some of
      // its detailed permissions. Page/action-level checks remain the
      // authoritative backend gate; this just avoids a round-trip render.
      const subKey = subPermissionForPathname(pathname);
      if (subKey && !hasPermission(user, subKey)) {
        return NextResponse.redirect(new URL(fallbackPath(), req.nextUrl));
      }
    }
  }
});

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
