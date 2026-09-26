import { z } from "zod";

/**
 * Contract for jobs the portal hands to a connector over the long-poll
 * channel, and the results the connector reports back. This file is the
 * seam between the TypeScript portal and the Go connector: the Go side
 * hand-maintains a matching struct set (apps/connector/internal/jobs) since
 * it can't import this package directly. Keep the two in lockstep — if you
 * change a field here, change it there in the same commit.
 *
 * See docs/PLAN.md "Tunnel-free file flow" for the download/upload
 * sequence these jobs implement.
 */

export const JobTypeSchema = z.enum([
  "stage_download", // portal -> connector: encrypt+upload a document for a browser to fetch
  "receive_upload", // portal -> connector: decrypt+write a browser-uploaded document to SMB
  "scan_reconcile", // portal -> connector: run/report a full reconciliation scan
]);
export type JobType = z.infer<typeof JobTypeSchema>;

export const StageDownloadJobSchema = z.object({
  type: z.literal("stage_download"),
  jobId: z.string().uuid(),
  documentId: z.string().uuid(),
  relPath: z.string(), // matter-relative path the connector resolves against its document root
  matterSmbPath: z.string(),
});
export type StageDownloadJob = z.infer<typeof StageDownloadJobSchema>;

export const ReceiveUploadJobSchema = z.object({
  type: z.literal("receive_upload"),
  jobId: z.string().uuid(),
  documentId: z.string().uuid(),
  relPath: z.string(),
  matterSmbPath: z.string(),
  blobKey: z.string(), // object key in the relay bucket holding the ciphertext to fetch
  contentKeyB64: z.string(), // AES-256 content key, base64 — see EncryptionEnvelopeSchema
});
export type ReceiveUploadJob = z.infer<typeof ReceiveUploadJobSchema>;

export const ScanReconcileJobSchema = z.object({
  type: z.literal("scan_reconcile"),
  jobId: z.string().uuid(),
  matterSmbPath: z.string().optional(), // omitted = full document root scan
  // true: list immediate subdirectory names only, no recursion or hashing
  // — cheap enough to run against the document root itself even when it
  // holds tens of thousands of matter folders (e.g. a legacy bulk-import
  // source). false/omitted: the normal full recursive hash-everything
  // scan, meant to be scoped to one matter's smbPath so the resulting
  // manifest stays a sane size.
  topLevelOnly: z.boolean().optional(),
});
export type ScanReconcileJob = z.infer<typeof ScanReconcileJobSchema>;

// One entry per file (or, when the job ran with topLevelOnly, per
// directory) found during a scan_reconcile job. sizeBytes/contentHash are
// absent for directory entries — there's nothing to hash.
export const ManifestEntrySchema = z.object({
  relPath: z.string(),
  isDir: z.boolean(),
  sizeBytes: z.number().int().optional(),
  contentHash: z.string().optional(),
  modifiedAt: z.string().optional(), // RFC3339, absent for directory entries
});
export type ManifestEntry = z.infer<typeof ManifestEntrySchema>;

export const ConnectorJobSchema = z.discriminatedUnion("type", [
  StageDownloadJobSchema,
  ReceiveUploadJobSchema,
  ScanReconcileJobSchema,
]);
export type ConnectorJob = z.infer<typeof ConnectorJobSchema>;

export const JobResultSchema = z.object({
  jobId: z.string().uuid(),
  ok: z.boolean(),
  // Present on stage_download success: where the ciphertext landed and the
  // key to decrypt it, handed onward to the browser by the portal.
  blobKey: z.string().optional(),
  contentKeyB64: z.string().optional(),
  contentHash: z.string().optional(), // sha256 of plaintext, for version tracking
  sizeBytes: z.number().int().optional(),
  // Present on scan_reconcile success — the actual scan output, not just a
  // count. Left unpaginated for now: chunking only matters once a single
  // scan_reconcile's scope (the whole document root, or one huge matter
  // folder) produces a manifest too large for one HTTP request to carry —
  // revisit if that turns out to be real rather than hypothetical.
  manifest: z.array(ManifestEntrySchema).optional(),
  error: z.string().optional(),
});
export type JobResult = z.infer<typeof JobResultSchema>;

/**
 * The encryption envelope every blob in the relay bucket conforms to.
 * AES-256-GCM: a fresh random key and nonce per blob, never reused.
 * The relay store (Wasabi/S3/etc, see docs/PLAN.md Risk R1) sees only
 * `ciphertext` — key and nonce travel out-of-band over TLS between portal
 * and connector, never alongside the blob itself.
 */
export const EncryptionEnvelopeSchema = z.object({
  algorithm: z.literal("AES-256-GCM"),
  nonceB64: z.string(), // 12 bytes, base64
  authTagB64: z.string(), // 16 bytes, base64 (GCM tag)
});
export type EncryptionEnvelope = z.infer<typeof EncryptionEnvelopeSchema>;
