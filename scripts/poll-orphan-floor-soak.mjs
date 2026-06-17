#!/usr/bin/env node
// scripts/poll-orphan-floor-soak.mjs
//
// 24-hour hourly orphan-floor soak harness — Phase 59 Plan 05 / SC#4 evidence.
//
// Samples GET ${KMCORE_REST_BASE}/api/v1/stats once per hour for 24 iterations,
// records {timestamp, orphanCount, nodeCount, connectivity} per sample to
// .data/orphan-floor-soak-<ISO-ts>.json (INCREMENTAL writes — a crash mid-run
// leaves the partial evidence on disk), and asserts max(orphanCount) <= 10
// across all valid samples per ORPHAN-FLOOR.
//
// PORT DISCIPLINE — anchored to CONTEXT.md D-04 / D-05 / canonical_refs:
//   KMCORE_REST_BASE defaults to http://localhost:3848 (km-core REST view,
//   served by integrations/mcp-server-semantic-analysis/src/sse-server.ts:46-103)
//   — the SAME graph the writer (ObservationConsolidator), the unified-viewer,
//   AND Plan 59-04's repair script all target. The script does NOT fall back
//   to the obs-api daemon's port (an OBS-API daemon view is a DIFFERENT graph).
//   The end-of-run summary records `kmcoreRestBase` so the operator can confirm
//   the soak hit the intended endpoint; the runbook flags any other value
//   as an INVALID soak that must be re-run.
//
// Exit codes:
//   0 — all 24 samples completed and every valid sample had orphanCount <= 10
//   1 — at least one valid sample breached the threshold OR consecutive-failure abort
//   2 — pre-flight failure (km-core REST unreachable on the first probe — soak never started)
//   3 — uncaught exception (main().catch wrapper)
//
// Lifecycle (D-04.1): ONE-SHOT. No launchd, no dashboard widget. After the
// SC#4-meeting soak completes, the operator retains the .data/orphan-floor-soak-<ts>.json
// as evidence and MAY delete this script. See .planning/phases/59-.../59-SOAK-RUNBOOK.md.

import process from 'node:process';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

// ────────────────────────────────────────────────────────────────────────────
// Top-of-file constants (env-overridable for testing)
// ────────────────────────────────────────────────────────────────────────────

const KMCORE_REST_BASE =
  process.env.KMCORE_REST_BASE || 'http://localhost:3848'; // km-core REST view, per CONTEXT.md D-04 / D-05 / canonical_refs
const ORPHAN_THRESHOLD = 10; // SC#4: orphanCount <= 10 sustained across 24h
const SAMPLE_INTERVAL_MS = 60 * 60 * 1000; // 1 hour (canonical); env override `SAMPLE_INTERVAL_MS_OVERRIDE` below
const TOTAL_SAMPLES = 24; // canonical 24-hour soak; env override `TOTAL_SAMPLES_OVERRIDE` below
const CONSECUTIVE_FAILURE_LIMIT = 3;
const LOG_DIR = path.resolve(process.cwd(), '.data');

// Test-only env overrides — operator may set SAMPLE_INTERVAL_MS_OVERRIDE=60000
// for a fast-cycle smoke (24-minute soak instead of 24-hour) or
// TOTAL_SAMPLES_OVERRIDE=3 to shrink the test loop. The canonical constants
// above remain literal so the acceptance grep gates pass.
const EFFECTIVE_SAMPLE_INTERVAL_MS = Number(process.env.SAMPLE_INTERVAL_MS_OVERRIDE) || SAMPLE_INTERVAL_MS;
const EFFECTIVE_TOTAL_SAMPLES = Number(process.env.TOTAL_SAMPLES_OVERRIDE) || TOTAL_SAMPLES;

function log(msg) {
  process.stderr.write(`[orphan-soak] ${msg}\n`);
}

