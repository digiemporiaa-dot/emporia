import type { NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";

/**
 * Auth.js configuration.
 *
 * The JWT carries identity only — userId, type, roleId, clientId — and never a
 * permission set (docs/ARCHITECTURE.md 9.2).
 *
 * The credentials `authorize` callback is injected rather than imported here so
 * this module stays free of Node-only dependencies (argon2, Prisma). That keeps
 * the config importable from the middleware/edge context if it is ever needed.
 */

export const credentialsSchema = z.object({
  email: z.string().email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
});

export type AuthorizedUser = {
  id: string;
  email: string;
  name: string;
  type: "STAFF" | "CLIENT";
  roleId: string;
  roleName: string;
  clientId: string | null;
};

export type Authorize = (
  credentials: { email: string; password: string },
  request: Request,
) => Promise<AuthorizedUser | null>;

export function buildAuthConfig(authorize: Authorize): NextAuthConfig {
  return {
    session: { strategy: "jwt", maxAge: 60 * 60 * 8 },
    pages: {
      signIn: "/auth/login",
      error: "/auth/login",
    },
    trustHost: true,
    cookies: {
      sessionToken: {
        name:
          process.env.NODE_ENV === "production"
            ? "__Secure-emporia.session"
            : "emporia.session",
        options: {
          httpOnly: true,
          sameSite: "lax",
          path: "/",
          secure: process.env.NODE_ENV === "production",
        },
      },
    },
    providers: [
      Credentials({
        credentials: {
          email: { label: "Email", type: "email" },
          password: { label: "Password", type: "password" },
        },
        authorize: async (raw, request) => {
          const parsed = credentialsSchema.safeParse(raw);
          if (!parsed.success) return null;
          return authorize(parsed.data, request);
        },
      }),
    ],
    callbacks: {
      jwt({ token, user }) {
        if (user) {
          const u = user as unknown as AuthorizedUser;
          token.userId = u.id;
          token.userType = u.type;
          token.roleId = u.roleId;
          token.roleName = u.roleName;
          token.clientId = u.clientId;
        }
        return token;
      },
      session({ session, token }) {
        session.user = {
          ...session.user,
          id: String(token.userId ?? ""),
          type: (token.userType as "STAFF" | "CLIENT") ?? "STAFF",
          roleId: String(token.roleId ?? ""),
          roleName: String(token.roleName ?? ""),
          clientId: (token.clientId as string | null) ?? null,
        };
        return session;
      },
    },
  };
}
