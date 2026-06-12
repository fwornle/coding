// Restore Observation/Digest/Insight entities from .data/observation-export/
// back into km-core after over-aggressive purge cycles.
//
// Why this exists: the 2026-06-11 cleanup pass (`purge-kmcore-by-date.mjs`
// + `purge-kmcore-orphans.mjs`) wiped 4000+ observations along with the
// outer-ring orphans the user was complaining about. The dashboard at
// :3032/observations went from thousands of rows to one. The JSON exports
// under .data/observation-export/ still hold the full history (last
// snapshot: 2026-06-05), so we can rebuild from there.
//
// Each row is restored as a km-core entity using:
//   - entityType = 'Observation' | 'Digest' | 'Insight' (free-form domain tag)
//   - ontologyClass = 'Detail'  (anchored in the 4-class hierarchy)
//   - metadata.source = 'auto'  (VKB renders these red as online-learned)
//   - createdAt/validFrom = the original timestamp from the export
//   - legacyId = the original id (so we can dedup across runs)
//
// After each entity is POSTed, a `capturedBy` edge to LiveLoggingSystem is
// added so it does not become an orphan (matches the writer-side anchor
// behaviour added the same day).
//
// Usage:
//   node scripts/restore-observations-to-kmcore.mjs [--dry-run] [--types=obs,digest,insight] [--project=coding]

import fs from 'node:fs/promises'
import process from 'node:process'

const OBS_API = process.env.OBS_API_BASE || 'http://localhost:12436'
const EXPORT_DIR = '.data/observation-export'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const typesArg = (args.find((a) => a.startsWith('--types=')) || '').split('=')[1]
const projArg = (args.find((a) => a.startsWith('--project=')) || '').split('=')[1]
const wantTypes = new Set((typesArg ? typesArg.split(',') : ['obs', 'digest', 'insight']))

function log(msg) { process.stderr.write(`[restore] ${msg}\n`) }

async function resolveAnchor() {
  const res = await fetch(`${OBS_API}/api/v1/entities?limit=10000`)
  const ents = (await res.json()).data || []
  const lsl = ents.find((e) => e.name === 'LiveLoggingSystem' && e.entityType === 'Component')
  if (!lsl) throw new Error('LiveLoggingSystem Component not found — cannot anchor')
  log(`anchor: LiveLoggingSystem = ${lsl.id}`)
  return lsl.id
}

async function postEntity(body) {
  const r = await fetch(`${OBS_API}/api/v1/entities`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!r.ok) {
    const t = await r.text()
    throw new Error(`POST entity ${r.status}: ${t.slice(0, 200)}`)
  }
  const j = await r.json()
  return j.data.id
}

