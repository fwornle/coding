// Purge ALL km-core orphan entities (zero edges) via /api/v1/entities/:id DELETE.
//
// Companion to scripts/purge-kmcore-by-date.mjs but filters by graph topology
// rather than date — drops anything the connectivity report calls an orphan.
//
// Use case (2026-06-11): after the May-29 date purge, 169 pre-cutover orphans
//   remain (Insight/Config/Fault/Observation nodes that never got edges from
//   the legacy export). User authorized removing them as noise.
//
// Usage:
//   node scripts/purge-kmcore-orphans.mjs [--dry-run]

import process from 'node:process'

const OBS_API = process.env.OBS_API_BASE || 'http://localhost:12436'
const dryRun = process.argv.includes('--dry-run')

function log(msg) { process.stderr.write(`[purge-orphans] ${msg}\n`) }

async function main() {
  log(`mode: ${dryRun ? 'DRY-RUN' : 'LIVE'}`)
  const res = await fetch(`${OBS_API}/api/v1/graph/orphans`)
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching orphans`)
  const body = await res.json()
  const orphans = body.data || []
  log(`orphan count: ${orphans.length}`)

  const typeCounts = new Map()
  for (const e of orphans) {
    const t = e.entityType || 'unknown'
    typeCounts.set(t, (typeCounts.get(t) || 0) + 1)
  }
  for (const [t, n] of [...typeCounts.entries()].sort((a, b) => b[1] - a[1])) {
    log(`  ${t}: ${n}`)
  }

  if (dryRun) return

  let ok = 0, fail = 0
  for (let i = 0; i < orphans.length; i++) {
    const id = orphans[i].id
    if (!id) { fail++; continue }
    const r = await fetch(`${OBS_API}/api/v1/entities/${encodeURIComponent(id)}`, { method: 'DELETE' })
    if (r.ok) ok++
    else {
      fail++
      if (fail <= 3) log(`  DELETE ${id} -> ${r.status}: ${(await r.text()).slice(0, 160)}`)
    }
    if ((i + 1) % 50 === 0) log(`  progress ${i + 1}/${orphans.length} ok=${ok} fail=${fail}`)
  }
  log(`DONE: ok=${ok} fail=${fail}`)

  const after = await (await fetch(`${OBS_API}/api/v1/stats`)).json()
  const s = after.data
  log(`km-core now: nodes=${s.nodeCount} edges=${s.edgeCount} orphans=${s.orphanCount}`)
}

main().catch((e) => { log(`FATAL: ${e.stack}`); process.exit(1) })
