# On-Prem-Backed Document & Practice Portal for Canadian Law Firms

## Context

Canadian law firms want Clio-style workflow (matter-centric filing, search, docketing) but many will not put privileged client files in a US-controlled cloud. The usual on-prem answer is a VPN or site-to-site tunnel, which firm IT resists and which is fragile to support across many client sites.

This project builds a **hosted multi-tenant web portal** whose documents physically live on **each firm's own file server**, reached by a small **on-prem connector** that makes only outbound HTTPS calls. File bytes move through an **ephemeral, client-side-encrypted object-storage relay** — no VPN, no tunnel, no inbound firewall rules.

**v1 scope:** document management + full-text search + time tracking.
**Deferred to v2:** invoicing, disbursements/tax engine, trust accounting and Law Society reconciliations, court-form automation.

Greenfield: the working directory is empty. Node 24, Python 3.14, and git are installed; Docker, .NET, and Postgres are not.

---

## Locked Decisions

| Decision | Choice |
|---|---|
| Topology | Hosted multi-tenant portal + on-prem connector, no tunnel/VPN |
| File transport | Ephemeral encrypted blob relay via object storage |
| Relay store | Wasabi `ca-central-1` (Toronto) — **see Risk R1** |
| v1 scope | DMS + search + time tracking |
| OCR/extraction | On-prem in the connector |
| Portal text storage | Extracted text encrypted at rest under a per-tenant key |
| Portal stack | TypeScript (Next.js) |
| Connector stack | Go, single static binary |
| Database | PostgreSQL |
| Portal hosting | Self-hosted on the firm's own rack server (revisit if/when scale outgrows it) |
| Portal OS | Linux (Ubuntu Server LTS or Debian) |
| Public edge | Sophos XGS reverse proxy + WAF (if licensed) with Cloudflare proxy as fallback |
| Admin access | Netbird mesh VPN — SSH/DB/ops surfaces only, never the client-facing portal |
| SSO | Build with Auth.js — multi-tenant Entra ID app + Google OIDC (see Build Phases > Phase 0) |

---

## Stack Evaluation

### Two components with genuinely different requirements

The portal and the connector are different programs with different pressures, and forcing one language across both makes one of them worse. The seam between them is a narrow HTTP/JSON + object-storage contract, which is a clean place to change languages.

**Portal — TypeScript / Next.js (App Router) + Node worker**

- The bulk of v1 is UI-heavy: matter dashboards, document tables, a PDF viewer, a docket grid, search results with snippets. The TS/React ecosystem for exactly this (TanStack Table, PDF.js, TipTap) has no serious rival.
- Node 24 is already installed; one language across web, API, and worker.
- Runs anywhere; deployed to a Canadian region.

*Alternative considered — Elixir/Phoenix:* genuinely better at the "hold N thousand live connector connections" problem (Channels, Presence, OTP supervision) and LiveView would suit the realtime sync UI. Rejected for v1 because the document-centric UI work is where the hours actually go and the TS ecosystem is far deeper there. Revisit only if connector fleet management, not the app, becomes the dominant engineering problem.

*Alternative considered — Go or Rust for the portal too:* single language, but you would hand-build much of what Next.js gives free, and the UI layer still ends up TypeScript. Not worth it.

**Connector — Go**

This is the component where "high performance" actually matters, and Go is the clear fit:

- **Single static binary, zero runtime.** You are installing this on client servers you do not control. `sc.exe create` and done. Node would need SEA/pkg bundling of a ~100 MB runtime; Python is worse. This alone decides it.
- Excellent Windows service support (`golang.org/x/sys/windows/svc`).
- Cheap concurrency for the hash/encrypt/upload pipeline; fast AES-GCM via hardware AES-NI.
- Trivial cross-compilation if a firm wants it on a Linux NAS.
- Small enough surface (a few thousand lines) that the second language is a modest tax.

*Alternative considered — Rust:* equally good binary story and stronger safety guarantees, but slower to write, and the SMB/Windows-service ecosystem is thinner. Go's advantage in ship speed wins for a component that is mostly I/O plumbing.

**Filesystem access from the connector:** default deployment is on the Windows file server itself (or a domain member), reading plain UNC paths (`\\SERVER\Share\...`) through the OS with the service account's token — no SMB client library needed. Ship `cloudsoda/go-smb2` only for the non-Windows deployment option.

### Database — PostgreSQL, single system

The core domain is aggressively relational — clients, matters, parties, documents, versions, time entries, users, permissions — with hard referential-integrity and transactional requirements. A document store is the wrong shape here; conflicts checking and billing rollups are joins, and getting a matter's party list wrong is a professional-liability event, not a bug. Postgres also covers the parts people reach for NoSQL to solve:

