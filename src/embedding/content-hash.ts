import crypto from "node:crypto";

/**
 * Produce a truncated SHA-256 hash of text content.
 * Used for idempotency checks during Qdrant upsert — if a point
 * with the same content_hash already exists, skip re-embedding.
 */
export function contentHash(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex").substring(0, 16);
}
