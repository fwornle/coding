#!/usr/bin/env npx tsx
/**
 * backfill.ts — One-shot CLI script to embed all existing knowledge into Qdrant.
 *
 * Reads observations, digests, and insights from SQLite (.observations/observations.db)
 * and KG entities from LevelDB (.data/knowledge-graph/), embeds via fastembed
 * (all-MiniLM-L6-v2, 384-dim), and upserts to 4 Qdrant collections with
 * content-hash idempotency.
 *
 * Usage:
 *   npx tsx src/embedding/backfill.ts [--dry-run] [--batch-size N] [--tier observations|digests|insights|kg_entities]
 */

// @ts-expect-error -- better-sqlite3 has no bundled type declarations
import Database from "better-sqlite3";
import { Level } from "level";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { getEmbeddingService } from "./embedding-service.js";
import { contentHash } from "./content-hash.js";
import { ensureCollections, getQdrantClient } from "./qdrant-collections.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, "../..");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BackfillItem {
  id: string;
  text: string;
  payload: Record<string, unknown>;
}

interface BackfillOptions {
  dryRun: boolean;
  batchSize: number;
  tier: string | null;
}

interface TierResult {
  embedded: number;
  skipped: number;
  failed: number;
}

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs(): BackfillOptions {
  const args = process.argv.slice(2);
  const options: BackfillOptions = {
    dryRun: false,
    batchSize: 64,
    tier: null,
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--dry-run") {
      options.dryRun = true;
    } else if (args[i] === "--batch-size" && args[i + 1]) {
      options.batchSize = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === "--tier" && args[i + 1]) {
      options.tier = args[i + 1];
      i++;
    }
  }

  return options;
}

// ---------------------------------------------------------------------------
// Deterministic UUID from arbitrary key string (for KG entities)
// ---------------------------------------------------------------------------

