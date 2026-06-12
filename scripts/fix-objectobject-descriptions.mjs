// fix-objectobject-descriptions — clears km-core entity descriptions
// that contain the literal "[object Object]" corruption.
//
// Root cause (upstream, not yet fixed in pipeline): one of the
// transferable-pattern importers stored `String(someObject)` instead
// of extracting `.text` or `JSON.stringify`-ing. Result: 11 pattern
// entities have their entire description replaced with "[object
// Object]\n\n[object Object]\n\n…".
//
// This script does NOT attempt to recover the original text (it's
// not retained anywhere — VKB doesn't have these entities either).
// It replaces the corrupted description with a short placeholder so
// the UI doesn't render "[object Object]" anymore, until the pattern
// extractor is fixed upstream and re-runs.
//
// Idempotent: re-running finds 0 candidates.

import process from 'node:process'

const KM = process.env.OBS_API_BASE || 'http://localhost:12436'
const log = (m) => process.stderr.write(`[fix-desc] ${m}\n`)

async function main() {
  const list = await (await fetch(`${KM}/api/v1/entities?limit=20000`)).json()
  const all = list.data || []
  const broken = all.filter(
    (e) => typeof e.description === 'string' && e.description.includes('[object Object]'),
  )
  log(`total=${all.length} broken=${broken.length}`)

  if (broken.length === 0) {
    log('nothing to do')
    return
  }

  let ok = 0
  let fail = 0
  for (const e of broken) {
    const placeholder = `[Description unavailable — pattern entity ${e.entityType ?? ''} `
      + `imported with serializer bug; rerun the pattern extractor to repopulate.]`
    const r = await fetch(`${KM}/api/v1/entities/${encodeURIComponent(e.id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: placeholder }),
    })
    if (r.ok) ok++
    else { fail++; log(`  fail ${e.id} (${e.name}): ${r.status}`) }
  }

  log(`DONE: cleared=${ok} failed=${fail}`)
}

main().catch((e) => { log(`FATAL: ${e.stack}`); process.exit(1) })
