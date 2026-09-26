import { randomBytes, createHash } from "node:crypto";
import { rawSql } from "./client";

/**
 * Operator-run enrollment: creates one `connectors` row and prints the
 * raw token exactly once. Only the SHA-256 hash is ever stored — see
 * packages/db/src/schema/connectors.ts and
 * apps/portal/src/lib/connectorAuth.ts, whose sha256Hex() this must keep
 * matching. Run via:
 *
 *   pnpm --filter @law-portal/db enroll-connector -- \
 *     --tenant-slug dev-firm --site-name "Main Office" \
 *     --document-root '\\FILESRV\ClientDocs'
 *
 * Uses rawSql (bypasses RLS), same as seed.ts — this is ops tooling, not
 * a request-handling code path.
 */

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    if (!flag?.startsWith("--")) {
      throw new Error(`expected a --flag, got "${flag}"`);
    }
    const value = argv[i + 1];
    if (value === undefined) {
      throw new Error(`missing value for ${flag}`);
    }
    out[flag.slice(2)] = value;
  }
  return out;
}

async function main() {
  // pnpm's `<script> -- <args>` forwarding doesn't always strip the `--`
  // itself before handing argv to the script — tolerate a stray leading
  // one rather than mis-parsing every flag after it.
  const rawArgs = process.argv.slice(2);
  const args = parseArgs(rawArgs[0] === "--" ? rawArgs.slice(1) : rawArgs);
  const tenantSlug = args["tenant-slug"];
  const siteName = args["site-name"];
  const documentRoot = args["document-root"];

  if (!tenantSlug || !siteName || !documentRoot) {
    console.error(
      "usage: enroll-connector --tenant-slug <slug> --site-name <name> --document-root <UNC path>",
    );
    process.exit(1);
  }

  const [tenant] = await rawSql<{ id: string }[]>`
    select id from tenants where slug = ${tenantSlug} limit 1
  `;
  if (!tenant) {
    console.error(`no tenant with slug "${tenantSlug}"`);
    process.exit(1);
  }

  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token, "utf8").digest("hex");

  const [connector] = await rawSql<{ id: string }[]>`
    insert into connectors (tenant_id, site_name, document_root, enrollment_secret_hash)
    values (${tenant.id}, ${siteName}, ${documentRoot}, ${tokenHash})
    returning id
  `;

  console.log("Connector enrolled. This token is shown once — store it now:\n");
  console.log(`  connector-id: ${connector.id}`);
  console.log(`  token:        ${token}\n`);
  console.log("Run the connector with:\n");
  console.log(
    `  connector -portal <portal-url> -connector-id ${connector.id} -token ${token} -document-root "${documentRoot}"`,
  );

  await rawSql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
