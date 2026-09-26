import { rawSql } from "./client";

/**
 * Operator-run bulk import: takes a completed scan_reconcile job's
 * top-level-directory manifest (see apps/connector/internal/scan's
 * ListTopLevelDirs and packages/shared/src/jobs.ts's ManifestEntrySchema)
 * and creates one `matters` row per folder that doesn't already exist.
 *
 * Folder naming convention this parses (confirmed against a real client's
 * document tree, not assumed):
 *
 *   <matterNumber> [(<responsible person's initials>)] [<free-text detail>]
 *   e.g. "32860 (dr) STELKIA, JANE purchase of 153 - 2450 Radio Tower Road"
 *
 * `clientId` is deliberately left NULL — the free-text detail after the
 * initials mixes party name, transaction type, and property address with
 * no reliable structure to split it into a clean `clients.display_name`.
 * It's preserved as-is in `customFields` instead of being discarded, but
 * turning it into a real `clients` row is a separate, later pass (likely
 * needing a human to actually read each one), not something this script
 * should guess at. `responsibleLawyerId` is resolved from the initials
 * against `users.initials` when there's a match; left NULL otherwise
 * (folder had no initials, or they don't match any known user) rather
 * than failing the whole import over one unmatched entry.
 *
 * Run via:
 *
 *   pnpm --filter @law-portal/db bulk-import-matters -- \
 *     --tenant-slug porrelli-law --job-id <scan_reconcile job id> \
 *     --smb-prefix eConvey --practice-area "Real Estate"
 */

const FOLDER_NAME_PATTERN = /^(\d+)\s*(?:\(([^)]+)\))?\s*(.*)$/;

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

type ManifestEntry = { relPath: string; isDir: boolean };

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const tenantSlug = args["tenant-slug"];
  const jobId = args["job-id"];
  const smbPrefix = args["smb-prefix"];
  const practiceArea = args["practice-area"];

  if (!tenantSlug || !jobId || !smbPrefix || !practiceArea) {
    console.error(
      "usage: bulk-import-matters --tenant-slug <slug> --job-id <scan_reconcile job id> " +
        '--smb-prefix <path relative to document root> --practice-area "<name>"',
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

  const [job] = await rawSql<{ status: string; type: string; result: { manifest?: ManifestEntry[] } | null }[]>`
    select status, type, result
    from connector_jobs
    where id = ${jobId} and tenant_id = ${tenant.id}
    limit 1
  `;
  if (!job) {
    console.error(`no connector_jobs row "${jobId}" for tenant "${tenantSlug}"`);
    process.exit(1);
  }
  if (job.type !== "scan_reconcile" || job.status !== "succeeded" || !job.result?.manifest) {
    console.error(`job ${jobId} isn't a succeeded scan_reconcile job with a manifest (status=${job.status}, type=${job.type})`);
    process.exit(1);
  }

  const users = await rawSql<{ id: string; initials: string }[]>`
    select id, initials from users where tenant_id = ${tenant.id} and initials is not null
  `;
  const userByInitials = new Map(users.map((u) => [u.initials.toLowerCase(), u.id]));

  let created = 0;
  let skippedExisting = 0;
  const unparsed: string[] = [];
  const unmatchedInitials: { matterNumber: string; initials: string }[] = [];

  for (const entry of job.result.manifest) {
    if (!entry.isDir) continue;

    const match = FOLDER_NAME_PATTERN.exec(entry.relPath);
    if (!match) {
      unparsed.push(entry.relPath);
      continue;
    }
    const [, matterNumber, initials, detail] = match;

    let responsibleLawyerId: string | null = null;
    if (initials) {
      const resolved = userByInitials.get(initials.toLowerCase());
      if (resolved) {
        responsibleLawyerId = resolved;
      } else {
        unmatchedInitials.push({ matterNumber, initials });
      }
    }

    const smbPath = `${smbPrefix}\\${entry.relPath}`;

    const [inserted] = await rawSql<{ id: string }[]>`
      insert into matters (tenant_id, matter_number, practice_area, responsible_lawyer_id, smb_path, custom_fields)
      values (
        ${tenant.id}, ${matterNumber}, ${practiceArea}, ${responsibleLawyerId}, ${smbPath},
        ${rawSql.json({ importedFrom: "bulk-import-matters", importedFolderDetail: detail || null })}
      )
      on conflict on constraint matters_tenant_number_unique do nothing
      returning id
    `;
    if (inserted) {
      created++;
    } else {
      skippedExisting++;
    }
  }

  console.log(`Processed ${job.result.manifest.length} manifest entries:`);
  console.log(`  ${created} matters created`);
  console.log(`  ${skippedExisting} skipped (matter_number already existed)`);
  if (unparsed.length > 0) {
    console.log(`  ${unparsed.length} folder names didn't match the expected pattern at all:`);
    for (const name of unparsed) console.log(`    - ${name}`);
  }
  if (unmatchedInitials.length > 0) {
    console.log(`  ${unmatchedInitials.length} matters created with unresolved initials (responsible_lawyer_id left NULL):`);
    for (const { matterNumber, initials } of unmatchedInitials) {
      console.log(`    - matter ${matterNumber}: "${initials}" doesn't match any user's initials for this tenant`);
    }
  }

  await rawSql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
