import { notFound, redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@law-portal/db";
import { requireSession } from "@/lib/session";
import { isPlatformAdmin } from "@/lib/platformAdmin";

// Tenant onboarding — creating a new firm on the platform, not managing an
// existing one. Deliberately outside RLS: tenants/tenant_sso_domains have
// no tenant_id and no RLS policy (see their own schema comments), so this
// uses `db` directly rather than withTenant(), same as
// apps/portal/src/lib/auth.ts's findTenantForEmail. Gated by
// isPlatformAdmin, not the tenant-scoped "admin" role — see that
// function's comment for why those are different things.
//
// No self-serve signup here on purpose (docs/PLAN.md "SSO": never
// auto-create a tenant from an unrecognized login) — this is the
// operator registering a firm ahead of that firm's first sign-in.

async function createTenant(formData: FormData) {
  "use server";

  const session = await requireSession();
  if (!isPlatformAdmin(session.email)) {
    notFound();
  }

  const name = String(formData.get("name") ?? "").trim();
  const slug = String(formData.get("slug") ?? "").trim().toLowerCase();
  const emailDomain = String(formData.get("emailDomain") ?? "").trim().toLowerCase();
  const entraTenantId = String(formData.get("entraTenantId") ?? "").trim() || null;

  if (!name || !slug || !emailDomain) {
    redirect("/admin/tenants?error=" + encodeURIComponent("name, slug, and email domain are all required"));
  }

  try {
    await db.transaction(async (tx) => {
      const [tenant] = await tx.insert(schema.tenants).values({ name, slug }).returning({ id: schema.tenants.id });
      await tx.insert(schema.tenantSsoDomains).values({
        tenantId: tenant.id,
        emailDomain,
        entraTenantId,
      });
    });
  } catch (err) {
    // 23505 = unique_violation (duplicate slug or email domain) — the only
    // failure mode worth a friendly message; anything else can surface raw.
    const message =
      (err as { code?: string }).code === "23505"
        ? "that slug or email domain is already registered"
        : (err as Error).message;
    redirect("/admin/tenants?error=" + encodeURIComponent(message));
  }

  redirect("/admin/tenants?created=" + encodeURIComponent(slug));
}

export default async function TenantsAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ created?: string; error?: string }>;
}) {
  const session = await requireSession();
  if (!isPlatformAdmin(session.email)) {
    notFound();
  }

  const { created, error } = await searchParams;

  const tenants = await db
    .select({
      id: schema.tenants.id,
      name: schema.tenants.name,
      slug: schema.tenants.slug,
      createdAt: schema.tenants.createdAt,
      emailDomain: schema.tenantSsoDomains.emailDomain,
      entraTenantId: schema.tenantSsoDomains.entraTenantId,
    })
    .from(schema.tenants)
    .leftJoin(schema.tenantSsoDomains, eq(schema.tenantSsoDomains.tenantId, schema.tenants.id))
    .orderBy(desc(schema.tenants.createdAt));

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold">Tenants</h1>
      <p className="mb-6 text-sm text-zinc-500">
        Registers a firm ahead of its first sign-in — an unrecognized email domain is always rejected at
        sign-in, never auto-provisioned (docs/PLAN.md "SSO").
      </p>

      {created && (
        <p className="mb-4 rounded bg-green-50 px-3 py-2 text-sm text-green-800 dark:bg-green-950 dark:text-green-200">
          Created tenant &ldquo;{created}&rdquo;.
        </p>
      )}
      {error && (
        <p className="mb-4 rounded bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
          {error}
        </p>
      )}

      <form action={createTenant} className="mb-8 flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col gap-1">
          Firm name
          <input name="name" required className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900" />
        </label>
        <label className="flex flex-col gap-1">
          Slug
          <input name="slug" required pattern="[a-z0-9-]+" placeholder="smith-law" className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900" />
        </label>
        <label className="flex flex-col gap-1">
          Email domain
          <input name="emailDomain" required placeholder="smithlawllp.ca" className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900" />
        </label>
        <label className="flex flex-col gap-1">
          Entra tenant ID (optional)
          <input name="entraTenantId" placeholder="guards against a look-alike domain" className="w-64 rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900" />
        </label>
        <button type="submit" className="rounded bg-zinc-900 px-3 py-1.5 text-white dark:bg-zinc-100 dark:text-zinc-900">
          Add tenant
        </button>
      </form>

      <table className="w-full text-sm">
        <thead className="text-left text-zinc-500">
          <tr>
            <th className="py-2">Name</th>
            <th className="py-2">Slug</th>
            <th className="py-2">Email domain</th>
            <th className="py-2">Entra tenant ID</th>
            <th className="py-2">Created</th>
          </tr>
        </thead>
        <tbody>
          {tenants.map((t) => (
            <tr key={t.id} className="border-t border-zinc-100 dark:border-zinc-900">
              <td className="py-2">{t.name}</td>
              <td className="py-2">{t.slug}</td>
              <td className="py-2">{t.emailDomain ?? "—"}</td>
              <td className="py-2">{t.entraTenantId ?? "—"}</td>
              <td className="py-2">{new Date(t.createdAt).toLocaleDateString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