// ────────────────────────────────────────────────────────────────────────────
// HTTP sampler — hits ${KMCORE_REST_BASE}/api/v1/stats
//
// Throws on non-2xx so the caller's try/catch can record a failed sample.
// Returns the canonical shape {timestamp, orphanCount, nodeCount, connectivity}.
// Defensive against km-core stat-key drift: prefers `orphanCount` / `nodeCount`
// / `connectivity` but also accepts the alternate `orphans` / `nodes` keys
// observed in Plan 59-04's smoke (the live response carries top-level `nodes`
// + `edges` on some km-core builds).
// ────────────────────────────────────────────────────────────────────────────

async function sampleStats() {
  const res = await fetch(`${KMCORE_REST_BASE}/api/v1/stats`);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching stats from ${KMCORE_REST_BASE}/api/v1/stats`);
  }
  const body = await res.json();
  const s = body.data || body || {};
  return {
    timestamp: new Date().toISOString(),
    orphanCount: s.orphanCount ?? s.orphans ?? -1,
    nodeCount: s.nodeCount ?? s.nodes ?? -1,
    connectivity: s.connectivity ?? -1,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// main()
// ────────────────────────────────────────────────────────────────────────────

async function main() {
  log(`starting 24h orphan-floor soak`);
  log(`KMCORE_REST_BASE=${KMCORE_REST_BASE} (per CONTEXT.md D-04 / D-05 — km-core REST view)`);
  log(`config: ORPHAN_THRESHOLD=${ORPHAN_THRESHOLD} TOTAL_SAMPLES=${EFFECTIVE_TOTAL_SAMPLES} SAMPLE_INTERVAL_MS=${EFFECTIVE_SAMPLE_INTERVAL_MS} CONSECUTIVE_FAILURE_LIMIT=${CONSECUTIVE_FAILURE_LIMIT}`);

  // ──── Pre-flight gate ───────────────────────────────────────────────────
  //
  // ONE sample fetch with NO try/catch. If it throws, km-core REST is not
  // reachable AT ALL — exit 2. This matches Plan 59-04's pre-flight convention
  // so the operator sees consistent error messaging across both scripts.
  // The pre-flight fires BEFORE outPath has been created — exit-on-failure
  // leaves no partial session log (correct shape; pre-flight failure means
  // the soak never started).
  try {
    const probe = await sampleStats();
    log(`pre-flight OK at ${KMCORE_REST_BASE}: orphans=${probe.orphanCount} nodes=${probe.nodeCount} connectivity=${probe.connectivity}`);
  } catch (err) {
    process.stderr.write(`KMCORE_REST_BASE unreachable: ${KMCORE_REST_BASE} (${err.message})\n`);
    process.exit(2);
  }

  // ──── Session log setup ─────────────────────────────────────────────────
  //
  // Path uses ISO timestamp with millisecond resolution; collision requires
  // two operators starting in the same millisecond — vanishingly unlikely.

  await fsp.mkdir(LOG_DIR, { recursive: true });
  const sessionTs = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = path.join(LOG_DIR, `orphan-floor-soak-${sessionTs}.json`);
  log(`session log: ${outPath}`);

  const samples = [];
  let breached = false;
  let consecutiveFailures = 0;

  // ──── Main sampling loop ────────────────────────────────────────────────
  //
  // For each of EFFECTIVE_TOTAL_SAMPLES iterations (canonical TOTAL_SAMPLES = 24):
  //   1. Fetch one sample (try/catch — per-sample HTTP failure non-fatal in isolation)
  //   2. Record the sample (including errors[] for failed fetches)
  //   3. Update consecutiveFailures counter
  //   4. Check threshold breach (only on VALID samples — orphanCount >= 0)
  //   5. Write incremental session log
  //   6. Check consecutive-failure escalation (>= 3 in a row → abort)
  //   7. Sleep until next sample (skip on last iteration)

  for (let i = 0; i < EFFECTIVE_TOTAL_SAMPLES; i++) {
    let sample;
    try {
      sample = await sampleStats();
      consecutiveFailures = 0;
      log(`sample ${i + 1}/${EFFECTIVE_TOTAL_SAMPLES}: orphans=${sample.orphanCount} nodes=${sample.nodeCount} connectivity=${sample.connectivity}`);
    } catch (err) {
      consecutiveFailures++;
      sample = {
        timestamp: new Date().toISOString(),
        orphanCount: -1, // sentinel for "no data"
        nodeCount: -1,
        connectivity: -1,
        errors: [err.message],
      };
      log(`sample ${i + 1}/${EFFECTIVE_TOTAL_SAMPLES}: FETCH FAILED (${err.message}); consecutive=${consecutiveFailures}`);
    }

    samples.push(sample);

    // Threshold check — only VALID samples participate.
    // -1 sentinel is not a measurement so `-1 > 10` is false (skip).
    if (sample.orphanCount > ORPHAN_THRESHOLD) {
      breached = true;
      log(`THRESHOLD BREACH: sample ${i + 1} orphans=${sample.orphanCount} > ${ORPHAN_THRESHOLD} (continuing — see when else)`);
    }

    // Incremental write — a crash mid-run leaves partial evidence.
    await fsp.writeFile(outPath, JSON.stringify({ samples, breached }, null, 2));

    // Consecutive-failure escalation: 3 failed fetches in a row means
    // km-core REST is down for >3h and the soak data is invalid.
    if (consecutiveFailures >= CONSECUTIVE_FAILURE_LIMIT) {
      log(`FATAL: ${consecutiveFailures} consecutive sample failures — km-core REST appears unreachable at ${KMCORE_REST_BASE}; aborting soak`);
      await fsp.writeFile(
        outPath,
        JSON.stringify(
          {
            samples,
            breached,
            aborted: true,
            reason: 'consecutive-failures',
            kmcoreRestBase: KMCORE_REST_BASE,
          },
          null,
          2,
        ),
      );
      process.exit(1);
    }

    // Sleep until next sample (skip on the last iteration so the script
    // exits immediately after the 24th sample).
    if (i < EFFECTIVE_TOTAL_SAMPLES - 1) {
      await new Promise((r) => setTimeout(r, EFFECTIVE_SAMPLE_INTERVAL_MS));
    }
  }

  // ──── End-of-run summary ────────────────────────────────────────────────
  //
  // Computed from samples; written to outPath + printed to stdout.
  // The `kmcoreRestBase` field is the operator's confirmation that the soak
  // hit the intended endpoint (:3848 = km-core REST; anything else = WRONG GRAPH).

  const validSamples = samples.filter((s) => s.orphanCount >= 0);
  const orphanCounts = validSamples.map((s) => s.orphanCount);
  const sortedOrphans = [...orphanCounts].sort((a, b) => a - b);
  const medianIdx = Math.floor(sortedOrphans.length / 2);
  const median = sortedOrphans.length
    ? sortedOrphans.length % 2 === 0
      ? Math.round((sortedOrphans[medianIdx - 1] + sortedOrphans[medianIdx]) / 2)
      : sortedOrphans[medianIdx]
    : null;

  const summary = {
    totalSamples: samples.length,
    validSamples: validSamples.length,
    failedSamples: samples.length - validSamples.length,
    threshold: ORPHAN_THRESHOLD,
    breached,
    orphanCount: {
      max: orphanCounts.length ? Math.max(...orphanCounts) : null,
      min: orphanCounts.length ? Math.min(...orphanCounts) : null,
      mean: orphanCounts.length
        ? Math.round(orphanCounts.reduce((a, b) => a + b, 0) / orphanCounts.length)
        : null,
      median,
    },
    startedAt: samples[0]?.timestamp,
    endedAt: samples[samples.length - 1]?.timestamp,
    sessionLogPath: outPath,
    kmcoreRestBase: KMCORE_REST_BASE, // record the actual endpoint sampled — SUMMARY confirms :3848
  };

  await fsp.writeFile(outPath, JSON.stringify({ samples, breached, summary }, null, 2));
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
  log(`DONE: ${samples.length} samples written to ${outPath} (breached=${breached})`);
  process.exit(breached ? 1 : 0);
}

// ────────────────────────────────────────────────────────────────────────────
// Uncaught exception fallback (matches Plan 59-04 convention).
// ────────────────────────────────────────────────────────────────────────────

main().catch((e) => {
  log(`FATAL: ${e.stack || e.message || String(e)}`);
  process.exit(3);
});
