// delete-raw-observations — purge km-core entities whose name begins
// with `[Raw]`. These are placeholder Observations the LLM summary
// pipeline emits when summarisation fails; they pollute the knowledge
// graph viewer with rows like `[Raw] 2 messages (1 user, 1 assistant).
// LLM summary unavailable.`
//
// Idempotent. Safe to re-run.

import process from 'node:process'

const KM = process.env.OBS_API_BASE || 'http://localhost:12436'
const log = (m) => process.stderr.write(`[raw-purge] ${m}\n`)

async function main() {
  const list = await (await fetch(`${KM}/api/v1/entities?limit=20000`)).json()
  const all = list.data || []
  const targets = all.filter(
    (e) => typeof e.name === 'string' && e.name.startsWith('[Raw]'),
  )
  log(`total=${all.length} raw=${targets.length}`)

  if (targets.length === 0) {
    log('nothing to do')
    return
  }

  let ok = 0
  let fail = 0
  for (const e of targets) {
    const r = await fetch(
      `${KM}/api/v1/entities/${encodeURIComponent(e.id)}`,
      { method: 'DELETE' },
    )
    if (r.ok) ok++
    else { fail++; log(`  fail ${e.id} (${e.name}): ${r.status}`) }
  }

  log(`DONE: deleted=${ok} failed=${fail}`)
}

main().catch((e) => { log(`FATAL: ${e.stack}`); process.exit(1) })
