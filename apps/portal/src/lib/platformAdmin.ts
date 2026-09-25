// Platform-operator access (creating new tenants) is deliberately NOT the
// same thing as a tenant's own "admin" role (schema/users.ts) — a firm's
// admin manages their own firm, not the platform's list of firms. There's
// no schema concept for this yet, so it's a plain env var allowlist for
// now; revisit if this ever needs to cover more than one or two people.
export function isPlatformAdmin(email: string): boolean {
  const allowlist = (process.env.PLATFORM_ADMIN_EMAILS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  return allowlist.includes(email.toLowerCase());
}
