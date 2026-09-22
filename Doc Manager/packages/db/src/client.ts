import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import * as schema from "./schema";

/**
 * TWO connections, deliberately different roles — this split is what
 * drizzle/0001_rls_policies.sql's law_portal_app role exists for, and it
 * was NOT actually being used until 2026-08-29: both `db` and `rawSql`
 * previously shared one superuser connection (DATABASE_URL), which
 * bypasses RLS entirely regardless of any policy — a superuser is exempt
 * from RLS full stop, FORCE ROW LEVEL SECURITY or not. That silently
 * defeated every tenant_isolation policy in the schema (discovered when a
 * second real tenant could see the first tenant's matter). See
 * infra/deploy/README.md "Least-privilege app database role" for the
 * rotation this required.
 *
 * `db` — connects as law_portal_app (APP_DATABASE_URL): NOT a superuser,
 * NOT the table owner, so RLS is actually enforced. This is what
 * `withTenant` uses, and what essentially all application code should use.
 *
 * `dbOwner` — connects as the owner/superuser role (DATABASE_URL, same
 * connection `rawSql` uses): bypasses RLS entirely. Reserved for the
 * handful of genuinely cross-tenant paths that need it — creating a new
 * tenant (apps/portal/src/app/(app)/admin/tenants/page.tsx) chief among
 * them, since `tenants` has RLS enabled with no policy at all (by design
 * — it has no tenant_id column to scope by) and so is otherwise
 * unreachable to a non-owner role.
 */

const appConnectionString =
  process.env.APP_DATABASE_URL ??
  "postgres://law_portal_app:change_me_in_deploy_secrets@localhost:5432/law_portal";

const ownerConnectionString =
  process.env.DATABASE_URL ??
  "postgres://law_portal:dev_only_password@localhost:5432/law_portal";

const appQueryClient = postgres(appConnectionString, { max: 10 });
const queryClient = postgres(ownerConnectionString, { max: 10 });

export const db = drizzle(appQueryClient, { schema });
export const dbOwner = drizzle(queryClient, { schema });

export async function withTenant<T>(
  tenantId: string,
  // Optional because not every call site has an authenticated user (e.g.
  // a connector-triggered background job) — but any code path touching
  // `documents` relies on this being set, since the ethical-wall check in
  // 0001_rls_policies.sql keys off app.user_id. Omitting it there means
  // "no user context", which the policy treats as satisfying no deny row
  // for a NULL user — i.e. it does NOT grant broader access, but it also
  // can't evaluate a per-user wall. Pass a real userId whenever a request
  // is on behalf of one.
  userId: string | null,
  fn: (tx: typeof db) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    // set_config(..., true) scopes the setting to the current transaction
    // only (the `true` = is_local argument) — it cannot bleed into the
    // next query on a connection returned to the pool.
    await tx.execute(
      sql`select set_config('app.tenant_id', ${tenantId}, true), set_config('app.user_id', ${userId}, true)`,
    );
    return fn(tx as unknown as typeof db);
  });
}

/**
 * Superuser/owner-role escape hatch for migrations, seeding, and
 * cross-tenant admin tooling ONLY. Never wire this into request-handling
 * code paths — it bypasses RLS entirely.
 */
export { queryClient as rawSql };
