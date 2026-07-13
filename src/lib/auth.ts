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
      credentials: {
        username: {},
        password: {},
      },
      authorize: async (credentials) => {
        const username = credentials?.username as string | undefined;
        const password = credentials?.password as string | undefined;
        if (!username || !password) return null;

        const user = await prisma.user.findUnique({ where: { username } });
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
        token.preferredLanguage = user.preferredLanguage;
        token.permissions = user.permissions;
      } else if (token.sub) {
        // Re-read from the database on every request so permission changes
        // made by an admin take effect without requiring the user to log out.
        const dbUser = await prisma.user.findUnique({ where: { id: token.sub } });
        if (dbUser) {
          token.role = dbUser.role;
          token.username = dbUser.username;
          token.preferredLanguage = dbUser.preferredLanguage;
          token.permissions = dbUser.permissions;
        }
      }
      return token;
    },
    session: ({ session, token }) => {
      if (session.user) {
        session.user.id = token.sub as string;
        session.user.role = token.role as string;
        session.user.username = token.username as string;
        session.user.preferredLanguage = token.preferredLanguage as string;
        session.user.permissions = (token.permissions as string[] | undefined) ?? [];
      }
      return session;
    },
  },
});
