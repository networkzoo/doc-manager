import { auth } from "@/lib/auth";

/**
 * The one place server code asks "who is asking and for which tenant" —
 * see docs/PLAN.md "SSO (build, not buy — Auth.js)". Wraps Auth.js's
 * auth() (src/lib/auth.ts) so call sites never touch next-auth directly.
 *
 * Falls back to a fixed dev session ONLY when no real IdP credentials are
 * configured at all (no Entra/Google client ID env vars) — i.e. a bare
 * `pnpm dev` checkout with no Azure/Google app registration yet. The
 * moment real credentials are present, real SSO takes over even in
 * development; the stub never runs in production regardless.
 */

export type Session = {
  tenantId: string;
  userId: string;
  email: string;
  role: "admin" | "lawyer" | "law_clerk" | "staff" | "billing";
};

const DEV_FIXED_SESSION: Session = {
  tenantId: "00000000-0000-0000-0000-000000000000",
  userId: "00000000-0000-0000-0000-000000000001",
  email: "dev@example.invalid",
  role: "admin",
};

function hasRealIdpCredentials(): boolean {
  return Boolean(
    process.env.AUTH_MICROSOFT_ENTRA_ID_ID || process.env.AUTH_GOOGLE_ID,
  );
}

export async function getSession(): Promise<Session | null> {
  if (process.env.NODE_ENV !== "production" && !hasRealIdpCredentials()) {
    return DEV_FIXED_SESSION;
  }

  const session = await auth();
  if (!session?.user?.tenantId || !session.user.userId || !session.user.email) {
    return null;
  }

  return {
    tenantId: session.user.tenantId,
    userId: session.user.userId,
    email: session.user.email,
    role: session.user.role,
  };
}

export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) {
    throw new Error("Unauthenticated");
  }
  return session;
}
