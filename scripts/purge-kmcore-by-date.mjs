// Purge km-core entities created on or after a cutoff date.
//
// Why this exists (not just `scripts/purge-knowledge-entities.js`):
//   That script targets the VKB server on :8080 via /api/entities/:name. The
//   unified viewer reads from obs-api/km-core on :12436 via /api/v1/entities.
//   The two surfaces front different views of the data — deletes via VKB do
//   not propagate to what /viewer/coding renders. This script targets km-core
//   directly so the unified viewer is what the user sees change.
//
// Use case (2026-06-11): the outer ring of orphans on /viewer/coding came from
//   yesterday's misguided wave-analysis runs (2026-06-04 had 238, -05 had 20,
//   -10 had 14, -11 had 3). Pre-cutover (pre-Phase-44) knowledge stays.
//
// Usage:
//   node scripts/purge-kmcore-by-date.mjs <YYYY-MM-DD> [--dry-run]
//
// Examples:
//   node scripts/purge-kmcore-by-date.mjs 2026-05-29 --dry-run
//   node scripts/purge-kmcore-by-date.mjs 2026-05-29

import process from 'node:process'

const OBS_API = process.env.OBS_API_BASE || 'http://localhost:12436'

function log(msg) { process.stderr.write(`[purge] ${msg}\n`) }

const cutoff = process.argv[2]
const dryRun = process.argv.includes('--dry-run')

if (!cutoff || !/^\d{4}-\d{2}-\d{2}$/.test(cutoff)) {
  log('usage: node scripts/purge-kmcore-by-date.mjs <YYYY-MM-DD> [--dry-run]')
  process.exit(2)
}

async function main() {
  log(`cutoff (inclusive): ${cutoff}    mode: ${dryRun ? 'DRY-RUN' : 'LIVE'}`)
  log(`fetching entities from ${OBS_API}/api/v1/entities`)
  const res = await fetch(`${OBS_API}/api/v1/entities?limit=10000`)
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching entities`)
  const body = await res.json()
  const ents = body.data || []
  log(`total entities: ${ents.length}`)

  // createdAt is the date the entity entered km-core. >= cutoff means
  // "created on cutoff day or later" — kills yesterday's wave garbage while
  // preserving anything from before May 29 (the pre-Phase-44 backfill).
  const cutoffIso = cutoff + 'T00:00:00.000Z'
  const targets = ents.filter((e) => {
    const ca = e.createdAt || (e.attributes && e.attributes.createdAt)
    return typeof ca === 'string' && ca >= cutoffIso
  })

  log(`entities >= ${cutoff}: ${targets.length}`)

  // Bucket by date so the operator can sanity-check before live mode.
  const buckets = new Map()
  for (const e of targets) {
    const d = (e.createdAt || e.attributes?.createdAt || '').slice(0, 10)
    buckets.set(d, (buckets.get(d) || 0) + 1)
  }
  const sorted = [...buckets.entries()].sort()
  for (const [d, n] of sorted) log(`  ${d}: ${n}`)

  if (dryRun) {
    log('DRY-RUN: no deletes issued. Re-run without --dry-run to apply.')
    return
  }

  log('deleting…')
  const stats = { ok: 0, fail: 0 }
  for (let i = 0; i < targets.length; i++) {
    const e = targets[i]
    const id = e.id || e.key
    if (!id) { stats.fail++; continue }
    const r = await fetch(`${OBS_API}/api/v1/entities/${encodeURIComponent(id)}`, { method: 'DELETE' })
    if (r.ok) stats.ok++
    else {
      stats.fail++
      if (stats.fail <= 3) {
        const txt = await r.text()
        log(`  DELETE ${id} -> ${r.status}: ${txt.slice(0, 160)}`)
      }
    }
    if ((i + 1) % 50 === 0) log(`  progress: ${i + 1}/${targets.length} ok=${stats.ok} fail=${stats.fail}`)
  }

  log(`DONE: ok=${stats.ok} fail=${stats.fail}`)

  const after = await (await fetch(`${OBS_API}/api/v1/stats`)).json()
  const s = after.data
  log(`km-core now: nodes=${s.nodeCount} edges=${s.edgeCount} orphans=${s.orphanCount}`)
}

main().catch((e) => { log(`FATAL: ${e.stack}`); process.exit(1) })
