import { randomUUID } from "crypto";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * Presigned PUT/GET against the self-hosted MinIO relay (docs/PLAN.md
 * "Tunnel-free file flow", superseding the plan's original Wasabi/S3
 * choice — see infra/deploy/README.md "Relay store: MinIO"). Endpoint is
 * deliberately the PUBLIC one (through Caddy), not the internal
 * minio:9000 docker-network address — these URLs get handed to a
 * browser and to connectors on other networks entirely.
 *
 * Client-side AES-256-GCM (apps/connector/internal/relay and, on the
 * browser side, WebCrypto — not yet implemented there) means this store
 * only ever holds ciphertext; forcePathStyle is required for
 * MinIO/most S3-compatible stores (virtual-hosted-style bucket URLs
 * don't work without real per-bucket DNS).
 *
 * Client construction is lazy (not module-level) so importing this file
 * doesn't require RELAY_* env vars to be set just to build the app or
 * import it transitively — only actually calling presignPut/presignGet
 * does. Same reasoning as the NODE_ENV guard in lib/session.ts.
 */

const PRESIGN_TTL_SECONDS = 60 * 60; // 1h, matching docs/PLAN.md's relay blob TTL target

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`relay.ts: missing required env var ${name}`);
  }
  return value;
}

let cachedClient: S3Client | null = null;

function getClient(): S3Client {
  if (!cachedClient) {
    cachedClient = new S3Client({
      endpoint: requireEnv("RELAY_ENDPOINT"),
      region: "us-east-1", // arbitrary — MinIO ignores region, the SDK requires one be set
      forcePathStyle: true,
      credentials: {
        accessKeyId: requireEnv("RELAY_ACCESS_KEY_ID"),
        secretAccessKey: requireEnv("RELAY_SECRET_ACCESS_KEY"),
      },
    });
  }
  return cachedClient;
}

/** A fresh, unguessable key for one blob — never reused across jobs. */
export function newBlobKey(): string {
  return randomUUID();
}

export async function presignPut(blobKey: string): Promise<string> {
  return getSignedUrl(
    getClient(),
    new PutObjectCommand({ Bucket: requireEnv("RELAY_BUCKET"), Key: blobKey }),
    { expiresIn: PRESIGN_TTL_SECONDS },
  );
}

export async function presignGet(blobKey: string): Promise<string> {
  return getSignedUrl(
    getClient(),
    new GetObjectCommand({ Bucket: requireEnv("RELAY_BUCKET"), Key: blobKey }),
    { expiresIn: PRESIGN_TTL_SECONDS },
  );
}
