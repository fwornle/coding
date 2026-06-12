// Pull entities + relations from VKB's multi-team API (`:8080/api/entities`
// + `:8080/api/relations`) and POST them into km-core via the canonical
// `/api/v1/entities` + `/api/v1/relations` endpoints.
//
// Why this exists: the user noticed only the `Coding` Project was visible
// in the unified viewer. The legacy export we backfilled from
// (`.data/exports/coding.json`) holds only the coding team's 928 entities.
// Other team roots — `Normalisa` (resi), `Timeline`/`DynArch` (ui),
// general-team observations — live in VKB's data source and never landed
// in km-core. Unified-viewer reads from km-core, so it can't see them.
//
// This script syncs the missing teams in. Existing km-core entities are
// untouched (POST returns 409 / upsert on duplicate). Relations are
// best-effort (drop on either endpoint missing).
//
// Usage:
//   node scripts/import-teams-to-kmcore.mjs [--teams=resi,ui,general] [--dry-run]
//   node scripts/import-teams-to-kmcore.mjs --teams=all

import process from 'node:process'

const VKB = process.env.VKB_URL || 'http://localhost:8080'
const KM = process.env.OBS_API_BASE || 'http://localhost:12436'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const teamsArg = (args.find((a) => a.startsWith('--teams=')) || '').split('=')[1] || 'resi,ui,general'
const teams = teamsArg === 'all' ? ['coding', 'resi', 'ui', 'general'] : teamsArg.split(',')

function log(msg) { process.stderr.write(`[import-teams] ${msg}\n`) }

const CANONICAL = new Set(['Project', 'Component', 'SubComponent', 'Detail'])

function shapeForKmCore(entity, team) {
  // VKB returns SQLite-shaped rows: entity_name, entity_type, observations[],
  // source, extracted_at, etc. Map to km-core Entity contract.
  const entityType = entity.entity_type || 'Detail'
  const ontologyClass = CANONICAL.has(entityType) ? entityType : 'Detail'
  const desc = Array.isArray(entity.observations)
    ? entity.observations.join('\n\n')
    : (entity.observations || '')
  return {
    name: entity.entity_name,
    entityType,
    ontologyClass,
    layer: 'evidence',
    description: desc,
    createdAt: entity.extracted_at || new Date().toISOString(),
    validFrom: entity.extracted_at || new Date().toISOString(),
    metadata: {
      source: entity.source === 'auto' ? 'auto' : 'manual',
      team,
      vkbId: entity.id,
      classification: entity.classification || null,
      confidence: entity.confidence || null,
      lastModified: entity.last_modified || null,
    },
  }
}

async function fetchVkbEntities(team) {
  const r = await fetch(`${VKB}/api/entities?team=${encodeURIComponent(team)}&limit=10000`)
  if (!r.ok) throw new Error(`VKB GET entities ${team}: ${r.status}`)
  return (await r.json()).entities || []
}

async function fetchVkbRelations(team) {
  const r = await fetch(`${VKB}/api/relations?team=${encodeURIComponent(team)}&limit=10000`)
  if (!r.ok) {
    log(`  WARN: VKB GET relations ${team} -> ${r.status}; skipping relations for this team`)
    return []
  }
  return (await r.json()).relations || []
}

async function fetchKmCoreEntitiesByName() {
  const r = await fetch(`${KM}/api/v1/entities?limit=20000`)
  const ents = (await r.json()).data || []
  const m = new Map()
  for (const e of ents) m.set(e.name, e.id)
  return m
}

async function postEntity(body) {
  const r = await fetch(`${KM}/api/v1/entities`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error(`POST entity ${r.status}: ${(await r.text()).slice(0, 200)}`)
  return (await r.json()).data.id
}

async function postRelation(from, to, type, team) {
  const r = await fetch(`${KM}/api/v1/relations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from, to, relationType: type,
      metadata: { source: 'team-import', team, importedAt: '2026-06-11' },
    }),
  })
  return r.ok
}

async function main() {
  log(`mode: ${dryRun ? 'DRY-RUN' : 'LIVE'}    teams: ${teams.join(',')}`)
  const existingByName = await fetchKmCoreEntitiesByName()
  log(`km-core has ${existingByName.size} entities (by name)`)

  let totalEntsAdded = 0
  let totalEntsSkipped = 0
  let totalRelsAdded = 0
  let totalRelsSkipped = 0

  for (const team of teams) {
    log(`--- team: ${team} ---`)
    const ents = await fetchVkbEntities(team)
    const rels = await fetchVkbRelations(team)
    log(`  VKB: ${ents.length} entities, ${rels.length} relations`)

    // Track newly-added entity ids by name so subsequent relation POSTs
    // can resolve targets created in this run.
    const localByName = new Map(existingByName)

    for (const e of ents) {
      if (localByName.has(e.entity_name)) {
        totalEntsSkipped++
        continue
      }
      if (dryRun) {
        log(`  [dry] would create: ${e.entity_type} ${e.entity_name}`)
        totalEntsAdded++
        continue
      }
      try {
        const id = await postEntity(shapeForKmCore(e, team))
        localByName.set(e.entity_name, id)
        totalEntsAdded++
      } catch (err) {
        log(`  FAIL post entity ${e.entity_name}: ${err.message}`)
      }
    }

    if (!dryRun) {
      for (const r of rels) {
        // VKB shape: { from_entity_id, to_entity_id, from_name, to_name,
        //   relation_type, ... }. Use the name fields to resolve against
        //   km-core ids (entity ids differ between stores).
        const fromName = r.from_name || r.from_entity_id || r.from
        const toName = r.to_name || r.to_entity_id || r.to
        const fromId = localByName.get(fromName)
        const toId = localByName.get(toName)
        if (!fromId || !toId) { totalRelsSkipped++; continue }
        const relType = r.relation_type || r.relationType || r.type || 'related_to'
        if (await postRelation(fromId, toId, relType, team)) {
          totalRelsAdded++
        } else {
          totalRelsSkipped++
        }
      }
    }
  }

  log('---')
  log(`DONE: entities added=${totalEntsAdded} skipped=${totalEntsSkipped}; relations added=${totalRelsAdded} skipped=${totalRelsSkipped}`)
  if (!dryRun) {
    const stats = await (await fetch(`${KM}/api/v1/stats`)).json()
    const s = stats.data
    log(`km-core now: nodes=${s.nodeCount} edges=${s.edgeCount} orphans=${s.orphanCount}`)
  }
}

main().catch((e) => { log(`FATAL: ${e.stack}`); process.exit(1) })
