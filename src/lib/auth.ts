import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "@/lib/prisma";
import { verifyCredentials } from "@/lib/auth/credentials";
import { isRateLimited, recordFailure, clearFailures, loginRateLimitKeys } from "@/lib/auth/loginRateLimit";
import { getClientIp } from "@/lib/http/clientIp";

// Production Readiness Audit V1, finding H3: surfaced to the client as
// `result.code` (see login-form.tsx) — deliberately generic, never hints
// which specific check tripped it beyond "you are being rate limited".
class TooManyLoginAttemptsError extends CredentialsSignin {
  code = "RATE_LIMITED";
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  // Required when running behind a reverse proxy (Nginx) that terminates
  // TLS and forwards plain HTTP to the container on a different port.
  trustHost: true,
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  providers: [
    Credentials({
      // The credential key stays "username" to avoid churn in the NextAuth
      // wiring, but the value it now carries is the Full Name — see
      // LoginForm, which relabels the field and posts the Full Name here.
      credentials: {
        username: {},
        password: {},
      },
      authorize: async (credentials, request) => {
        const rawLogin = credentials?.username as string | undefined;
        const password = credentials?.password as string | undefined;
        if (!rawLogin || !password) return null;

        const login = rawLogin.trim();
        if (!login) return null;

        // Production Readiness Audit V1, finding H3: two independent
        // failure counters — one per login identifier (blocks repeated
        // guessing against a single account regardless of source), one per
        // client IP (blocks one source from sweeping many accounts) — see
        // loginRateLimit.ts for the threshold/window and its documented
        // single-instance/in-memory scope. Checked BEFORE any DB lookup or
        // password comparison, so a blocked caller never gets a timing
        // signal either.
        const clientIp = getClientIp(request);
        const { accountKey, ipKey } = loginRateLimitKeys(login, clientIp);
        if (isRateLimited(accountKey) || isRateLimited(ipKey)) {
          throw new TooManyLoginAttemptsError();
        }

        const user = await verifyCredentials(login, password);
        if (!user) {
          recordFailure(accountKey);
          recordFailure(ipKey);
          return null;
        }

        clearFailures(accountKey);
        clearFailures(ipKey);
        return user;
      },
    }),
  ],
  callbacks: {
    jwt: async ({ token, user }) => {
      if (user) {
        token.role = user.role;
        token.username = user.username;
        token.status = user.status;
        token.preferredLanguage = user.preferredLanguage;
        token.permissions = user.permissions;
      } else if (token.sub) {
        // Re-read from the database on every request so permission changes
        // (or a status/role change) made by an admin take effect without
        // requiring the user to log out.
        const dbUser = await prisma.user.findUnique({ where: { id: token.sub } });
        if (dbUser) {
          token.role = dbUser.role;
          token.username = dbUser.username;
          token.status = dbUser.status;
          token.preferredLanguage = dbUser.preferredLanguage;
          token.permissions = dbUser.permissions;
          token.name = dbUser.fullName;
        }
      }
      return token;
    },
    session: ({ session, token }) => {
      if (session.user) {
        session.user.id = token.sub as string;
        session.user.role = token.role as string;
        session.user.username = token.username as string;
        session.user.status = token.status as string;
        session.user.preferredLanguage = token.preferredLanguage as string;
        session.user.permissions = (token.permissions as string[] | undefined) ?? [];
      }
      return session;
    },
  },
});
