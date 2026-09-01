import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: DefaultSession["user"] & {
      id: string;
      type: "STAFF" | "CLIENT";
      roleId: string;
      roleName: string;
      clientId: string | null;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId?: string;
    userType?: "STAFF" | "CLIENT";
    roleId?: string;
    roleName?: string;
    clientId?: string | null;
  }
}

export {};
