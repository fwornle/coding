// Delete all km-core entities of the given entityType(s) (+ their edges).
//
// Use case (2026-06-11): the earlier restore script POSTed 4066 Observation
// + 1343 Digest entities into the graph store. They show up as a giant
// gray ball in VKB because they are TIME-SERIES events, not graph nodes.
// Insights (82) stay because they ARE knowledge-graph-worthy.
//
// The JSON export at .data/observation-export/ is untouched — observations
// remain available, just no longer as graph entities. The dashboard's
// /api/coding/observations endpoint will be re-pointed to read the JSON
// directly (separate script).
//
// Usage:
//   node scripts/delete-kmcore-by-entitytype.mjs Observation Digest [--dry-run]

import process from 'node:process'

const OBS_API = process.env.OBS_API_BASE || 'http://localhost:12436'
const dryRun = process.argv.includes('--dry-run')
const types = new Set(process.argv.slice(2).filter((a) => !a.startsWith('--')))

if (types.size === 0) {
  process.stderr.write('usage: node scripts/delete-kmcore-by-entitytype.mjs <Type>... [--dry-run]\n')
  process.exit(2)
}

function log(msg) { process.stderr.write(`[delete] ${msg}\n`) }

async function main() {
  log(`types: ${[...types].join(',')}    mode: ${dryRun ? 'DRY-RUN' : 'LIVE'}`)
  const res = await fetch(`${OBS_API}/api/v1/entities?limit=20000`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const ents = (await res.json()).data || []
  log(`total entities: ${ents.length}`)

  const targets = ents.filter((e) => types.has(e.entityType))
  log(`matching entityType: ${targets.length}`)

  if (dryRun) return

  let ok = 0, fail = 0
  for (let i = 0; i < targets.length; i++) {
    const id = targets[i].id
    const r = await fetch(`${OBS_API}/api/v1/entities/${encodeURIComponent(id)}`, { method: 'DELETE' })
    if (r.ok) ok++
    else {
      fail++
      if (fail <= 3) log(`  DELETE ${id} -> ${r.status}: ${(await r.text()).slice(0, 160)}`)
    }
    if ((i + 1) % 200 === 0) log(`  progress ${i + 1}/${targets.length} ok=${ok} fail=${fail}`)
  }
  log(`DONE: ok=${ok} fail=${fail}`)

  const after = await (await fetch(`${OBS_API}/api/v1/stats`)).json()
  const s = after.data
  log(`km-core now: nodes=${s.nodeCount} edges=${s.edgeCount} orphans=${s.orphanCount}`)
}

main().catch((e) => { log(`FATAL: ${e.stack}`); process.exit(1) })
