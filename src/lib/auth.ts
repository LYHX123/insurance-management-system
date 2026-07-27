import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

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
      authorize: async (credentials) => {
        const rawLogin = credentials?.username as string | undefined;
        const password = credentials?.password as string | undefined;
        if (!rawLogin || !password) return null;

        const login = rawLogin.trim();
        if (!login) return null;

        // Full Name is the primary login identifier — case-insensitive,
        // trimmed (see src/lib/users/fullName.ts's matching normalization
        // used at create/edit time).
        let user = await prisma.user.findFirst({
          where: { fullName: { equals: login, mode: "insensitive" } },
        });

        // Legacy compatibility: accounts migrated from the old
        // username+password login (e.g. "admin") keep working if someone
        // types the old username instead of the Full Name. Never required
        // going forward — new accounts are found via Full Name above.
        if (!user) {
          user = await prisma.user.findFirst({
            where: { username: { equals: login, mode: "insensitive" } },
          });
        }

        if (!user || user.status !== "ACTIVE") return null;

        const passwordValid = await bcrypt.compare(password, user.passwordHash);
        if (!passwordValid) return null;

        await prisma.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        });

        return {
          id: user.id,
          username: user.username,
          name: user.fullName,
          role: user.role,
          status: user.status,
          preferredLanguage: user.preferredLanguage,
          permissions: user.permissions,
        };
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