| Need | Postgres feature | Avoids |
|---|---|---|
| Full-text search | `tsvector` + GIN, `websearch_to_tsquery`, `ts_headline` snippets | Elasticsearch (initially) |
| Flexible per-practice-area matter fields, extracted doc metadata | `JSONB` + GIN | MongoDB |
| Tenant isolation | Row-Level Security on `tenant_id` | App-code-only isolation |
| Job queue | `FOR UPDATE SKIP LOCKED` via **Graphile Worker** | Redis/SQS in v1 |
| Semantic search (v2) | `pgvector` | A second vector DB |
| Audit trail | Append-only table + `pgaudit` | — |

**Search:** start on Postgres FTS behind a narrow `SearchIndex` interface (`index()`, `query()`, `delete()`). It is genuinely sufficient into the low millions of documents. Swap to Typesense or OpenSearch when ranking quality or faceting demands it — the interface makes that a contained change, and adding a search cluster on day one is premature.

**Multi-tenancy:** one database, `tenant_id` on every table, RLS policies enforced at the DB so a missing `WHERE` clause cannot leak another firm's matters. Offer dedicated-database deployment later for firms that require it.

**Connector-local state:** SQLite (file inventory, content hashes, sync cursor, pending jobs). Right tool — embedded, transactional, zero-admin.

**Rejected:** MongoDB/DynamoDB (wrong shape for a relational, audited, transactional domain), MySQL (weaker FTS, JSONB, and RLS story), SQLite server-side (multi-tenant write concurrency).

---

## Architecture

### Tunnel-free file flow

The connector opens **only outbound HTTPS/443** to the portal and to Wasabi. No inbound ports, no VPN, no firewall exceptions. That is the entire pitch to firm IT.

**Job delivery:** connector holds a long-poll (or SSE) connection to the portal. Long-poll is the safer default — it survives corporate proxies and TLS-inspecting middleboxes that break WebSockets.

**Download — user clicks a document in the portal**

1. Portal enqueues job `stage_download(document_id)`; connector picks it up on its next poll.
2. Connector reads the file from SMB, generates a fresh random content key, encrypts with **AES-256-GCM**.
3. Connector `PUT`s ciphertext to a short-TTL presigned URL.
4. Connector reports blob key + content key back to the portal over TLS.
5. Portal hands the browser a presigned `GET` plus the content key; the browser decrypts in-page with **WebCrypto**.
6. Lifecycle rule expires the blob (target: 1 hour).

**Upload — reverse.** Browser encrypts, `PUT`s to a presigned URL, portal notifies the connector, connector `GET`s, decrypts, writes to the correct matter path on SMB, then deletes the blob.

**Net effect:** the relay only ever holds ciphertext, briefly. Wasabi cannot read documents; neither can the portal, for file bytes.

### The honest security boundary

State this plainly in firm-facing material — do not let a salesperson overstate it:

- **File bytes:** portal and relay see ciphertext only. Effectively zero-knowledge.
- **Extracted text:** the portal **does** hold it, encrypted at rest under a per-tenant key, and **decrypts it in memory to serve queries.** This is the deliberate price of real server-side ranked search.
- **Metadata** (matter names, party names, filenames, time narratives) lives in the portal database.

Everything lives in Canadian regions. Per-tenant keys in a KMS, rotatable, with a documented "revoke tenant key" path.

### Hosting & data residency

**Decision: self-hosted on your own rack**, not managed cloud. At single-digit-firm scale, ~$150–800 CAD/month of Azure/AWS spend isn't justified when spare rack capacity already exists. This is also the strongest possible residency story available — not "a Canadian region of a US-owned cloud" but literally your own hardware, in your own building. Revisit only once load (see "Load" under Verification) or redundancy/uptime needs genuinely outgrow one rack server — the app is built as ordinary containers, so that migration is a redeploy, not a rewrite.

**OS: Linux (Ubuntu Server LTS or Debian).** This is specifically the *portal's* OS — unlike the connector, which targets Windows for native SMB/AD integration, the portal is just Next.js + Postgres + a reverse proxy, and Linux is the better-trodden path for that combination (container tooling, patching cadence, no Windows Server licensing for a workload that gains nothing from it).

**Public edge — two tiers, don't conflate them:**

