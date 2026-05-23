#!/usr/bin/env node
/**
 * Reproject A's online observations/digests/insights into a fresh
 * km-core GraphKMStore, optionally chaining `resolveEntities` to surface
 * (or apply) cross-batch duplicate merges.
 *
 * This is the user-visible Phase 41 (INT-01 + PIPE-02) deliverable. An
 * operator can:
 *   1. `--dry-run` reproject (no writes) to confirm A's JSON exports
 *      parse and Plan 02 mappers shape entities correctly.
 *   2. `--resolve-dry-run` to reproject for real into a tmpdir store AND
 *      see what duplicates `resolveEntities` would merge — without
 *      mutating anything outside `/tmp/km-core-reproject-<runId>/`.
 *   3. `--resolve` to reproject AND apply merges.
 *
 * A's data is read-only throughout. The script writes ONLY to the
 * tmpdir-scoped GraphKMStore at `KM_GRAPH_DIR` (default
 * `/tmp/km-core-reproject-<runId>`); `.data/observation-export/` is
 * never modified (SC#2 met by construction — `reprojectFromOnlineStore`
 * supports only the `jsonExports` source path; SQLite is rejected).
 *
 * Usage:
 *   node scripts/reproject-online.mjs                  # full reproject, no resolve
 *   node scripts/reproject-online.mjs --dry-run        # plan only, no writes (reproject dry-run)
 *   node scripts/reproject-online.mjs --resolve        # reproject + chain resolveEntities (writes)
 *   node scripts/reproject-online.mjs --resolve-dry-run # reproject (writes) + resolveEntities (dry-run only)
 *
 * Env:
 *   OBSERVATION_EXPORT_DIR  default ./.data/observation-export
 *   KM_GRAPH_DIR            default /tmp/km-core-reproject-<runId>
 *   KM_ONTOLOGY_DIR         default <km-core-pkg-root>/ontology (auto-resolved
 *                           via import.meta.resolve('@fwornle/km-core'))
 *   LLM_PROXY_URL           default http://localhost:12435/api/complete
 *                           (rapid-llm-proxy native endpoint — returns
 *                           { content, provider, model, tokens, latencyMs }
 *                           directly; NOT OpenAI /v1/chat/completions shape)
 *
 * Output:
 *   - process.stdout: the JSON result object
 *     ({ reprojectResult, resolveResult? }) — pretty-printed.
 *   - process.stderr: diagnostic / progress events with the
 *     `[reproject-online]` prefix.
 *
 * Exit code: 0 on success, 1 on any thrown error (the error is JSON-
 * written to stderr).
 */

import path from 'node:path';
import process from 'node:process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  GraphKMStore,
  reprojectFromOnlineStore,
  resolveEntities,
  LLMSemanticMatcher,
} from '@fwornle/km-core';

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run');
const RESOLVE = args.has('--resolve');
const RESOLVE_DRY_RUN = args.has('--resolve-dry-run');

// Mutually-exclusive flag validation — the operator must choose one
// of the four explicit modes (default, --dry-run, --resolve,
// --resolve-dry-run). Combining --dry-run with --resolve makes no
// sense: a dry-run reproject produces NO entities for resolve to scan.
// Suggest --resolve-dry-run instead.
if (DRY_RUN && (RESOLVE || RESOLVE_DRY_RUN)) {
  process.stderr.write(
    '[reproject-online] ERROR: --dry-run is mutually exclusive with --resolve and --resolve-dry-run.\n' +
      '  Use --resolve-dry-run to reproject for real then see resolveEntities planned merges.\n' +
      '  Usage:\n' +
      '    node scripts/reproject-online.mjs                  # full reproject, no resolve\n' +
      '    node scripts/reproject-online.mjs --dry-run        # plan only, no writes (reproject dry-run)\n' +
      '    node scripts/reproject-online.mjs --resolve        # reproject + chain resolveEntities (writes)\n' +
      '    node scripts/reproject-online.mjs --resolve-dry-run # reproject (writes) + resolveEntities (dry-run only)\n',
  );
  process.exit(1);
}

const runId = randomUUID();
const obsExportDir =
  process.env.OBSERVATION_EXPORT_DIR ||
  path.resolve(process.cwd(), '.data/observation-export');
const kmGraphDir =
  process.env.KM_GRAPH_DIR ||
  path.join('/tmp', 'km-core-reproject-' + runId);
const llmProxyUrl =
  process.env.LLM_PROXY_URL || 'http://localhost:12435/api/complete';

