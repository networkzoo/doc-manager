import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

// Runs with a plain connection (no app.tenant_id, no RLS-restricted role
// assumptions) — migrations own DDL and run as the migration/owner role,
// distinct from the app's runtime role. See drizzle/0001_rls_policies.sql
// for where that split is created.
async function main() {
  const connectionString =
    process.env.DATABASE_URL ??
    "postgres://law_portal:dev_only_password@localhost:5432/law_portal";

  const migrationClient = postgres(connectionString, { max: 1 });
  const db = drizzle(migrationClient);

  console.log("Running migrations...");
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("Migrations complete.");

  await migrationClient.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
