#!/usr/bin/env npx tsx
/**
 * backfill.ts — One-shot CLI script to embed all existing knowledge into Qdrant.
 *
 * Reads observations, digests and insights from the km-core exports under
 * `.data/observation-export/`, and KG entities from `.data/knowledge-graph/exports/`,
 * embeds via fastembed (all-MiniLM-L6-v2, 384-dim), and upserts to 4 Qdrant collections.
 *
 * SOURCE OF TRUTH. This read SQLite (`.observations/observations.db`) and the
 * knowledge-graph LevelDB directly. The km-core cutover (Plan 44-18) retired both: the
 * SQLite file survives with NO observations/digests/insights tables, and the LevelDB is
 * single-owner (obs-api holds it) under a different key. Every loader therefore returned
 * zero rows and this script was a silent no-op. It now reads the exports obs-api writes
 * from the live km-core store.
 *
 * IDEMPOTENCY is over (content_hash, preview_version), not content_hash alone. A change
 * to SUMMARY_PREVIEW_CHARS leaves content untouched, so a hash-only check would skip
 * every point and the new preview length would never reach the index.
 *
 * Usage:
 *   npx tsx src/embedding/backfill.ts [--dry-run] [--batch-size N] [--tier observations|digests|insights|kg_entities] [--prune]
 *
 * `--prune` deletes points whose id is absent from the source AFTER upserting, so ids
 * that drifted from a previous indexing scheme do not survive as duplicates. Upsert-then-
 * prune deliberately avoids dropping the collection: retrieval degrades to a few
 * duplicates for the length of the run rather than going empty.
 */