- **Client-facing portal traffic** (browsers doing SSO login, connector long-poll/relay calls) needs a normal public HTTPS front door. Primary: the **Sophos XGS reverse proxy + WAF module** already sitting in front of the rack — check whether the current license tier has WAF unlocked (base firewall license usually covers the reverse-proxy/WAF feature; some signature sets need a Central or Network Protection add-on). Fallback: **Cloudflare proxy** in front of the portal — TLS termination and DDoS shielding only, with caching disabled on every authenticated route so Cloudflare never holds document content or session data, just shields the public IP.
- **Your own admin/ops surfaces** (SSH, direct Postgres access, an eventual connector-fleet dashboard) are a different problem and get a different answer: put them behind **Netbird** (or an equivalent mesh VPN) so they never have a public listener at all. Netbird is the wrong tool for the portal itself — every law-firm user would need a VPN client installed just to load a browser tab, which defeats the whole "sign in with your Microsoft 365 account" design. Scope it to your own access, not client traffic.

**What self-hosting actually shifts onto you** (a managed cloud DB/App Service would otherwise absorb this):
- **Backups.** No automatic managed-DB backups anymore — stand up nightly `pg_dump` + WAL archiving to encrypted off-site storage (a small Wasabi/S3 bucket separate from the relay bucket is the natural choice, or a second physical site if you have one). Test restores, not just backup jobs.
- **Patching and uptime** for the OS, Postgres, and the reverse proxy/WAF itself.
- **Power/connectivity continuity** — UPS and, ideally, a secondary internet path, since a residential-grade outage now takes the whole client-facing portal down, not just your internal tools.
- **TLS certificate renewal** — automated (Sophos' built-in ACME support, or Caddy/certbot if Cloudflare is fronting instead), but someone still needs to notice if it silently stops renewing.

**One thing that does NOT change:** the encrypted relay design (docs/PLAN.md "Tunnel-free file flow") already assumed a subpoena to the object-storage vendor should only ever yield ciphertext — that reasoning holds regardless of where the portal itself lives, and self-hosting the portal removes the one part of the original design (the cloud provider itself) that carried any residual jurisdictional question at all.

### Component map

```
Browser ──TLS──> Sophos WAF / Cloudflare ──> Portal (Next.js + Postgres,
   │                (public edge)              your rack, Linux)
   │                                              │  long-poll jobs
   │                                              ▼
   │                                        Connector (Go service, inside firm LAN)
   │                                              │ UNC/SMB
   │                                              ▼
   │                                        Firm file server ──► OCR (bundled Tesseract), on-prem
   │
   └──presigned PUT/GET────────────────────────────────► Wasabi ca-central-1 (ciphertext, ~1h TTL)

(Netbird mesh VPN, not pictured: your own SSH/DB/ops access to the rack —
never in the client-facing path above.)
```

---

## Permissions Model (the "advise me" answer)

**Recommendation: service account on SMB + app-level ACLs in Postgres, with NTFS ACL import and drift detection.**

Per-user Kerberos impersonation is effectively off the table given the topology — the portal is in the cloud and there is no delegation path from a browser session to a domain ticket without the tunnel you are explicitly avoiding. So:

- The connector runs as a **dedicated domain service account** with rights to the document root.
- **Postgres is the source of truth** for who sees which matter and which document, including ethical walls.
- On setup, the connector **reads existing NTFS ACLs and imports them** as the initial permission seed, so you inherit the firm's existing structure instead of asking them to rebuild it.
- A periodic job **re-reads NTFS ACLs and reports drift** ("Folder X is restricted on the file server but open in the portal"), surfaced to firm admins.

The real risk is stated openly: **the portal bypasses NTFS**, so an app-permission bug is a privilege breach. Mitigations that must ship in v1, not later:
- RLS enforced at the database layer, not only in application code.
- Ethical walls as a hard deny that overrides all role grants, with **attempted** access logged, not just successful access.
- Permission-change events in the immutable audit log.
- An automated test suite dedicated to authorization, including negative cases.

---

## Domain Model (v1 core)

```
tenants ─┬─ users ── roles, timekeeper_rate, mfa
         ├─ clients ── type(individual|corp), conflicts_names[]
         ├─ matters ── matter_number, practice_area, responsible_lawyer,
         │             status, opened_at, closed_at, limitation_date,
         │             smb_path, custom_fields(JSONB)
         │      ├─ matter_parties ── party, role(client|opposing|counsel|
         │      │                    court|witness|expert), conflict_checked
         │      ├─ matter_access ── user, grant|deny (ethical walls)
         │      └─ documents ── filename, rel_path, content_hash, size,
         │             │        doc_type, tags[], metadata(JSONB),
         │             │        checked_out_by, extracted_text_enc, tsv
         │             └─ document_versions ── version_no, hash, author, at
         ├─ time_entries ── matter, user, date, duration_min, narrative,
         │                  utbms_task_code, billable, rate, status
         ├─ conflict_searches ── terms, results_snapshot, run_by, run_at
         ├─ connectors ── site_name, last_seen, version, health
         └─ audit_events ── actor, action, target, ip, at  (append-only)
```

### Canadian-firm functionality carried in v1

- **Conflicts checking** — search across all clients, matters, and party names (including former/alternate names and corporate affiliates) before a matter opens. **Log every search and its result** — a firm must be able to demonstrate the check was run, not merely assert it. Non-negotiable.
- **Limitation-period tracking** — `limitation_date` per matter with escalating reminders. Missed limitation periods are the single largest source of Canadian malpractice claims; a date field plus reminders is cheap here and disproportionately valuable.
- **Ethical walls** — per-matter deny that overrides role grants.
- **Matter numbering** — configurable scheme (e.g. `CLIENT-YYYY-NNN`), unique per tenant.
- **Folder templates per practice area** — auto-create the firm's standard structure on SMB at matter open (Real Estate: Correspondence / Title / Closing / Accounts).
- **Retention & closing** — matter close → archive; retention schedule with destruction holds. Ontario's By-Law 9 requires 10-year retention of financial records; other provinces differ, so make schedules **table-driven per province**, never hardcoded.
- **Immutable audit trail** — view, download, edit, delete, permission change, failed access.
- **i18n (EN/FR) from day one** — required in practice for Quebec and New Brunswick. Cheap now, painful to retrofit.
- **Tax table scaffolding** — province × rate × **effective date**, seeded but unused until v2 billing. Rates change (Nova Scotia's HST moved in 2025); a table with effective dates is the only correct design.

### Time tracking

- Multiple concurrent timers, start/stop/resume; manual entry; week-view docket grid.
- 0.1 h (6-minute) minimum increment, configurable; rounding and write-down rules.
- Rate resolution order: matter override → client override → timekeeper default.
- UTBMS task/activity codes, with LEDES 1998B export (v2 consumes it).
- Billable targets per timekeeper; WIP reporting; entry lock/approval before billing.
- **Passive capture** — because the portal already logs every document event, it can propose entries ("you had matter X documents open for 47 minutes"). This is a real differentiator over Clio and is nearly free given the audit log already exists.

---

## The Hard Part: SMB Reconciliation

The most commonly underestimated risk in this design. **Lawyers and assistants will keep editing files directly in Windows Explorer**, bypassing the portal entirely. If the portal's index silently drifts from the file server, users stop trusting it and the product is dead.

Requirements:
- **Change detection:** `ReadDirectoryChangesW` when the connector runs on the file server itself. `fsnotify` over a *remote* SMB share is unreliable and must not be the only mechanism.
- **Scheduled full reconciliation scan** regardless of watch mechanism — hash-based, incremental.
- **NTFS USN Journal** as the scale answer for large trees; polling a million-file share does not work.
- **Conflict policy:** portal edit vs. on-disk edit — never silently overwrite. Keep both, flag for user resolution.
- **Check-out/lock:** SMB has no versioning, so the portal owns version history. Prior versions go to a hidden sidecar (`.dmsversions/`) on-prem.
- **Bulk-change alarm:** a sudden mass rewrite is a plausible ransomware signature. Alert, and pause sync rather than propagating.

---

## Build Phases

**Phase 0 — Foundations.** pnpm monorepo (`apps/portal`, `apps/connector`, `packages/shared`). Postgres via Docker Compose for local dev; production Postgres runs the same way on the rack server itself (docs/PLAN.md "Hosting & data residency") — no managed-cloud DB service in this design. Drizzle or Prisma migrations. RLS policies from the very first migration, never bolted on.

**SSO (build, not buy — Auth.js):** register one multi-tenant Entra ID app (sign-in audience "Accounts in any organizational directory" — the same mechanism Slack/Notion use for "Sign in with Microsoft," not a per-tenant app registration) plus a Google OIDC provider, both via Auth.js on the portal. After token exchange, resolve the authenticated user's Entra tenant ID (the `tid` claim) or email domain to the correct `tenants` row; first-login provisioning only proceeds if a firm admin has already invited that user or that tenant domain is pre-registered — never auto-create a tenant from an unrecognized login. No recurring per-organization SSO fee, at the cost of owning tenant-resolution logic and any SAML/SCIM work a firm's IT later asks for. A managed B2B SSO service (WorkOS et al.) is the fallback if that maintenance burden turns out to dominate — revisit if/when a firm demands SAML or SCIM outright.

**Phase 1 — Connector + relay (do this first).** This is the riskiest, most novel part; prove it before building UI on top of an unproven assumption. Go service skeleton, Windows service install, enrolment/pairing flow, long-poll job loop, SMB scan → SQLite inventory, AES-GCM encrypt → presigned PUT → portal notify → browser decrypt. **Exit criteria: a file on a local SMB share opens in a browser with no tunnel, and the relay blob provably expires.**

**Phase 2 — Clients, matters, parties, conflicts.** Domain CRUD, matter numbering, conflicts search with logged results, ethical walls, the authorization test suite.

**Phase 3 — DMS.** Matter-path mapping, folder templates, upload/download, versions, check-out, and the reconciliation engine from the section above.

**Phase 4 — OCR + search.** Bundle Tesseract in the connector; text extraction for PDF/Office/scans; encrypted text to the portal; Postgres FTS behind the `SearchIndex` interface; snippets, filters, matter-scoped and global search.

**Phase 5 — Time tracking.** Timers, docket grid, task codes, rates, targets, passive-capture suggestions, CSV/LEDES export.

**Phase 6 — Hardening.** Immutable audit log with an admin viewer, retention/destruction workflow, connector health dashboard and auto-update, per-tenant key rotation, backup/restore runbook, PIPEDA and Quebec Law 25 documentation (breach process, privacy officer, retention policy).

**Phase 7 — Pilot** with one friendly firm on real matters before onboarding a second.

---

## Risks

**R1 — Wasabi is a poor fit for a relay workload, and this needs re-checking before Phase 1 commits.** Two specific concerns, both worth verifying against current Wasabi terms rather than trusting this document:
- Wasabi bills a **minimum storage duration** (on the order of 90 days for pay-as-you-go). Blobs you delete after an hour may still bill as if stored for months. At document sizes this is likely tolerable — storage is cheap — but it is not free the way it looks.
- Wasabi's free egress carries a **fair-use policy tying monthly egress to stored volume**. A relay is the exact anti-pattern: near-zero stored bytes, high egress. This could put the account outside acceptable use.

Mitigation: put the relay behind a `BlobRelay` interface (`presignPut`, `presignGet`, `expire`) from the first commit. Swapping to S3 `ca-central-1` then costs about a day. Recommend pricing both against a realistic monthly transfer estimate before Phase 1 ends.

**R2 — App permissions bypass NTFS.** Addressed by RLS + ACL import + drift detection + a dedicated authz test suite. Treat any authorization gap as a P0.

**R3 — Index drift from out-of-band edits.** Addressed in the reconciliation section; the pilot is the real test.

**R4 — Connector fleet operations.** N installs on servers you do not control, behind unknown proxies. Needs auto-update, health telemetry, and remote log retrieval from day one, not after the tenth firm.

**R5 — Scope gravity toward trust accounting.** Firms will ask for it immediately. Trust accounting errors are a Law Society disciplinary matter, not a bug — it deserves its own project with accounting review, and should not be smuggled into v1.

---

## Verification

**Phase 1 (the critical proof)** — set up a Windows SMB share on a test VM, install the connector as a service, enrol it against a locally running portal, then:
- Click a file in the browser and confirm it renders, with the network tab showing only outbound calls to portal + Wasabi.
- Confirm the firm-side firewall has **no** inbound rule and the flow still works.
- Fetch the relay blob directly with the presigned URL and confirm it is ciphertext.
- Wait out the TTL and confirm the blob 404s.
- Upload via the browser and confirm the file lands at the correct SMB path with correct content.

**Reconciliation** — edit a file directly in Explorer while the portal is open; confirm the change is detected and versioned. Edit in both places simultaneously; confirm a conflict is raised and **nothing is silently overwritten**.

**Authorization** — automated suite asserting that a user without a matter grant gets zero rows via the API, via search, and via direct download URL; that an ethical wall overrides an explicit role grant; and that **denied attempts appear in the audit log**.

**Conflicts** — seed adverse parties across matters and confirm the search surfaces them and writes a `conflict_searches` record.

**Time tracking** — run concurrent timers, confirm rounding to the configured increment, confirm rate resolution order, and reconcile a week's docket export against the entries.

**Load** — index a synthetic 100k-document tree; measure scan time, OCR throughput, and search latency. This is where the "Postgres FTS is enough" assumption gets tested, and where you learn whether Typesense is needed sooner than planned.
