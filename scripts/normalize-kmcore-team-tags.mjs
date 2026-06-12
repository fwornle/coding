// normalize-kmcore-team-tags — re-tag every km-core entity whose
// metadata.team is missing / falsy as `general`.
//
// Why: VKB (reference) has `team: general` for ~105 entities — most
// Insights / Observations / Digests that aren't pinned to a specific
// project team. km-core inherited the same population but the import
// path dropped the team tag, so the unified viewer's Teams filter
// doesn't expose a "General" entry. This script re-establishes parity.
//
// CAUTION: km-core's PUT /api/v1/entities/:id REPLACES the metadata
// object wholesale (no PATCH endpoint as of 2026-06-11). To avoid
// clobbering other metadata fields (summary, decayBreakdown, project,
// …) we read the full entity, deep-merge `team: 'general'` into its
// metadata, then PUT it back.
//
// Idempotent: re-running a second time finds 0 candidates.

import process from 'node:process'

const KM = process.env.OBS_API_BASE || 'http://localhost:12436'
const log = (m) => process.stderr.write(`[team-tag] ${m}\n`)

async function main() {
  const list = await (await fetch(`${KM}/api/v1/entities?limit=20000`)).json()
  const all = list.data || []
  const targets = all.filter((e) => !((e.metadata || {}).team))
  log(`total entities: ${all.length}, missing team: ${targets.length}`)

  if (targets.length === 0) {
    log('nothing to do — already normalised')
    return
  }

  let ok = 0
  let fail = 0
  for (const e of targets) {
    const full = await (await fetch(`${KM}/api/v1/entities/${encodeURIComponent(e.id)}`)).json()
    if (!full.success || !full.data) { fail++; continue }
    const mergedMeta = { ...(full.data.metadata || {}), team: 'general' }
    const r = await fetch(`${KM}/api/v1/entities/${encodeURIComponent(e.id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ metadata: mergedMeta }),
    })
    if (r.ok) ok++
    else { fail++; log(`  fail ${e.id}: ${r.status}`) }
  }

  log(`DONE: tagged=${ok} failed=${fail}`)

  const stats = await (await fetch(`${KM}/api/v1/stats`)).json()
  const s = stats.data
  log(`km-core now: nodes=${s.nodeCount} edges=${s.edgeCount} orphans=${s.orphanCount}`)
}

main().catch((e) => { log(`FATAL: ${e.stack}`); process.exit(1) })