async function postRelation(from, to, type) {
  const r = await fetch(`${OBS_API}/api/v1/relations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from, to, relationType: type,
      metadata: { source: 'observation-restore', anchoredAt: '2026-06-11' },
    }),
  })
  return r.ok
}

function shapeObservation(row) {
  return {
    name: (row.summary || '').slice(0, 80) || '(no summary)',
    entityType: 'Observation',
    ontologyClass: 'Detail',
    layer: 'evidence',
    description: row.summary || '',
    createdAt: row.createdAt || row.created_at,
    validFrom: row.createdAt || row.created_at,
    metadata: {
      source: 'auto',
      agent: row.agent || null,
      project: row.project || null,
      quality: row.quality || null,
      digestedAt: row.digestedAt || null,
      llm: row.llm || null,
      modifiedFiles: row.modifiedFiles || null,
      legacyId: row.id,
      restoredFrom: 'observation-export-2026-06-05',
    },
  }
}

function shapeDigest(row) {
  return {
    name: (row.theme || row.summary || '').slice(0, 80) || '(no theme)',
    entityType: 'Digest',
    ontologyClass: 'Detail',
    layer: 'evidence',
    description: row.summary || '',
    createdAt: row.created_at || row.createdAt,
    validFrom: row.created_at || row.createdAt,
    metadata: {
      source: 'auto',
      date: row.date || null,
      theme: row.theme || null,
      agents: row.agents || null,
      filesTouched: row.files_touched || row.filesTouched || null,
      observationIds: row.observation_ids || row.observationIds || null,
      legacyId: row.id,
      restoredFrom: 'observation-export-2026-06-05',
    },
  }
}

function shapeInsight(row) {
  return {
    name: (row.topic || row.title || '').slice(0, 80) || '(no topic)',
    entityType: 'Insight',
    ontologyClass: 'Detail',
    layer: 'evidence',
    description: row.summary || row.content || '',
    createdAt: row.created_at || row.createdAt || row.last_updated,
    validFrom: row.created_at || row.createdAt || row.last_updated,
    metadata: {
      source: 'auto',
      topic: row.topic || null,
      confidence: row.confidence || null,
      digestIds: row.digest_ids || row.digestIds || null,
      project: row.project || null,
      lastUpdated: row.last_updated || row.lastUpdated || null,
      legacyId: row.id,
      restoredFrom: 'observation-export-2026-06-05',
    },
  }
}

async function main() {
  log(`mode: ${dryRun ? 'DRY-RUN' : 'LIVE'}    types: ${[...wantTypes].join(',')}    project filter: ${projArg || '(all)'}`)

  const anchorId = dryRun ? '<anchor>' : await resolveAnchor()

  const observations = wantTypes.has('obs')
    ? JSON.parse(await fs.readFile(`${EXPORT_DIR}/observations.json`, 'utf8'))
    : []
  const digests = wantTypes.has('digest')
    ? JSON.parse(await fs.readFile(`${EXPORT_DIR}/digests.json`, 'utf8'))
    : []
  const insights = wantTypes.has('insight')
    ? JSON.parse(await fs.readFile(`${EXPORT_DIR}/insights.json`, 'utf8'))
    : []

  // Optional project filter (observations have `project` field).
  const filt = (row) => !projArg || row.project === projArg || !row.project
  const obsRows = observations.filter(filt)
  const digRows = digests.filter(filt)
  const insRows = insights.filter(filt)

  log(`to restore: ${obsRows.length} obs, ${digRows.length} digests, ${insRows.length} insights`)

  if (dryRun) {
    log('DRY-RUN: stopping here. Sample shape:')
    if (obsRows[0]) log(`  obs:    ${JSON.stringify(shapeObservation(obsRows[0])).slice(0, 200)}…`)
    if (digRows[0]) log(`  digest: ${JSON.stringify(shapeDigest(digRows[0])).slice(0, 200)}…`)
    if (insRows[0]) log(`  insight:${JSON.stringify(shapeInsight(insRows[0])).slice(0, 200)}…`)
    return
  }

  const all = [
    ...obsRows.map((r) => ['Observation', shapeObservation(r)]),
    ...digRows.map((r) => ['Digest', shapeDigest(r)]),
    ...insRows.map((r) => ['Insight', shapeInsight(r)]),
  ]

  const stats = { ok: 0, fail: 0, anchored: 0 }
  for (let i = 0; i < all.length; i++) {
    const [kind, body] = all[i]
    try {
      const id = await postEntity(body)
      stats.ok++
      const anch = await postRelation(id, anchorId, 'capturedBy')
      if (anch) stats.anchored++
    } catch (err) {
      stats.fail++
      if (stats.fail <= 5) log(`  ${kind} #${i}: ${err.message}`)
    }
    if ((i + 1) % 200 === 0) {
      log(`  progress ${i + 1}/${all.length} ok=${stats.ok} anchored=${stats.anchored} fail=${stats.fail}`)
    }
  }

  log(`DONE: ${JSON.stringify(stats)}`)
  const after = await (await fetch(`${OBS_API}/api/v1/stats`)).json()
  const s = after.data
  log(`km-core now: nodes=${s.nodeCount} edges=${s.edgeCount} orphans=${s.orphanCount}`)
}

main().catch((e) => { log(`FATAL: ${e.stack}`); process.exit(1) })