function keyToUuid(key: string): string {
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

// ---------------------------------------------------------------------------
// Tier readers
// ---------------------------------------------------------------------------

function readObservations(db: Database.Database): BackfillItem[] {
  const rows = db
    .prepare(
      `SELECT id, summary, agent, created_at, quality FROM observations WHERE summary IS NOT NULL`
    )
    .all() as Array<{
    id: string;
    summary: string;
    agent: string | null;
    created_at: string | null;
    quality: string | null;
  }>;

  return rows.map((r) => ({
    id: r.id,
    text: r.summary,
    payload: {
      agent: r.agent ?? null,
      project: "coding",
      date: r.created_at?.split("T")[0] ?? null,
      quality: r.quality ?? "normal",
      summary_preview: r.summary.substring(0, 200),
    },
  }));
}

function readDigests(db: Database.Database): BackfillItem[] {
  const rows = db
    .prepare(
      `SELECT id, summary, date, theme, agents, quality, created_at FROM digests WHERE summary IS NOT NULL`
    )
    .all() as Array<{
    id: string;
    summary: string;
    date: string;
    theme: string;
    agents: string | null;
    quality: string | null;
    created_at: string;
  }>;

  return rows.map((r) => ({
    id: r.id,
    text: r.summary,
    payload: {
      date: r.created_at?.split("T")[0] ?? r.date,
      theme: r.theme,
      agents: r.agents ?? null,
      quality: r.quality ?? "normal",
      summary_preview: r.summary.substring(0, 200),
    },
  }));
}

function readInsights(db: Database.Database): BackfillItem[] {
  const rows = db
    .prepare(
      `SELECT id, summary, topic, confidence, digest_ids, created_at FROM insights WHERE summary IS NOT NULL`
    )
    .all() as Array<{
    id: string;
    summary: string;
    topic: string;
    confidence: number;
    digest_ids: string;
    created_at: string;
  }>;

  return rows.map((r) => ({
    id: r.id,
    text: r.summary,
    payload: {
      topic: r.topic,
      confidence: r.confidence,
      digestIds: r.digest_ids,
      summary_preview: r.summary.substring(0, 200),
    },
  }));
}

interface GraphNode {
  key: string;
  attributes: {
    name?: string;
    entityType?: string;
    type?: string;
    observations?: string[];
    isScaffoldNode?: boolean;
    hierarchyLevel?: number;
    parentEntityName?: string;
    [k: string]: unknown;
  };
}

interface SerializedGraph {
  nodes: GraphNode[];
  edges: unknown[];
  metadata?: unknown;
}

async function readKgEntities(
  levelPath: string
): Promise<BackfillItem[]> {
  const db = new Level(levelPath, { valueEncoding: "json" });
  try {
    const graph = (await db.get("graph")) as unknown as SerializedGraph;

    const items: BackfillItem[] = [];
    for (const node of graph.nodes) {
      const attrs = node.attributes ?? {};

      // Filter: skip scaffold nodes
      if (attrs.isScaffoldNode) continue;

      // Filter: skip nodes with fewer than 2 observations
      const observations = attrs.observations ?? [];
      if (observations.length < 2) continue;

      const name = attrs.name ?? node.key;
      const text = name + "\n" + observations.join("\n");
      const entityType = attrs.entityType ?? attrs.type ?? "Unknown";
      const level = attrs.hierarchyLevel ?? null;
      const parentId = attrs.parentEntityName ?? null;

      items.push({
        id: keyToUuid(node.key),
        text,
        payload: {
          entityType,
          hierarchyLevel: level,
          parentId,
          summary_preview: text.substring(0, 200),
        },
      });
    }

    return items;
  } finally {
    await db.close();
  }
}

// ---------------------------------------------------------------------------
// Core backfill logic
// ---------------------------------------------------------------------------

async function backfillTier(
  collectionName: string,
  items: BackfillItem[],
  options: BackfillOptions
): Promise<TierResult> {
  const embedder = getEmbeddingService();
  const qdrant = getQdrantClient();
  const config = embedder.getConfig();

  let embedded = 0;
  let skipped = 0;
  let failed = 0;

  process.stderr.write(
    `[Backfill] Starting ${collectionName}: ${items.length} items\n`
  );

  for (let i = 0; i < items.length; i += options.batchSize) {
    const batch = items.slice(i, i + options.batchSize);
    const hashes = batch.map((item) => contentHash(item.text));

    // Idempotency check: find which items already exist by content_hash
    const toEmbed: Array<BackfillItem & { hash: string }> = [];

    for (let j = 0; j < batch.length; j++) {
      try {
        const existing = await qdrant.scroll(collectionName, {
          filter: {
            must: [
              { key: "content_hash", match: { value: hashes[j] } },
            ],
          },
          limit: 1,
          with_payload: false,
          with_vector: false,
        });

        if (existing.points.length === 0) {
          toEmbed.push({ ...batch[j], hash: hashes[j] });
        } else {
          skipped++;
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(
          `[Backfill] Warning: scroll check failed for ${batch[j].id}: ${msg}\n`
        );
        // If scroll fails, try to embed anyway
        toEmbed.push({ ...batch[j], hash: hashes[j] });
      }
    }

    if (toEmbed.length === 0) continue;

    if (options.dryRun) {
      embedded += toEmbed.length;
      continue;
    }

    // Embed and upsert
    try {
      const embedTexts = toEmbed.map((item) => item.text);
      const embeddings = embedder.embedBatch(embedTexts, options.batchSize);

      let offset = 0;
      for await (const vectors of embeddings) {
        const points = vectors.map((vec, j) => ({
          id: toEmbed[offset + j].id,
          vector: Array.from(vec),
          payload: {
            ...toEmbed[offset + j].payload,
            content_hash: toEmbed[offset + j].hash,
            model_version: config.version,
          },
        }));

        await qdrant.upsert(collectionName, { wait: true, points });
        embedded += points.length;
        offset += vectors.length;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        `[Backfill] Error embedding batch at offset ${i}: ${msg}\n`
      );
      failed += toEmbed.length;
    }

    process.stderr.write(
      `  [${collectionName}] ${Math.min(i + options.batchSize, items.length)}/${items.length} processed (${embedded} embedded, ${skipped} skipped)\n`
    );
  }

  return { embedded, skipped, failed };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const options = parseArgs();

  process.stderr.write(
    `[Backfill] Starting backfill (dryRun=${options.dryRun}, batchSize=${options.batchSize}, tier=${options.tier ?? "all"})\n`
  );

  const embedder = getEmbeddingService();
  await embedder.initialize();

  const qdrant = getQdrantClient();
  await ensureCollections(qdrant);

  const dbPath = join(projectRoot, ".observations/observations.db");
  const db = new Database(dbPath, { readonly: true });

  const levelPath = join(projectRoot, ".data/knowledge-graph");

  const tiers: Array<{ name: string; collection: string; loader: () => Promise<BackfillItem[]> | BackfillItem[] }> = [
    { name: "Observations", collection: "observations", loader: () => readObservations(db) },
    { name: "Digests", collection: "digests", loader: () => readDigests(db) },
    { name: "Insights", collection: "insights", loader: () => readInsights(db) },
    { name: "KG Entities", collection: "kg_entities", loader: () => readKgEntities(levelPath) },
  ];

  const results: Array<{ name: string; result: TierResult; count: number }> = [];

  try {
    for (const tier of tiers) {
      if (options.tier && tier.collection !== options.tier) continue;

      const items = await tier.loader();
      process.stderr.write(
        `[Backfill] ${tier.name}: found ${items.length} items\n`
      );

      const result = await backfillTier(tier.collection, items, options);
      results.push({ name: tier.name, result, count: items.length });
    }

    // Summary
    process.stderr.write(`\n[Backfill] === Summary ===\n`);
    let totalEmbedded = 0;
    let totalSkipped = 0;
    let totalFailed = 0;

    for (const { name, result } of results) {
      process.stderr.write(
        `[Backfill] ${name}: ${result.embedded} embedded, ${result.skipped} skipped, ${result.failed} failed\n`
      );
      totalEmbedded += result.embedded;
      totalSkipped += result.skipped;
      totalFailed += result.failed;
    }

    process.stderr.write(
      `[Backfill] Total: ${totalEmbedded} points across ${results.length} collections (${totalSkipped} skipped, ${totalFailed} failed)\n`
    );

    if (options.dryRun) {
      process.stderr.write(
        `[Backfill] DRY RUN -- no embeddings were generated or upserted\n`
      );
    }
  } finally {
    db.close();
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`[Backfill] Fatal error: ${msg}\n`);
  if (err instanceof Error && err.stack) {
    process.stderr.write(`${err.stack}\n`);
  }
  process.exit(1);
});
