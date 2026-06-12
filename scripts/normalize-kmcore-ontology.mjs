// Normalize existing km-core entities to the 4-class ontology hierarchy.
//
// Why this exists: ObservationWriter (and the Phase-42 SQLite migration) set
// entityType to free-form labels — `Observation`, `Digest`, `Insight`, `File`,
// `Container`, `Port`, `Config`, `Process`, etc. — AND copied that label into
// the `ontologyClass` slot. The viewer code colors/filters by ontologyClass
// expecting {Project, Component, SubComponent, Detail}, so anything outside
// those classes renders as a generic dot in no hierarchy bucket.
//
// Fix: leave `entityType` as the free-form domain tag, but force
// `ontologyClass` ∈ {Project, Component, SubComponent, Detail}. For
// entityType ∈ {Observation, Digest, Insight} we also stamp
// `metadata.source = 'auto'` so VKB's data-processor maps them to the
// `online` bucket (red dot) instead of `batch` (blue).
//
// Usage:
//   node scripts/normalize-kmcore-ontology.mjs [--dry-run]

import process from 'node:process'

const OBS_API = process.env.OBS_API_BASE || 'http://localhost:12436'
const dryRun = process.argv.includes('--dry-run')

const CANONICAL = new Set(['Project', 'Component', 'SubComponent', 'Detail'])
const ONLINE_TYPES = new Set(['Observation', 'Digest', 'Insight'])

function log(msg) { process.stderr.write(`[normalize] ${msg}\n`) }

async function main() {
  log(`mode: ${dryRun ? 'DRY-RUN' : 'LIVE'}`)
  const res = await fetch(`${OBS_API}/api/v1/entities?limit=10000`)
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching entities`)
  const ents = (await res.json()).data || []
  log(`total entities: ${ents.length}`)

  const touched = []
  for (const e of ents) {
    const updates = {}
    const oc = e.ontologyClass
    if (!CANONICAL.has(oc)) {
      // Map non-canonical → Detail. The viewer hierarchy expects 4 levels;
      // everything that isn't an explicit Project/Component/SubComponent
      // collapses to Detail (leaf). This is intentionally lossy at the
      // ontology slot but lossless at entityType (kept verbatim).
      updates.ontologyClass = 'Detail'
    }
    if (ONLINE_TYPES.has(e.entityType)) {
      const currentSource = (e.metadata && e.metadata.source) || null
      if (currentSource !== 'auto') {
        updates.metadata = { ...(e.metadata || {}), source: 'auto' }
      }
    }
    if (Object.keys(updates).length > 0) {
      touched.push({ id: e.id, name: e.name, entityType: e.entityType, oldOC: oc, updates })
    }
  }
  log(`would update: ${touched.length} entities`)

  // Summarize the changes
  const byChange = new Map()
  for (const t of touched) {
    const key = `${t.oldOC} -> ${t.updates.ontologyClass ?? '(unchanged)'} ` +
                `[${t.entityType}${t.updates.metadata ? ' +source=auto' : ''}]`
    byChange.set(key, (byChange.get(key) || 0) + 1)
  }
  for (const [k, n] of [...byChange.entries()].sort((a, b) => b[1] - a[1])) {
    log(`  ${k}: ${n}`)
  }

  if (dryRun) return

  let ok = 0, fail = 0
  for (let i = 0; i < touched.length; i++) {
    const t = touched[i]
    const r = await fetch(`${OBS_API}/api/v1/entities/${encodeURIComponent(t.id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(t.updates),
    })
    if (r.ok) ok++
    else {
      fail++
      if (fail <= 3) log(`  PUT ${t.id} -> ${r.status}: ${(await r.text()).slice(0, 180)}`)
    }
    if ((i + 1) % 25 === 0) log(`  progress ${i + 1}/${touched.length} ok=${ok} fail=${fail}`)
  }
  log(`DONE: ok=${ok} fail=${fail}`)
}

main().catch((e) => { log(`FATAL: ${e.stack}`); process.exit(1) })
