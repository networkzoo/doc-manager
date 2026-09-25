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
});
export type ScanReconcileJob = z.infer<typeof ScanReconcileJobSchema>;

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