import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { getEmbeddingService } from "./embedding-service.js";
import { contentHash } from "./content-hash.js";
import { makePreview, previewVersion, SUMMARY_PREVIEW_CHARS } from "./preview.js";
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
  prune: boolean;
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
    prune: false,
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
    } else if (args[i] === "--prune") {
      options.prune = true;
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

/**
 * Load one exported tier from `.data/observation-export/`.
 *
 * SOURCE OF TRUTH CHANGED. These loaders read SQLite at `.observations/observations.db`
 * until the km-core cutover (Plan 44-18) retired it. That file still exists but contains
 * NO observations/digests/insights tables, so every loader here silently returned zero
 * rows and this script had become a no-op — a failure with no error message, which is
 * why it went unnoticed. obs-api exports the live km-core store to these JSON files
 * (see ObservationExporter), so they are now the source.
 *
 * @param name export basename (observations | digests | insights)
 * @returns parsed rows, or [] when the export is absent/unreadable
 */
function readExport(name: string): Array<Record<string, unknown>> {
  const file = join(projectRoot, ".data/observation-export", `${name}.json`);
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as unknown;
    if (Array.isArray(raw)) return raw as Array<Record<string, unknown>>;
    const rows = (raw as Record<string, unknown>)[name];
    return Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : [];
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[Backfill] Could not read ${file}: ${msg}\n`);
    return [];
  }
}

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

function readObservations(): BackfillItem[] {
  return readExport("observations")
    .filter((r) => str(r.summary))
    .map((r) => ({
      id: String(r.id),
      text: String(r.summary),
      payload: {
        agent: str(r.agent),
        project: str(r.project) ?? "coding",
        date: (str(r.createdAt) ?? "").split("T")[0] || null,
        quality: str(r.quality) ?? "normal",
        summary_preview: makePreview(String(r.summary)),
        preview_version: previewVersion(),
      },
    }));
}

function readDigests(): BackfillItem[] {
  return readExport("digests")
    .filter((r) => str(r.summary))
    .map((r) => ({
      id: String(r.id),
      text: String(r.summary),
      payload: {
        date: (str(r.createdAt) ?? "").split("T")[0] ?? str(r.date),
        theme: str(r.theme),
        // The export carries an array; the retrieval formatter prints it verbatim.
        agents: Array.isArray(r.agents) ? JSON.stringify(r.agents) : str(r.agents),
        quality: str(r.quality) ?? "normal",
        project: str(r.project) ?? "coding",
        summary_preview: makePreview(String(r.summary)),
        preview_version: previewVersion(),
      },
    }));
}

function readInsights(): BackfillItem[] {
  return readExport("insights")
    .filter((r) => str(r.summary))
    .map((r) => ({
      id: String(r.id),
      text: String(r.summary),
      payload: {
        topic: str(r.topic),
        confidence: typeof r.confidence === "number" ? r.confidence : null,
        digestIds: Array.isArray(r.digestIds) ? JSON.stringify(r.digestIds) : str(r.digestIds),
        project: str(r.project) ?? "coding",
        summary_preview: makePreview(String(r.summary)),
        preview_version: previewVersion(),
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

/**
 * Load knowledge-graph entities from the exported Graphology graph.
 *
 * TWO cutover breakages fixed here. (1) This opened the LevelDB at
 * `.data/knowledge-graph` directly — but km-core is SINGLE-OWNER (obs-api holds it), so a
 * second opener either fails or corrupts; and it read the key `graph`, while km-core
 * persists under `graph:state`. (2) It required `attributes.observations.length >= 2`,
 * and km-core nodes carry no `observations` array at all — they carry `description`. All
 * 1949 nodes were therefore skipped. Reading the export avoids the ownership problem and
 * the key name, and `description` is the text that actually exists (median 916 chars).
 *
 * `observations` is still honoured when present so a pre-cutover export still indexes.
 */
function readKgEntities(): BackfillItem[] {
  const file = join(projectRoot, ".data/knowledge-graph/exports/general.json");
  let graph: SerializedGraph;
  try {
    graph = JSON.parse(readFileSync(file, "utf8")) as SerializedGraph;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[Backfill] Could not read ${file}: ${msg}\n`);
    return [];
  }

  const items: BackfillItem[] = [];
  for (const node of graph.nodes ?? []) {
    const attrs = node.attributes ?? {};
    if (attrs.isScaffoldNode) continue;

    const name = attrs.name ?? node.key;
    const observations = attrs.observations ?? [];
    const description = typeof attrs.description === "string" ? attrs.description : "";
    // Prefer the km-core `description`; fall back to a legacy observations array.
    const bodyText = description || observations.join("\n");
    // Nothing to embed beyond a bare name is not worth a vector.
    if (!bodyText.trim()) continue;

    const text = name + "\n" + bodyText;
    items.push({
      id: keyToUuid(node.key),
      text,
      payload: {
        entityType: attrs.entityType ?? attrs.type ?? "Unknown",
        hierarchyLevel: attrs.hierarchyLevel ?? null,
        parentId: attrs.parentEntityName ?? null,
        project: "coding",
        summary_preview: makePreview(text),
        preview_version: previewVersion(),
      },
    });
  }
  return items;
}

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

    // Idempotency over (content_hash, preview_version) — NOT content_hash alone.
    // Raising SUMMARY_PREVIEW_CHARS changes no content, so a hash-only check reports
    // every point as current and the longer preview never reaches the index. Points
    // written before the stamp existed carry no preview_version and so never match,
    // which is exactly right: they predate the policy and must be rebuilt once.
    // SCOPED TO THE ITEM'S OWN ID. Matching content_hash anywhere in the collection is
    // wrong and silently loses data: the live listener indexes items under its own ids,
    // so a "this content already exists" hit would skip the upsert at the SOURCE id, and
    // --prune would then delete the listener's differently-keyed copy because that id is
    // absent from the source — leaving the item in neither place. That cost 83 items on
    // the first run (85 "skipped", 83 missing afterwards).
    //
    // Retrieving the whole batch by id in one request also replaces one HTTP round trip
    // PER ITEM with one per batch (14k calls -> ~220).
    const toEmbed: Array<BackfillItem & { hash: string }> = [];
    let current = new Map<string, Record<string, unknown>>();
    try {
      const found = await qdrant.retrieve(collectionName, {
        ids: batch.map((item) => item.id),
        with_payload: true,
        with_vector: false,
      });
      current = new Map(found.map((p) => [String(p.id), (p.payload ?? {}) as Record<string, unknown>]));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // Fail toward re-embedding: an unreadable index must never be read as "current".
      process.stderr.write(
        `[Backfill] Warning: id lookup failed for a ${collectionName} batch: ${msg}\n`
      );
    }

    for (let j = 0; j < batch.length; j++) {
      const payload = current.get(String(batch[j].id));
      const isCurrent =
        payload !== undefined &&
        payload.content_hash === hashes[j] &&
        payload.preview_version === SUMMARY_PREVIEW_CHARS;
      if (isCurrent) {
        skipped++;
      } else {
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

/**
 * Delete points whose id is absent from the freshly-loaded source set.
 *
 * WHY THIS IS NEEDED, and why it runs AFTER the upsert. Point ids have drifted from the
 * source over time — matching the current insight export against the live collection
 * joined only 59% by content hash and 73% by topic — so upserting by source id adds new
 * points beside the stale ones rather than replacing them, and retrieval would then see
 * both copies of the same knowledge. Pruning by id afterwards removes the leftovers.
 *
 * Upsert-then-prune, never drop-then-rebuild: the collection is live (every agent prompt
 * queries it), so the failure mode to avoid is an empty index. This ordering degrades
 * retrieval to a few duplicates for the length of the run instead.
 *
 * @returns number of points deleted (0 on dry run)
 */
async function pruneOrphans(
  collectionName: string,
  items: BackfillItem[],
  options: BackfillOptions
): Promise<number> {
  const qdrant = getQdrantClient();
  const keep = new Set(items.map((i) => String(i.id)));

  // Refuse to prune against an empty source: that would empty the collection, and an
  // empty source almost always means a missing/unreadable export, not a real deletion.
  if (keep.size === 0) {
    process.stderr.write(
      `[Backfill] ${collectionName}: refusing to prune — source set is empty\n`
    );
    return 0;
  }

  const orphans: string[] = [];
  let offset: unknown = undefined;
  for (;;) {
    const page = await qdrant.scroll(collectionName, {
      limit: 1000,
      with_payload: false,
      with_vector: false,
      ...(offset === undefined ? {} : { offset: offset as never }),
    });
    for (const p of page.points) {
      if (!keep.has(String(p.id))) orphans.push(String(p.id));
    }
    offset = page.next_page_offset;
    if (offset === null || offset === undefined) break;
  }

  if (orphans.length === 0 || options.dryRun) return options.dryRun ? 0 : 0;

  // Delete in chunks — a single request carrying tens of thousands of ids can exceed
  // Qdrant's payload limits.
  for (let i = 0; i < orphans.length; i += 1000) {
    await qdrant.delete(collectionName, { points: orphans.slice(i, i + 1000), wait: true });
  }
  return orphans.length;
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

  const tiers: Array<{ name: string; collection: string; loader: () => Promise<BackfillItem[]> | BackfillItem[] }> = [
    { name: "Observations", collection: "observations", loader: () => readObservations() },
    { name: "Digests", collection: "digests", loader: () => readDigests() },
    { name: "Insights", collection: "insights", loader: () => readInsights() },
    { name: "KG Entities", collection: "kg_entities", loader: () => readKgEntities() },
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

      if (options.prune) {
        const removed = await pruneOrphans(tier.collection, items, options);
        process.stderr.write(
          `[Backfill] ${tier.name}: pruned ${removed} point(s) absent from the source\n`
        );
      }
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
    // Nothing to close: every source is now a JSON export read with readFileSync.
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
