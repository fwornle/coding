#!/usr/bin/env node
/**
 * Derive and write the intent spine — the second tree in the knowledge graph.
 *
 * WHY THIS EXISTS AS A COMMITTED SCRIPT
 *
 * The 19 `Intent` entities and their 741 `aggregates` edges were produced on
 * 2026-09-22 by a chain of scratchpad scripts under /tmp: stage4-derive,
 * stage4-place, stage4-apply, stage4-refine, merge-dup. They worked, and then
 * existed nowhere a reboot could not erase — `grep -rn derivationRunId` over the
 * repo hit only `.data/**`, the output, never the code. This is that chain
 * folded into one producer, with the dead ends left out and the lessons kept.
 *
 * WHAT THE SPINE IS
 *
 * `Intent` ─aggregates→ `Insight`. One entity class, one edge type, and nothing
 * else: `metadata.parentId` (stage 2's CODE placement) is never touched, so
 * deleting every Intent and every `aggregates` edge reverts this whole thing and
 * leaves the code tree exactly as it was. That property is what made the spine
 * safe to write at all, and it is worth not giving up.
 *
 * WHY THE TAXONOMY IS COMMITTED DATA, NOT RE-DERIVED EACH RUN
 *
 * Deriving categories from the corpus is an LLM call, so it is not reproducible:
 * two runs give two different taxonomies. Stability was measured, and the number
 * that matters is the CAP, not the corpus:
 *
 *   cap  8-12  -> kappa 0.49   (categories unstable; merges arbitrary)
 *   cap 14-20  -> kappa 0.77   (0.83 on shared categories)  <- config ships this
 *   cap 16-24  -> 29 categories, 0% verb-led, 82% named a module
 *
 * The last one is the interesting failure: given room, the model reproduces the
 * code spine in different words. So `config/intent-taxonomy.json` holds the
 * taxonomy that was actually measured and actually written, and a normal run
 * places the corpus against it. `--derive` re-runs the derivation into a NEW
 * file for comparison; it never writes the graph.
 *
 * WHAT IS DELIBERATELY NOT WRITTEN: metadata.codeEvidence
 *
 * The original apply stored, per intent, which Components its insights sat
 * under. Its `componentOf` walked `metadata.parentId` then the containment
 * parent with NO ranking, while the viewer's `deriveParents` ranks by
 * level-distance, then edge type, then depth. The two disagreed (largest intent:
 * four of seven components) and the stored version silently dropped the 19
 * lessons that reach no Component, so its counts summed to 77 under a row saying
 * 96. The viewer now derives that join itself, from the map the canvas actually
 * draws with (`integrations/unified-viewer/src/graph/intent-code-reach.ts`), so
 * writing a second, unranked copy here would only recreate the disagreement.
 *
 * IDEMPOTENCY IS NOT OPTIONAL
 *
 * km-core's addRelation is not idempotent on (from,to,type). A writer that
 * re-adds without probing multiplies its edges — this store once carried 13,675
 * `capturedBy` edges over 1,219 distinct pairs, 91% duplicates, because one
 * writer never probed. Every edge here is probed first.
 *
 * And the probe has a trap in it: POST takes {from,to,relationType}, GET returns
 * graphology shape {source,target,attributes:{type}}. Reading back the POST
 * shape matches nothing, the probe silently passes, and a re-run re-adds every
 * edge. Read the shape GET actually returns.
 *
 * SCOPE
 *
 * Insights are filtered to one project (default `coding`). 202 of the store's
 * 993 Insights belong to other projects (a2a-xpr 85, a2a 37, rec 29 ...), and
 * the first apply aggregated ~150 of them under coding intents before anyone
 * noticed. Not wrong data — wrongly scoped.
 *
 * Usage:
 *   node scripts/derive-intent-spine.mjs                 # dry run, prints the plan
 *   node scripts/derive-intent-spine.mjs --apply         # write entities + edges
 *   node scripts/derive-intent-spine.mjs --derive        # re-derive a taxonomy only
 *
 * Options:
 *   --apply              Write to the graph. Without it nothing is written.
 *   --derive             Re-derive a taxonomy into config/intent-taxonomy.<ts>.json
 *                        for comparison. Never writes the graph. Implies no --apply.
 *   --project=<name>     Project to scope insights to (default: coding)
 *   --taxonomy=<path>    Taxonomy file (default: config/intent-taxonomy.json)
 *   --batch=<n>          Insights per placement call (default: 45)
 *   --exclude-archived   Skip rolled-up Insights (651 of the current 741 are
 *                        archived — read the note on loadInsights first)
 *   --fresh              Ignore the checkpoint and re-place everything
 *   --verbose            Print each category's sample titles
 *   --help               Show this message
 *
 * Environment:
 *   OBS_API_URL          default http://127.0.0.1:12436
 *   LLM_CLI_PROXY_URL    default http://localhost:12435   (POST /api/complete)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = process.env.CODING_REPO || resolve(dirname(fileURLToPath(import.meta.url)), '..')
const API = (process.env.OBS_API_URL || 'http://127.0.0.1:12436').replace(/\/$/, '')
const PROXY = `${(process.env.LLM_CLI_PROXY_URL || 'http://localhost:12435').replace(/\/$/, '')}/api/complete`

const argv = process.argv.slice(2)
const has = (f) => argv.includes(f)
const opt = (name, dflt) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : dflt
}

if (has('--help') || has('-h')) {
  // Just the usage half. The rationale above it is for whoever edits this file,
  // not for someone who typed --help wanting to know the flags.
  const header = readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]
  const usage = header.slice(header.indexOf(' * Usage:'))
  console.log(usage.replace(/^ \* ?/gm, '').trimEnd())
  process.exit(0)
}

const APPLY = has('--apply') && !has('--derive')
const DERIVE = has('--derive')
const PROJECT = opt('project', 'coding')
const BATCH = Number(opt('batch', '45')) || 45
const VERBOSE = has('--verbose')
const TAXONOMY_PATH = resolve(REPO, opt('taxonomy', 'config/intent-taxonomy.json'))
const CKPT = join(REPO, '.data', 'intent-spine', `place-${PROJECT}.json`)
const RUN = `intent-spine-${new Date().toISOString().replace(/[:.]/g, '-')}`

// ---------------------------------------------------------------------------
// transport
// ---------------------------------------------------------------------------

async function api(method, path, body) {
  const res = await fetch(`${API}${path}`, body === undefined
    ? { method }
    : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const text = await res.text()
  let parsed = null
  try { parsed = JSON.parse(text) } catch { /* non-JSON error body */ }
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 180)}`)
  return parsed?.data ?? parsed
}

async function complete(messages, complexity = 'small', tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(PROXY, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // `complexity` is the ONLY field that routes. A `taskType` field is read
        // by nothing — see CLAUDE.md on the proxy contract.
        body: JSON.stringify({ process: 'bg-intent-clustering', messages, complexity }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return (await res.json()).content
    } catch (err) {
      if (i === tries - 1) throw err
      await new Promise((r) => setTimeout(r, 3000 * (i + 1)))
    }
  }
}

/** Parse JSON out of a model reply that may be fenced or have prose around it. */
function parseJson(text) {
  const s = String(text).trim().replace(/^```(json)?/i, '').replace(/```$/, '').trim()
  const ob = s.indexOf('{'), obEnd = s.lastIndexOf('}')
  const ar = s.indexOf('['), arEnd = s.lastIndexOf(']')
  const useArray = ar !== -1 && (ob === -1 || ar < ob)
  return JSON.parse(useArray ? s.slice(ar, arEnd + 1) : s.slice(ob, obEnd + 1))
}

// ---------------------------------------------------------------------------
// corpus
// ---------------------------------------------------------------------------

/**
 * The Insights in scope, from the API rather than a hand-exported file.
 *
 * PAGED, because `limit` is capped server-side at 1000 however large a number
 * you send — `limit=5000` returns exactly 1000 and says nothing about the rest.
 * The corpus stands at 1000 today, i.e. exactly at the cap, so an unpaged read
 * is already one insight away from silently truncating. `offset` is the only
 * paging parameter the API honours; `page`, `skip` and `cursor` are accepted
 * and ignored, which is worse than rejecting them.
 *
 * ARCHIVED RECORDS ARE INCLUDED BY DEFAULT, and that is a real choice:
 * 651 of the spine's 741 aggregated lessons are archived. An archived Insight
 * has been rolled up into a successor, so a case can be made for excluding it —
 * but the canvas ALREADY hides archived rows by default, so excluding them here
 * too would hide them twice while the rail's counts still claimed them. Whether
 * the spine should cover only live lessons is a data decision, not something a
 * producer should make silently on a re-run; `--exclude-archived` states it.
 */
async function loadInsights() {
  const PAGE = 1000
  const raw = []
  for (let offset = 0; ; offset += PAGE) {
    const batch = (await api('GET', `/api/v1/entities?ontologyClass=Insight&limit=${PAGE}&offset=${offset}`)) || []
    raw.push(...batch)
    if (batch.length < PAGE) break
  }
  const excludeArchived = has('--exclude-archived')
  let archived = 0
  const scoped = raw.filter((e) => {
    const m = e.metadata || {}
    if ((m.project || m.team || '') !== PROJECT) return false
    if (m.archivedAt) {
      archived++
      if (excludeArchived) return false
    }
    return true
  })
  console.log(`fetched ${raw.length} Insight(s); ${scoped.length} in project=${PROJECT}`
    + (excludeArchived ? ` (${archived} archived excluded)` : ` (${archived} archived, included)`))
  return scoped.map((e) => ({
    id: e.id,
    title: e.name,
    summary: String((e.metadata || {}).summary || e.description || '').replace(/\s+/g, ' ').trim(),
  }))
}

// ---------------------------------------------------------------------------
// the rules the taxonomy must obey — see the cap table in the header
// ---------------------------------------------------------------------------

const RULES = `
A category names an INTENT: what a person was trying to ACHIEVE, or a standing
concern they kept returning to.

FORBIDDEN as category names:
 - module/service/technology names (Docker, LevelDB, Dashboard)
 - structural labels (Architecture, Configuration, Integration, Utilities)
 - unfalsifiable catch-alls (Patterns, Best Practices, Conventions, Misc)

EXCLUDABILITY RULE — the most important one. Every category must be able to
REJECT records. Write its test so a reader can say "no, that one does not belong
here". Do NOT broaden a category with a trailing clause such as "... and data
infrastructure" or "... and related concerns": that turns a sharp category into
a soft catch-all. Prefer TWO precise categories over one broad one.`

/** Re-derive a taxonomy from the corpus. Research mode — writes no graph. */
async function deriveTaxonomy(insights) {
  const SAMPLES = 8
  const proposals = []
  for (let s = 0; s < SAMPLES; s++) {
    const batch = insights.filter((_, i) => i % SAMPLES === s).slice(0, 64)
    const list = batch.map((o, i) => `${i + 1}. ${o.title} :: ${o.summary.slice(0, 150)}`).join('\n')
    const out = await complete([{ role: 'user', content:
`Below are ${batch.length} knowledge records distilled from real software engineering sessions on one project.
${RULES}

Propose 10-18 intent categories that would cover these records.

RECORDS:
${list}

Respond ONLY with JSON: {"categories":[{"name":"...","test":"one sentence: what belongs AND what is excluded"}]}` }], 'medium')
    const got = parseJson(out).categories || []
    proposals.push(...got)
    console.log(`  derive ${s + 1}/${SAMPLES}  (+${got.length})`)
  }

  // 14-20 is not a preference, it is the band that measured kappa 0.77. Wider
  // and the model returns the module taxonomy; narrower and merges go arbitrary.
  const out = await complete([{ role: 'user', content:
`These are overlapping intent-category proposals from eight independent samples of the same corpus.
${RULES}

Consolidate into a FINAL set of 14-20 mutually exclusive intent categories.
Merge only true duplicates. Do NOT merge two categories just to reach a smaller
number — a larger, sharper set is better than a small blurry one. No catch-all.

PROPOSALS:
${proposals.map((c) => `- ${c.name}: ${c.test || ''}`).join('\n')}

Respond ONLY with JSON: {"categories":[{"name":"...","test":"..."}]}` }], 'medium')
  return parseJson(out).categories || []
}

// ---------------------------------------------------------------------------
// placement
// ---------------------------------------------------------------------------

/**
 * The placements already answered, so a re-run converges instead of re-asking.
 *
 * Two sources, in order: the local checkpoint, then the GRAPH ITSELF — every
 * existing `aggregates` edge IS a placement decision, and re-asking the model
 * for 793 answers it already gave is exactly the redundancy CLAUDE.md warns
 * about in background classifiers ("the skip condition must cover 'already
 * answered'"). Seeding from the graph makes a re-run against an already-written
 * spine cost zero model calls and add zero edges.
 *
 * An insight aggregated by an Intent that is NOT in the current taxonomy is
 * left unplaced rather than dropped — the taxonomy changed under it, and that
 * is a question for the model, not something to silently keep.
 */
async function loadCheckpoint(categories) {
  if (has('--fresh')) return {}
  if (existsSync(CKPT)) {
    try { return JSON.parse(readFileSync(CKPT, 'utf8')) } catch { /* fall through to the graph */ }
  }
  const place = {}
  const intents = (await api('GET', '/api/v1/entities?ontologyClass=Intent&limit=200')) || []
  const indexOf = new Map(categories.map((c, i) => [c.name, i + 1]))
  let seeded = 0
  for (const intent of intents) {
    const n = indexOf.get(intent.name)
    if (!n) continue
    const rels = (await api('GET', `/api/v1/relations?from=${encodeURIComponent(intent.id)}`)) || []
    for (const r of rels) {
      if (((r.attributes || {}).type ?? r.relationType ?? r.type) !== 'aggregates') continue
      const target = r.target ?? r.to
      if (target) { place[target] = n; seeded++ }
    }
  }
  if (seeded) console.log(`seeded ${seeded} placement(s) from existing aggregates edges`)
  return place
}

function saveCheckpoint(place) {
  mkdirSync(dirname(CKPT), { recursive: true })
  writeFileSync(CKPT, JSON.stringify(place, null, 1))
}

/**
 * Assign each insight to one category, or 0 for none.
 *
 * "None" is a real answer and the prompt says so. A placement step that cannot
 * decline is how a catch-all category gets built by accident.
 */
async function placeAll(insights, categories) {
  const menu = categories.map((c, i) => `${i + 1}. ${c.name} — ${c.test}`).join('\n')
  const place = await loadCheckpoint(categories)
  const todo = insights.filter((o) => !(o.id in place))
  console.log(`placing ${todo.length} insight(s)${todo.length < insights.length ? ` (${insights.length - todo.length} from checkpoint)` : ''}`)

  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH)
    const list = batch.map((o, k) => `${k + 1}. ${o.title} :: ${o.summary.slice(0, 150)}`).join('\n')
    const out = await complete([{ role: 'user', content:
`Assign each record to exactly ONE category by number, or 0 if none genuinely fits.
Choosing 0 is a correct answer — do NOT stretch a category.

CATEGORIES:
${menu}

RECORDS:
${list}

Respond ONLY with JSON: {"a":[...]}  (${batch.length} numbers)` }], 'small')
    let answers = []
    try { answers = parseJson(out).a || [] } catch { /* leave unparsed, marked -1 */ }
    batch.forEach((o, k) => { place[o.id] = Number.isInteger(answers[k]) ? answers[k] : -1 })
    saveCheckpoint(place)
    process.stdout.write(`\r  ${Math.min(i + BATCH, todo.length)}/${todo.length}`)
  }
  if (todo.length) process.stdout.write('\n')
  return place
}

// ---------------------------------------------------------------------------
// write
// ---------------------------------------------------------------------------

async function applySpine(plan) {
  // Existing nodes by name, so a re-run rebinds instead of duplicating.
  const existing = new Map()
  for (const e of (await api('GET', '/api/v1/entities?ontologyClass=Intent&limit=200')) || []) {
    existing.set(e.name, e.id)
  }
  console.log(`existing Intent nodes: ${existing.size}`)

  let created = 0, edges = 0, skipped = 0, failed = 0
  for (const cat of plan) {
    let id = existing.get(cat.name)
    if (!id) {
      const e = await api('POST', '/api/v1/entities', {
        name: cat.name,
        entityType: 'Intent',
        ontologyClass: 'Intent',
        layer: 'pattern',
        description: cat.test,
        metadata: {
          test: cat.test,
          summary: cat.name,
          // NO insightCount. A denormalised count goes stale the moment an edge
          // is added — this script's own first --apply added 14 edges and left
          // four intents claiming the old number — and nothing reads it: the
          // viewer counts `aggregates` edges, which is the truth. Same trap as
          // the codeEvidence field above, one size down.
          derivationRunId: RUN,
          team: PROJECT,
          project: PROJECT,
        },
      })
      id = e.id
      created++
    }

    // Read the shape GET returns, not the shape POST takes. See the header.
    const have = new Set(((await api('GET', `/api/v1/relations?from=${encodeURIComponent(id)}`)) || [])
      .filter((r) => ((r.attributes || {}).type ?? r.relationType ?? r.type) === 'aggregates')
      .map((r) => r.target ?? r.to))

    for (const iid of cat.insightIds) {
      if (have.has(iid)) { skipped++; continue }
      try {
        await api('POST', '/api/v1/relations', {
          from: id, to: iid, relationType: 'aggregates', metadata: { derivationRunId: RUN },
        })
        edges++
      } catch (err) {
        failed++
        if (failed < 4) console.log(`  edge failed: ${String(err.message).slice(0, 120)}`)
      }
    }
  }

  console.log(`\nintent nodes created ${created} · aggregates edges added ${edges} · already present ${skipped} · failed ${failed}`)
  const stats = await api('GET', '/api/v1/stats')
  console.log(`graph now: nodes ${stats.nodeCount} edges ${stats.edgeCount} orphans ${stats.orphanCount} dupEdges ${stats.duplicateEdgeCount ?? 'n/a'}`)
  console.log('revert: DELETE the Intent entities and their aggregates edges. metadata.parentId was never written.')
}

// ---------------------------------------------------------------------------

async function main() {
  const insights = await loadInsights()
  console.log('')
  if (insights.length === 0) {
    console.error('No insights in scope — is obs-api up, and is --project right?')
    process.exitCode = 1
    return
  }

  if (DERIVE) {
    const categories = await deriveTaxonomy(insights)
    const out = resolve(REPO, `config/intent-taxonomy.${RUN}.json`)
    writeFileSync(out, `${JSON.stringify({ derivedAt: new Date().toISOString().slice(0, 10), categories }, null, 2)}\n`)
    console.log(`\n${categories.length} categories written to ${out}`)
    console.log('Nothing was written to the graph. Compare against the committed taxonomy before adopting.')
    return
  }

  const taxonomy = JSON.parse(readFileSync(TAXONOMY_PATH, 'utf8'))
  const categories = taxonomy.categories || []
  console.log(`taxonomy: ${categories.length} categories from ${TAXONOMY_PATH}`)

  const place = await placeAll(insights, categories)

  const byCat = new Map()
  let none = 0, unparsed = 0
  for (const o of insights) {
    const a = place[o.id]
    if (a === -1 || a === undefined) { unparsed++; continue }
    if (a === 0) { none++; continue }
    const name = categories[a - 1]?.name
    if (!name) { unparsed++; continue }
    if (!byCat.has(name)) byCat.set(name, [])
    byCat.get(name).push(o)
  }

  const plan = [...byCat]
    .sort((x, y) => y[1].length - x[1].length)
    .map(([name, v]) => ({
      name,
      test: categories.find((c) => c.name === name)?.test ?? '',
      insightIds: v.map((o) => o.id),
      sample: v.slice(0, 5).map((o) => o.title),
    }))

  console.log('\n=== intent spine ===')
  for (const cat of plan) {
    console.log(`  ${String(cat.insightIds.length).padStart(4)}  ${cat.name}`)
    if (VERBOSE) for (const t of cat.sample) console.log(`        · ${t.slice(0, 80)}`)
  }
  console.log(`  ${String(none).padStart(4)}  (no category fits)`)
  if (unparsed) console.log(`  ${String(unparsed).padStart(4)}  (unparsed)`)
  console.log(`\ncategories ${plan.length} · largest ${plan[0]?.insightIds.length ?? 0} · homeless ${none} (${((100 * none) / insights.length).toFixed(0)}%)`)

  if (!APPLY) {
    console.log('\nDry run — nothing written. Re-run with --apply to write the spine.')
    return
  }
  console.log('')
  await applySpine(plan)
}

main().catch((err) => {
  console.error(`\nderive-intent-spine failed: ${err.message}`)
  process.exitCode = 1
})
