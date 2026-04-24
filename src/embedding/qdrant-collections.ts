import { QdrantClient } from "@qdrant/js-client-rest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Embedding configuration loaded from embedding-config.json */
interface CollectionConfig {
  payloadIndexes: string[];
}

interface EmbeddingConfig {
  model: string;
  dimensions: number;
  distance: string;
  version: string;
  collections: Record<string, CollectionConfig>;
}

const config: EmbeddingConfig = JSON.parse(
  readFileSync(join(__dirname, "embedding-config.json"), "utf-8")
);

let client: QdrantClient | null = null;

/**
 * Get or create the singleton QdrantClient instance.
 * Uses the provided URL, or QDRANT_URL env var, or defaults to http://localhost:6333.
 */
export function getQdrantClient(url?: string): QdrantClient {
  if (!client) {
    const resolvedUrl =
      url ?? process.env.QDRANT_URL ?? "http://localhost:6333";
    client = new QdrantClient({ url: resolvedUrl });
    process.stderr.write(
      `[QdrantCollections] Client created for ${resolvedUrl}\n`
    );
  }
  return client;
}

/**
 * Ensure all embedding collections exist in Qdrant with correct vector config and payload indexes.
 * Idempotent: skips collections that already exist, creates missing ones.
 * Follows the fail-fast connectivity pattern from scripts/index-ontology-to-qdrant.js.
 */
export async function ensureCollections(qdrant: QdrantClient): Promise<void> {
  // Fail-fast connectivity check
  let existingCollections: string[];
  try {
    const result = await qdrant.getCollections();
    existingCollections = result.collections.map((c) => c.name);
    process.stderr.write(
      `[QdrantCollections] Connected. Existing collections: ${existingCollections.join(", ") || "(none)"}\n`
    );
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : String(error);
    process.stderr.write(
      `[QdrantCollections] Failed to connect to Qdrant: ${message}\n`
    );
    process.stderr.write(
      `[QdrantCollections] Make sure Qdrant is running: docker-compose up -d qdrant\n`
    );
    throw error;
  }

  for (const [name, collectionConfig] of Object.entries(config.collections)) {
    if (existingCollections.includes(name)) {
      process.stderr.write(
        `[QdrantCollections] Collection "${name}" already exists — skipping\n`
      );
      continue;
    }

    // Create collection with vector configuration
    await qdrant.createCollection(name, {
      vectors: {
        size: config.dimensions,
        distance: config.distance as "Cosine" | "Euclid" | "Dot",
      },
    });
    process.stderr.write(
      `[QdrantCollections] Created collection "${name}" (${config.dimensions}-dim, ${config.distance})\n`
    );

    // Create payload indexes for efficient filtering
    for (const fieldName of collectionConfig.payloadIndexes) {
      await qdrant.createPayloadIndex(name, {
        field_name: fieldName,
        field_schema: "keyword",
      });
      process.stderr.write(
        `[QdrantCollections] Created payload index "${name}.${fieldName}" (keyword)\n`
      );
    }
  }

  process.stderr.write(
    `[QdrantCollections] All collections ensured (${Object.keys(config.collections).length} total)\n`
  );
}
