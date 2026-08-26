import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import * as schema from "./schema";

/**
 * The app connects as a non-superuser role with RLS enforced (see
 * drizzle/0001_rls_policies.sql). Every policy checks
 * current_setting('app.tenant_id') against each row's tenant_id, so a
 * request with no tenant context set sees zero rows in every tenant-scoped
 * table rather than everything — fail closed, not open.
 *
 * `withTenant` is the ONLY sanctioned way application code should touch
 * tenant-scoped tables. It opens a transaction, sets the session-local
 * GUC, runs the callback, and lets the transaction end (committing or
 * rolling back) before the setting can leak to a pooled connection.
 */

const connectionString =
  process.env.DATABASE_URL ??
  "postgres://law_portal:dev_only_password@localhost:5432/law_portal";

const queryClient = postgres(connectionString, { max: 10 });

export const db = drizzle(queryClient, { schema });

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