// Resolve the km-core ontology dir so resolveEntities can expand the
// default `LearningArtifact` class to its lower subclasses (Plan 41-01).
// The integration test sets this explicitly; the CLI auto-resolves it
// from the @fwornle/km-core main entry (works whether the package is
// symlinked, npm-linked, or installed). The package's `exports` map
// only declares the `import` condition (no `require`, no
// `./package.json`), so we must use ESM resolution — `import.meta
// .resolve` returns the entry's file:// URL; we walk up two levels
// from `<root>/dist/index.js` to the package root. Override via
// KM_ONTOLOGY_DIR.
const kmCoreMainPath = fileURLToPath(import.meta.resolve('@fwornle/km-core'));
const kmCoreRoot = path.dirname(path.dirname(kmCoreMainPath));
const ontologyDir =
  process.env.KM_ONTOLOGY_DIR || path.join(kmCoreRoot, 'ontology');

const REQUEST_TIMEOUT_MS = 60_000;

const provenance = {
  provider: 'reproject-online',
  model: 'phase-41',
  runId,
  timestamp: new Date().toISOString(),
};

/**
 * Build an LLMClient (LLMSemanticMatcher dependency) that posts to the
 * local rapid-llm-proxy `/api/complete` endpoint and unwraps its native
 * response shape (`{ content, provider, model, tokens, latencyMs }`) to
 * the `{ content }` contract from @fwornle/km-core/dedup.
 *
 * The proxy is NOT OpenAI-compatible — it accepts `{ process, messages,
 * taskType? }` and returns `{ content }` directly. Passing `taskType`
 * routes dedup calls to a cheaper model (claude-haiku rather than
 * sonnet). The analog is `scripts/backfill-raw-observations.mjs`
 * (line 95: `callProxy` POSTs to `${PROXY_URL}/api/complete`).
 */
function makeProxyLLMClient(url) {
  return {
    async complete(req) {
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(),
        req.timeout || REQUEST_TIMEOUT_MS,
      );
      try {
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            process: 'reproject-online',
            messages: req.messages,
            ...(req.taskType ? { taskType: req.taskType } : {}),
            ...(req.responseFormat
              ? { responseFormat: req.responseFormat }
              : {}),
          }),
          signal: controller.signal,
        });
        if (!resp.ok) {
          const text = await resp.text().catch(() => '');
          throw new Error(
            `LLM proxy HTTP ${resp.status} ${resp.statusText}: ${text.slice(0, 300)}`,
          );
        }
        const body = await resp.json();
        const content = body?.content ?? '';
        return { content: typeof content === 'string' ? content : String(content) };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

async function main() {
  process.stderr.write(
    '[reproject-online] starting; runId=' +
      runId +
      ' mode=' +
      (DRY_RUN
        ? 'reproject-dry-run'
        : RESOLVE_DRY_RUN
          ? 'reproject+resolve-dry-run'
          : RESOLVE
            ? 'reproject+resolve'
            : 'reproject-only') +
      '\n',
  );
  process.stderr.write(
    '[reproject-online] obsExportDir=' +
      obsExportDir +
      ' kmGraphDir=' +
      kmGraphDir +
      '\n',
  );

  const store = new GraphKMStore({
    dbPath: path.join(kmGraphDir, 'leveldb'),
    exportDir: path.join(kmGraphDir, 'exports'),
    ontologyDir,
    debounceMs: 100,
  });
  await store.open();

  try {
    // ── Reproject A's JSON exports into the tmpdir store ────────────
    const reprojectResult = await reprojectFromOnlineStore(store, {
      sources: { jsonExports: obsExportDir },
      legacyProvenance: provenance,
      dryRun: DRY_RUN,
      checkpointPath: path.join(kmGraphDir, 'reproject-checkpoint.json'),
      onProgress: (e) =>
        process.stderr.write(
          '[reproject-online] ' + JSON.stringify(e) + '\n',
        ),
    });

    let resolveResult;
    if (RESOLVE || RESOLVE_DRY_RUN) {
      // Build the LLM-backed matcher; the matcher itself owns the
      // 5-stage JSON unwrap + threshold + onError-skip contract per
      // Phase 40 DEDUP-01.
      const llmClient = makeProxyLLMClient(llmProxyUrl);
      const llmMatcher = new LLMSemanticMatcher({ client: llmClient });
      resolveResult = await resolveEntities(store, {
        llmMatcher,
        provenance,
        dryRun: RESOLVE_DRY_RUN,
      });
    }

    const result = {
      reprojectResult,
      ...(resolveResult !== undefined ? { resolveResult } : {}),
    };
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } finally {
    await store.close();
    process.stderr.write(
      '[reproject-online] done; kmGraphDir=' + kmGraphDir + '\n',
    );
  }
}

main().catch((err) => {
  process.stderr.write(
    JSON.stringify(
      { error: err.message, stack: err.stack },
      null,
      2,
    ) + '\n',
  );
  process.exit(1);
});
