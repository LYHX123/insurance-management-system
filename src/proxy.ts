import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  firstAccessibleModule,
  hasModuleAccess,
  moduleKeyFromPathname,
} from "@/lib/permissions";

export default auth((req) => {
  const isLoggedIn = !!req.auth;
  const { pathname } = req.nextUrl;
  const permissions = req.auth?.user?.permissions ?? [];

  const isLoginPage = pathname === "/login";

  if (!isLoggedIn && !isLoginPage) {
    return NextResponse.redirect(new URL("/login", req.nextUrl));
  }

  if (isLoggedIn && isLoginPage) {
    const target = hasModuleAccess(permissions, "dashboard")
      ? "dashboard"
      : firstAccessibleModule(permissions);
    return NextResponse.redirect(
      new URL(target ? `/${target}` : "/access-denied", req.nextUrl)
    );
  }

  if (isLoggedIn) {
    const moduleKey = moduleKeyFromPathname(pathname);
    if (moduleKey && !hasModuleAccess(permissions, moduleKey)) {
      return NextResponse.redirect(new URL("/access-denied", req.nextUrl));
    }
  }
});

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
