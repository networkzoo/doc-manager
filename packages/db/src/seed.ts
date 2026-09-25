import { rawSql } from "./client";

/**
 * Local dev seed only — NOT for staging/production. Inserts one tenant,
 * one admin user, and one matter with IDs matching
 * apps/portal/src/lib/session.ts's DEV_FIXED_SESSION, so the /matters
 * page has something to show against a freshly migrated database. Run
 * via `pnpm --filter @law-portal/db seed` after `pnpm db:migrate`.
 *
 * Uses rawSql (bypasses RLS, as any seed/migration script should) rather
 * than withTenant, since these rows don't exist yet for a policy to scope
 * against.
 */

const TENANT_ID = "00000000-0000-0000-0000-000000000000";
const USER_ID = "00000000-0000-0000-0000-000000000001";

async function main() {
  await rawSql.begin(async (tx) => {
    await tx`
      insert into tenants (id, name, slug)
      values (${TENANT_ID}, 'Dev Firm LLP', 'dev-firm')
      on conflict (id) do nothing
    `;

    await tx`
      insert into users (id, tenant_id, email, display_name, role, mfa_enabled)
      values (${USER_ID}, ${TENANT_ID}, 'dev@example.invalid', 'Dev Admin', 'admin', false)
      on conflict (id) do nothing
    `;

    // Registers this pattern's own dev domain — see
    // schema/sso.ts. Won't enable real sign-in (nobody holds an
    // example.invalid mailbox); swap in a real domain here to test
    // Auth.js against an actual Entra ID / Google account.
    await tx`
      insert into tenant_sso_domains (tenant_id, email_domain)
      values (${TENANT_ID}, 'example.invalid')
      on conflict (email_domain) do nothing
    `;

    const [client] = await tx`
      insert into clients (tenant_id, type, display_name, conflict_names)
      values (${TENANT_ID}, 'individual', 'Jane Sample', ARRAY['Jane Sample']::text[])
      returning id
    `;

    await tx`
      insert into matters (
        tenant_id, client_id, matter_number, practice_area,
        responsible_lawyer_id, status, smb_path, limitation_date
      )
      values (
        ${TENANT_ID}, ${client.id}, 'DEV-2026-001', 'Real Estate',
        ${USER_ID}, 'open', 'Sample Client\\2026-001 Purchase', null
      )
    `;
  });

  console.log("Seed complete: tenant=Dev Firm LLP, user=dev@example.invalid, 1 matter.");
  await rawSql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
