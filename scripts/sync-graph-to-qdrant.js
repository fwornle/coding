#!/usr/bin/env node
/**
 * sync-graph-to-qdrant.js
 *
 * Synchronizes existing graph database entities to Qdrant vector collections by
 * routing through km-core's canonical `syncQdrantFromStore` maintenance op
 * (Phase 42-04 D-52a). Reads all entities with non-empty embeddings from the
 * km-core `GraphKMStore` and upserts them into the configured Qdrant
 * collection.
 *
 * Post-42.2-Plan-05 only — assumes `.data/knowledge-graph/` is the km-core
 * canonical store (Wave 2 Plan 05 dir-swap consolidated the legacy
 * GraphDatabaseService store and the migrated km-core store into this
 * single path).
 *
 * Per CLAUDE.md "km-core scripts" mandate: GraphKMStore is constructed with
 * `ontologyDir` so default-class resolution does not blow up on
 * `opts.classes omitted but store has no ontology registry` (Phase 41 lesson,
 * commits 87bc2f567 / fd35c5350).
 *
 * Usage:
 *   node scripts/sync-graph-to-qdrant.js [options]
 *
 * Options:
 *   --collection <name>     Qdrant collection name (default: knowledge_patterns_small)
 *   --batch-size <n>        Number of entities to upsert per batch (default: 100)
 *   --dry-run               Show what would be synced without writing
 *   --db-path <path>        km-core LevelDB dataDir (default: .data/knowledge-graph)
 *   --export-dir <path>     km-core JSON export dir (default: .data/knowledge-graph/exports)
 *   --ontology-dir <path>   Ontology dir (default: .data/ontologies)
 *   --teams <team1,team2>   DEPRECATED — km-core is team-agnostic; ignored. Kept
 *                           for operator CLI signature compatibility.
 *
 * Env:
 *   QDRANT_HOST             Qdrant host (default: localhost)
 *   QDRANT_PORT             Qdrant port (default: 6333)
 *   QDRANT_URL              Full URL override (default: http://${QDRANT_HOST}:${QDRANT_PORT})
 *   COLLECTION_NAME         Default collection name (overridden by --collection)
 *
 * Examples:
 *   node scripts/sync-graph-to-qdrant.js
 *   node scripts/sync-graph-to-qdrant.js --collection knowledge_patterns_small
 *   node scripts/sync-graph-to-qdrant.js --batch-size 50 --dry-run
 */

import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import { existsSync } from 'fs';
import { QdrantClient } from '@qdrant/js-client-rest';
import { GraphKMStore } from '@fwornle/km-core';
import { syncQdrantFromStore } from '@fwornle/km-core/maintenance';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// CLI flag parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const options = {
    collection: process.env.COLLECTION_NAME || 'knowledge_patterns_small',
    batchSize: 100,
    dryRun: false,
    dbPath: join(projectRoot, '.data/knowledge-graph'),
    exportDir: join(projectRoot, '.data/knowledge-graph/exports'),
    ontologyDir: join(projectRoot, '.data/ontologies'),
    teams: null, // deprecated; honored as no-op
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--collection' && argv[i + 1]) {
      options.collection = argv[++i];
    } else if (a === '--batch-size' && argv[i + 1]) {
      const n = parseInt(argv[++i], 10);
      if (Number.isFinite(n) && n > 0) options.batchSize = n;
    } else if (a === '--dry-run') {
      options.dryRun = true;
    } else if (a === '--db-path' && argv[i + 1]) {
      options.dbPath = resolve(argv[++i]);
    } else if (a === '--export-dir' && argv[i + 1]) {
      options.exportDir = resolve(argv[++i]);
    } else if (a === '--ontology-dir' && argv[i + 1]) {
      options.ontologyDir = resolve(argv[++i]);
    } else if (a === '--teams' && argv[i + 1]) {
      // Honored as no-op — km-core is team-agnostic; full-store sync.
      options.teams = argv[++i].split(',').map((t) => t.trim());
    }
  }
  return options;
}

// ---------------------------------------------------------------------------
// Qdrant client wrapper — matches the structural QdrantClient interface
// from syncQdrantFromStore.ts. The real @qdrant/js-client-rest exposes
// `upsert(collection, { points })` (object-form), so the wrapper adapts
// to the km-core (collection, points) shape.
// ---------------------------------------------------------------------------

