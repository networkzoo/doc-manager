import { defineConfig } from "drizzle-kit";

// Local dev default matches docker-compose.yml. Never commit a real
// connection string — production URLs come from the deploy environment.
const connectionString =
  process.env.DATABASE_URL ??
  "postgres://law_portal:dev_only_password@localhost:5432/law_portal";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/*.ts",
  out: "./drizzle",
  dbCredentials: { url: connectionString },
  verbose: true,
  strict: true,
});
