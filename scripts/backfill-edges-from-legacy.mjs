// Backfill relations into km-core from the pre-Phase-44 legacy export.
//
// Source: .data/exports/coding.json (2026-05-24 snapshot, legacy
//   {entities, relations} schema with from/to as entity names + relationType).
// Target: km-core via POST /api/v1/relations (obs-api on :12436, single owner).
//
// Strategy:
//   1) Build name -> UUID map from live /api/v1/entities.
//   2) For each legacy relation, resolve from/to names to UUIDs.
//   3) POST {from: id, to: id, relationType, metadata} to /api/v1/relations.
//   4) Track unresolved (entity gone) + duplicates (km-core upsert) separately.
//
// Reasoning: the legacy export has 1124 relations recovered from the working
// pre-cutover state. Phase 44 ported nodes but not relations. The names are
// the stable join key — UUIDs differ across schemas. Wave-analysis is the
// long-term edge-generator but currently dead due to LLM proxy + lock issues;
// this script restores the graph immediately.

import fs from 'node:fs/promises'

const OBS_API = process.env.OBS_API_BASE || 'http://localhost:12436'
const LEGACY_PATH = process.env.LEGACY_PATH || '.data/exports/coding.json'

function log(msg) { process.stderr.write(`[backfill] ${msg}\n`) }

async function main() {
  log(`reading legacy export: ${LEGACY_PATH}`)
  const raw = await fs.readFile(LEGACY_PATH, 'utf8')
  const legacy = JSON.parse(raw)
  const legacyEnts = legacy.entities || []
  const legacyRels = legacy.relations || []
  log(`legacy: ${legacyEnts.length} entities, ${legacyRels.length} relations`)

  log(`fetching live entities from ${OBS_API}/api/v1/entities`)
  const res = await fetch(`${OBS_API}/api/v1/entities?limit=10000`)
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching entities`)
  const body = await res.json()
  const liveEnts = body.data || []
  log(`live: ${liveEnts.length} entities`)

  // Build name -> id map. Names should be unique; warn if not.
  const nameToId = new Map()
  const dupes = []
  for (const e of liveEnts) {
    const name = e.name || (e.attributes && e.attributes.name)
    const id = e.id || e.key
    if (!name || !id) continue
    if (nameToId.has(name)) {
      dupes.push(name)
      continue // keep first
    }
    nameToId.set(name, id)
  }
  log(`name->id map size: ${nameToId.size} (skipped ${dupes.length} duplicate names)`)

  // Backfill loop
  const stats = {
    total: legacyRels.length,
    posted: 0,
    duplicates: 0,
    fromMissing: 0,
    toMissing: 0,
    httpErr: 0,
  }
  const missingFrom = new Set()
  const missingTo = new Set()

  for (let i = 0; i < legacyRels.length; i++) {
    const r = legacyRels[i]
    const fromId = nameToId.get(r.from)
    const toId = nameToId.get(r.to)
    if (!fromId) { stats.fromMissing++; missingFrom.add(r.from); continue }
    if (!toId)   { stats.toMissing++;   missingTo.add(r.to);     continue }
    const post = await fetch(`${OBS_API}/api/v1/relations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: fromId,
        to: toId,
        relationType: r.relationType || r.type || 'related_to',
        metadata: { ...(r.metadata || {}), backfilledFrom: 'legacy-pre-phase44', backfilledAt: '2026-06-10' },
      }),
    })
    if (post.status === 201 || post.status === 200) {
      stats.posted++
    } else if (post.status === 409 || post.status === 422) {
      stats.duplicates++  // km-core addRelation upserts; 4xx ambiguous, count as dupe
    } else {
      stats.httpErr++
      if (stats.httpErr <= 3) {
        const txt = await post.text()
        log(`HTTP ${post.status} on rel #${i}: ${txt.slice(0, 200)}`)
      }
    }
    if ((i + 1) % 100 === 0) {
      log(`progress: ${i + 1}/${legacyRels.length} posted=${stats.posted} missing=${stats.fromMissing + stats.toMissing} httpErr=${stats.httpErr}`)
    }
  }

  log('---')
  log(`DONE: ${JSON.stringify(stats)}`)
  log(`unique from-names not found: ${missingFrom.size} (first 10: ${[...missingFrom].slice(0, 10).join(', ')})`)
  log(`unique to-names not found:   ${missingTo.size} (first 10: ${[...missingTo].slice(0, 10).join(', ')})`)
}

main().catch((e) => { log(`FATAL: ${e.stack}`); process.exit(1) })