function wrapQdrantClient(realClient) {
  return {
    upsert: async (collection, points) => {
      await realClient.upsert(collection, { wait: true, points });
    },
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const options = parseArgs(process.argv.slice(2));

  process.stderr.write('═══════════════════════════════════════════════════════════════════\n');
  process.stderr.write('  Graph Database -> Qdrant Synchronization (via km-core syncQdrantFromStore)\n');
  process.stderr.write('═══════════════════════════════════════════════════════════════════\n');
  process.stderr.write(`  collection:  ${options.collection}\n`);
  process.stderr.write(`  batchSize:   ${options.batchSize}\n`);
  process.stderr.write(`  dryRun:      ${options.dryRun ? 'yes' : 'no'}\n`);
  process.stderr.write(`  dbPath:      ${options.dbPath}\n`);
  process.stderr.write(`  exportDir:   ${options.exportDir}\n`);
  process.stderr.write(`  ontologyDir: ${options.ontologyDir}\n`);
  if (options.teams) {
    process.stderr.write(`  teams:       ${options.teams.join(', ')} (DEPRECATED — ignored; km-core is team-agnostic)\n`);
  }
  process.stderr.write('\n');

  // Sanity-check the km-core dataDir before opening (fail-loud).
  if (!existsSync(options.dbPath)) {
    process.stderr.write(`[sync] ERR: km-core dataDir not found: ${options.dbPath}\n`);
    process.stderr.write(`[sync] HINT: this script assumes the Phase 42.2 Plan 05 dir-swap is complete.\n`);
    process.exit(2);
  }

  // Construct Qdrant client.
  const qdrantHost = process.env.QDRANT_HOST || 'localhost';
  const qdrantPort = process.env.QDRANT_PORT || '6333';
  const qdrantUrl = process.env.QDRANT_URL || `http://${qdrantHost}:${qdrantPort}`;
  process.stderr.write(`[sync] Qdrant URL: ${qdrantUrl}\n`);

  const realQdrant = new QdrantClient({
    url: qdrantUrl,
    checkCompatibility: false,
  });

  // Verify Qdrant connectivity before opening the LevelDB store.
  try {
    await realQdrant.getCollections();
    process.stderr.write('[sync] Qdrant connectivity OK\n');
  } catch (err) {
    process.stderr.write(`[sync] ERR: Qdrant unreachable at ${qdrantUrl}: ${err.message}\n`);
    process.exit(3);
  }

  const qdrantClient = wrapQdrantClient(realQdrant);

  // Construct km-core GraphKMStore. ontologyDir is MANDATORY per CLAUDE.md
  // "km-core scripts" — without it default-class resolution throws
  // `opts.classes omitted but store has no ontology registry`.
  const store = new GraphKMStore({
    dbPath: options.dbPath,
    exportDir: options.exportDir,
    ontologyDir: options.ontologyDir,
    ontologyStrict: false,
    debounceMs: 0,
    domains: ['coding'],
  });

  let exitCode = 0;
  try {
    await store.open();
    process.stderr.write('[sync] km-core GraphKMStore opened\n');

    if (options.dryRun) {
      // Count entities with non-empty embeddings without calling Qdrant.
      let total = 0;
      let withEmbedding = 0;
      for await (const entity of store.iterate()) {
        total += 1;
        if (Array.isArray(entity.embedding) && entity.embedding.length > 0) {
          withEmbedding += 1;
        }
      }
      process.stderr.write('\n[sync] DRY RUN — no Qdrant writes\n');
      process.stderr.write(`[sync]   total entities:       ${total}\n`);
      process.stderr.write(`[sync]   with embedding:       ${withEmbedding}\n`);
      process.stderr.write(`[sync]   would skip (no emb):  ${total - withEmbedding}\n`);
      process.stderr.write(`[sync]   estimated batches:    ${Math.ceil(withEmbedding / options.batchSize)}\n`);
      return;
    }

    // Invoke km-core's canonical maintenance op. Per D-52a this is the
    // single source of truth for Qdrant index rebuild semantics.
    const result = await syncQdrantFromStore(store, {
      qdrantClient,
      collection: options.collection,
      batchSize: options.batchSize,
      log: (event) => {
        if (event.phase === 'batch') {
          process.stderr.write(
            `[sync]   batch upsert: count=${event.count} cumulative=${event.cumulative}\n`,
          );
        } else if (event.phase === 'error') {
          process.stderr.write(
            `[sync]   ERR batch failed (count=${event.count}): ${event.message}\n`,
          );
        }
      },
    });

    process.stderr.write('\n═══════════════════════════════════════════════════════════════════\n');
    process.stderr.write('  Synchronization Results\n');
    process.stderr.write('═══════════════════════════════════════════════════════════════════\n');
    process.stderr.write(`  synced:   ${result.syncedCount}\n`);
    process.stderr.write(`  skipped:  ${result.skippedCount} (no embedding)\n`);
    process.stderr.write(`  errors:   ${result.errors.length}\n`);

    if (result.errors.length > 0) {
      process.stderr.write('\n[sync] Per-entity errors (truncated to first 10):\n');
      for (const err of result.errors.slice(0, 10)) {
        process.stderr.write(`  - entity ${err.entityId}: ${err.message}\n`);
      }
      // Non-zero exit when errors observed — operator gate signal.
      exitCode = 1;
    }
  } catch (err) {
    process.stderr.write(`\n[sync] FATAL: ${err.message}\n`);
    if (err.stack) process.stderr.write(`${err.stack}\n`);
    exitCode = 1;
  } finally {
    try {
      await store.close();
      process.stderr.write('[sync] km-core GraphKMStore closed\n');
    } catch (closeErr) {
      process.stderr.write(`[sync] close error: ${closeErr.message}\n`);
    }
  }

  process.exit(exitCode);
}

main().catch((err) => {
  process.stderr.write(`[sync] FATAL: ${err.stack || err.message}\n`);
  process.exit(1);
});
