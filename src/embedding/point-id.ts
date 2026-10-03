// The Qdrant point id of a knowledge-graph node: a UUID-shaped md5 of its key.
// Own module so tools that address existing points (scripts/backfill-qdrant-
// project.mjs) can import it without importing backfill.ts, which runs its
// backfill on import.

import crypto from "node:crypto";

export function keyToUuid(key: string): string {
  const hex = crypto.createHash("md5").update(key).digest("hex");
  // Format as UUID v4 shape: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
  return [
    hex.substring(0, 8),
    hex.substring(8, 12),
    "4" + hex.substring(13, 16),
    ((parseInt(hex.charAt(16), 16) & 0x3) | 0x8).toString(16) +
      hex.substring(17, 20),
    hex.substring(20, 32),
  ].join("-");
}
