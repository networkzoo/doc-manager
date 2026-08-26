import NextAuth, { type DefaultSession } from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import Google from "next-auth/providers/google";
import { db, withTenant, schema } from "@law-portal/db";
import { eq } from "drizzle-orm";

/**
 * Real SSO wiring, per docs/PLAN.md "SSO (build, not buy — Auth.js)":
 * one multi-tenant Entra ID app (tenantId "organizations" — any work/school
 * Microsoft 365 directory, excluding personal Microsoft accounts, same
 * mechanism as "Sign in with Microsoft" in Slack/Notion) plus Google OIDC.
 *
 * Tenant resolution happens in `signIn`, BEFORE a session is ever issued:
 * the user's email domain must already be registered in
 * tenant_sso_domains (packages/db/src/schema/sso.ts) or the sign-in is
 * rejected outright. We never auto-create a tenant from an unrecognized
 * login — only a user record within an already-known tenant.
 */

declare module "next-auth" {
  interface Session {
    user: {
      tenantId: string;
      userId: string;
      role: "admin" | "lawyer" | "law_clerk" | "staff" | "billing";
    } & DefaultSession["user"];
  }
}

// Augmenting @auth/core/jwt directly (rather than "next-auth/jwt", which
// only re-exports it) is what Auth.js's own v5 module-augmentation docs
// call for — TS can't resolve the re-exporting module as an augmentation
// target here.
declare module "@auth/core/jwt" {
  interface JWT {
    tenantId?: string;
    userId?: string;
    role?: string;
  }
}

async function findTenantForEmail(email: string) {
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return null;

  const [match] = await db
    .select()
    .from(schema.tenantSsoDomains)
    .where(eq(schema.tenantSsoDomains.emailDomain, domain))
    .limit(1);

  return match ?? null;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    MicrosoftEntraID({
      clientId: process.env.AUTH_MICROSOFT_ENTRA_ID_ID,
      clientSecret: process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET,
      // "organizations": any Microsoft 365 work/school directory, excludes
      // personal Microsoft accounts. There's no separate tenantId option on
      // this provider — the tenant scope is encoded directly in `issuer`.
      issuer: "https://login.microsoftonline.com/organizations/v2.0",
    }),
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
    }),
  ],

  callbacks: {
    // Gate: no registered tenant, no session. Runs for every provider.
    async signIn({ user, profile }) {
      const email = user.email ?? (profile as { email?: string } | undefined)?.email;
      if (!email) return false;

      const match = await findTenantForEmail(email);
      if (!match) {
        console.warn(`SSO sign-in rejected: no registered tenant for email domain of ${email}`);
        return false;
      }

      // Optional extra check when a firm has registered its specific
      // Entra directory ID: the `tid` claim must also match, so a
      // look-alike domain under a different directory can't slip in.
      const entraTid = (profile as { tid?: string } | undefined)?.tid;
      if (match.entraTenantId && entraTid && match.entraTenantId !== entraTid) {
        console.warn(`SSO sign-in rejected: Entra tenant ID mismatch for ${email}`);
        return false;
      }

      return true;
    },

    // Provision (or look up) the user row within the already-resolved
    // tenant, and stash tenantId/userId/role on the token.
    async jwt({ token, user, profile }) {
      if (!user?.email) return token;

      const match = await findTenantForEmail(user.email);
      if (!match) return token; // signIn already rejected this case; defensive only

      const dbUser = await withTenant(match.tenantId, null, async (tx) => {
        const [existing] = await tx
          .select()
          .from(schema.users)
          .where(eq(schema.users.email, user.email!))
          .limit(1);
        if (existing) return existing;

        const ssoSubject =
          (profile as { sub?: string; oid?: string } | undefined)?.oid ??
          (profile as { sub?: string } | undefined)?.sub ??
          null;

        const [created] = await tx
          .insert(schema.users)
          .values({
            tenantId: match.tenantId,
            email: user.email!,
            displayName: user.name ?? user.email!,
            role: "staff", // least-privileged default; an admin upgrades explicitly
            ssoSubject,
          })
          .returning();
        return created;
      });

      token.tenantId = dbUser.tenantId;
      token.userId = dbUser.id;
      token.role = dbUser.role;
      return token;
    },

    async session({ session, token }) {
      if (session.user && token.tenantId && token.userId && token.role) {
        session.user.tenantId = token.tenantId;
        session.user.userId = token.userId;
        session.user.role = token.role as "admin" | "lawyer" | "law_clerk" | "staff" | "billing";
      }
      return session;
    },
  },
});
