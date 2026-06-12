// Add parent-child edges from CollectiveKnowledge (the System root) to
// every Project (Coding, Normalisa, Timeline, DynArch, …) so the
// path-trace from the unified viewer's click handler can walk all the
// way to the System node — VKB reference behaviour.
//
// Also dedups the System node if multiple copies were imported by the
// team-import script.

import process from 'node:process'

const KM = process.env.OBS_API_BASE || 'http://localhost:12436'

function log(msg) { process.stderr.write(`[link] ${msg}\n`) }

async function main() {
  const ents = (await (await fetch(`${KM}/api/v1/entities?limit=20000`)).json()).data || []

  const systems = ents.filter((e) => e.name === 'CollectiveKnowledge')
  log(`CollectiveKnowledge copies: ${systems.length}`)
  if (systems.length === 0) {
    log('FATAL: no System node found; cannot link.')
    process.exit(1)
  }

  // Keep the canonical (oldest createdAt) and delete the rest.
  systems.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''))
  const keeper = systems[0]
  log(`keeping: ${keeper.id} (createdAt=${keeper.createdAt})`)
  for (let i = 1; i < systems.length; i++) {
    const r = await fetch(`${KM}/api/v1/entities/${encodeURIComponent(systems[i].id)}`, { method: 'DELETE' })
    log(`  delete dup ${systems[i].id}: ${r.status}`)
  }

  const projects = ents.filter((e) => e.entityType === 'Project')
  log(`Projects: ${projects.map((p) => p.name).join(', ')}`)

  let added = 0
  for (const p of projects) {
    const r = await fetch(`${KM}/api/v1/relations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: keeper.id,
        to: p.id,
        relationType: 'parent-child',
        metadata: { source: 'collective-link', anchoredAt: '2026-06-11' },
      }),
    })
    if (r.ok) added++
    log(`  link CollectiveKnowledge -> ${p.name}: ${r.status}`)
  }

  log(`DONE: added ${added} parent-child edges`)

  const stats = await (await fetch(`${KM}/api/v1/stats`)).json()
  const s = stats.data
  log(`km-core now: nodes=${s.nodeCount} edges=${s.edgeCount} orphans=${s.orphanCount}`)
}

main().catch((e) => { log(`FATAL: ${e.stack}`); process.exit(1) })
