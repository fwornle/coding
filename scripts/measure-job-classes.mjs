#!/usr/bin/env node
/**
 * P0 of shared job classes (.planning/shared-job-classes.md): is there a STABLE
 * taxonomy of the jobs people hand their coding agents? If two independent
 * derivations from the same corpus disagree, there is nothing worth sharing
 * with a group, and P1+ should not be built.
 *
 * WHAT IS MEASURED
 *
 *   1. Corpus: the human prompts of the last N days from the LSL of one team's
 *      repos (`<repo>/.coding/history/YYYY/MM/*.jsonl`, already redacted): a
 *      team's taxonomy is built from that team's work, never from every repo on
 *      the machine (--team; default the teams the current repo belongs to). Harness
 *      noise is dropped: task notifications, slash-command expansions,
 *      continuation summaries, local-command caveats, sub-agent prompts. Pasted
 *      blocks and image references are reduced to a marker. Prompts shorter than
 *      --min-chars after that ("yes", "merged") are dropped: they are turns of a
 *      job, not jobs, and in routing they inherit the band their turn started with.
 *   2. Split: a fixed held-out set (hash of the text, so reruns pick the same one)
 *      and a derivation pool. No held-out prompt is ever shown to a derivation.
 *   3. Two derivations, A and B, with derive-intent-spine.mjs's recipe: 8 disjoint
 *      samples propose categories, one call consolidates to the cap. A and B use
 *      different seeds, so they see different samples of the pool.
 *   4. The teacher labels the held-out set under A, under B, and under A a second
 *      time (A2). A vs A2 is the labelling noise floor; A vs B is what P0 is about.
 *   5. Agreement. A and B have different label sets, so:
 *        - ARI (adjusted Rand index): mapping-free, chance-corrected.
 *        - kappa after a 1:1 Hungarian matching of B's classes onto A's.
 *        - kappa on shared categories: only items whose A and B labels are both
 *          in a matched pair with Jaccard >= 0.5 (the number intent-spine quoted
 *          as "0.83 on shared categories").
 *   6. Optional student check (--student): leave-one-out KNN over local MiniLM
 *      embeddings of the held-out set, against the A labels. Small and weak, but
 *      it says early whether a cheap classifier can reproduce the teacher at all.
 *   7. Optional LLM students (--students=<model,...>): each named cheap model
 *      labels the held-out set under A, ONE prompt per call as it would at
 *      runtime, through the `bg-job-class-student` route (sent as process
 *      `job-class-student`: the proxy adds the `bg-`), whose model_profiles name
 *      the models it may be asked for. Scored against the teacher's A labels,
 *      and on the items where A and A2 agree (the teacher was sure), with the
 *      teacher's own A-vs-A2 kappa as the ceiling.
 *
 * GATE (from the plan): kappa(A,B) >= 0.70 and no class holding more than 35% of
 * the held-out set. The report states pass/fail; it never rounds a fail up.
 *
 * Every LLM answer is checkpointed under --out, so a rerun resumes rather than
 * re-asking, and a scoring change is re-applied offline (--fresh starts over).
 *
 * WHERE THE OUTPUT LIVES, AND WHAT IS WORTH KEEPING
 *
 *   `<data home>/var/job-classes/<scope>/` (scope = the team ids, or `all`):
 *   machine-local, never committed, because the corpus is your real prompts.
 *   The one durable product is `reference-<taxonomy>.jsonl`, written by every
 *   --taxonomy run: each scored prompt with both teacher passes, and `class` set
 *   where the two agree. It is the fixed set a taxonomy change is re-scored on
 *   (P3's stability check) and what the dashboard's coverage map reads. Labels,
 *   logs and reports are checkpoints of the run that wrote them. What a group
 *   shares (the taxonomy, synthetic examples, scores) goes to the group's repo,
 *   never these files.
 *
 * Usage:
 *   node scripts/measure-job-classes.mjs                 # full P0 run
 *   node scripts/measure-job-classes.mjs --corpus-only   # extract + split, no LLM
 *
 * Options:
 *   --days=<n>           Corpus window (default 28)
 *   --min-chars=<n>      Shortest prompt kept after cleaning (default 25)
 *   --heldout=<n>        Held-out set size (default 300)
 *   --cap=<lo>-<hi>      Consolidated class count (default 14-18)
 *   --batch=<n>          Prompts per labelling call (default 30)
 *   --student            Also run the leave-one-out KNN check
 *   --students=<m,...>   Also score these cheap models as closed-set students: an LLM
 *                        on the bg-job-class-student route, or ollaya:<model> for a
 *                        decision model served by Ollaya (OLLAYA_URL)
 *   --ollaya-concurrency=<n>  Ollaya calls in flight (default 2)
 *   --ollaya-timeout-s=<n>    Seconds before an Ollaya call counts as hung (default 300)
 *   --taxonomy=<file>    Skip the derivations: score a committed taxonomy
 *                        (config/job-classes.yaml) on the checkpointed held-out set
 *   --set=heldout|pool   With --taxonomy: score the held-out set (default; the one
 *                        a hand-written taxonomy is tuned on) or a test set of the
 *                        same size from the derivation pool
 *   --team=<id,...>|all  Whose prompts: the repos of these teams (~/.coding/teams.yaml),
 *                        or every discovered repo. Default: the current repo's teams
 *   --out=<dir>          Output dir (default <data home>/var/job-classes/<scope>)
 *   --fresh              Ignore checkpoints
 *   --help               Show this message
 *
 * Environment:
 *   LLM_CLI_PROXY_URL    default http://localhost:12435   (POST /api/complete)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { createRequire } from 'node:module'

const REPO = process.env.CODING_REPO || resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PROXY = `${(process.env.LLM_CLI_PROXY_URL || 'http://localhost:12435').replace(/\/$/, '')}/api/complete`
const OLLAYA = (process.env.OLLAYA_URL || 'http://localhost:11435').replace(/\/$/, '')

const argv = process.argv.slice(2)
const has = (f) => argv.includes(f)
const opt = (name, dflt) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : dflt
}

if (has('--help') || has('-h')) {
  const header = readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]
  console.log(header.slice(header.indexOf(' * Usage:')).replace(/^ \* ?/gm, '').trimEnd())
  process.exit(0)
}

const DAYS = Number(opt('days', 28))
const MIN_CHARS = Number(opt('min-chars', 25))
const HELDOUT = Number(opt('heldout', 300))
const [CAP_LO, CAP_HI] = opt('cap', '14-18').split('-').map(Number)
const BATCH = Number(opt('batch', 30))
const require = createRequire(import.meta.url)
const teamsConfig = require('../lib/teams/config.cjs')
const { varDir } = require('../lib/paths/data-home.cjs')
const { defaultTeamsFor, parseTeams } = await import('../lib/teams/scope.mjs')
const { isHarnessNoise } = await import('../lib/job-classes/noise.mjs')

// The corpus scope: whose prompts a taxonomy is built and scored on.
const TEAMS = opt('team', '') === 'all' ? null : parseTeams(opt('team', '') || defaultTeamsFor(process.cwd()))
if (TEAMS && !TEAMS.length) throw new Error('not in a repo, so no team to scope the corpus to: pass --team=<id> or --team=all')
const SCOPE = TEAMS ? TEAMS.join('+') : 'all'
const OUT = opt('out', '') ? resolve(REPO, opt('out', '')) : join(varDir(), 'job-classes', SCOPE)
const FRESH = has('--fresh')
const GATE = { kappa: 0.7, maxShare: 0.35 }

mkdirSync(OUT, { recursive: true })
const outFile = (name) => join(OUT, name)
const readCk = (name) => (!FRESH && existsSync(outFile(name)) ? JSON.parse(readFileSync(outFile(name), 'utf8')) : null)
const writeJson = (name, v) => writeFileSync(outFile(name), JSON.stringify(v, null, 2))

// ---------------------------------------------------------------------------
// transport (same contract as derive-intent-spine.mjs)
// ---------------------------------------------------------------------------

async function complete(messages, { process: proc = 'job-class-teacher', model, complexity = 'high' } = {}, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(PROXY, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // The route picks the model; `model` is read only where the route's
        // model_profiles list it (bg-job-class-student).
        body: JSON.stringify({ process: proc, messages, complexity, ...(model ? { model } : {}) }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 160)}`)
      const j = await res.json()
      return { content: j.content, model: `${j.provider}/${j.model}`, latencyMs: j.latencyMs, tokens: j.tokens }
    } catch (err) {
      if (i === tries - 1) throw err
      await new Promise((r) => setTimeout(r, 3000 * (i + 1)))
    }
  }
}

function parseJson(text) {
  const s = String(text).trim().replace(/^```(json)?/i, '').replace(/```$/, '').trim()
  const ob = s.indexOf('{'), obEnd = s.lastIndexOf('}')
  const ar = s.indexOf('['), arEnd = s.lastIndexOf(']')
  const useArray = ar !== -1 && (ob === -1 || ar < ob)
  return JSON.parse(useArray ? s.slice(ar, arEnd + 1) : s.slice(ob, obEnd + 1))
}

/**
 * complete() + parseJson(), re-asking when the reply is not valid JSON. A model
 * that writes an unescaped quote inside a category test is a formatting slip, not
 * an answer worth aborting a whole run over (it ended the first capped P0 run).
 */
async function completeJson(messages, route, tries = 3) {
  for (let i = 0; ; i++) {
    const r = await complete(messages, route)
    try { return { ...r, json: parseJson(r.content) } } catch (err) {
      if (i === tries - 1) throw err
      console.log(`  unparseable reply (${err.message}), asking again`)
    }
  }
}

/** Run `fn` over `items` with at most `n` in flight, keeping order. */
async function pool(items, n, fn) {
  const out = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i) }
  }))
  return out
}

// ---------------------------------------------------------------------------
// corpus
// ---------------------------------------------------------------------------

export function cleanPrompt(raw) {
  let t = String(raw || '')
  t = t.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, ' ')
  t = t.replace(/<pasted_content[^>]*>([\s\S]*?)<\/pasted_content>/g, (_, body) => ` [pasted ${body.length} chars] `)
  t = t.replace(/\[Image[^\]]*\]/g, ' [image] ')
  return t.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
}

/** The repos whose LSL is read: every discovered repo in one of TEAMS (all of them for --team=all). */
function discoveredRepos() {
  const candidates = [
    join(homedir(), '.coding', 'data', 'coding', 'var', 'projects.json'),
    join(homedir(), '.coding', 'var', 'projects.json'),
  ]
  const f = candidates.find((c) => existsSync(c))
  const repos = f ? JSON.parse(readFileSync(f, 'utf8')).repos || [] : [{ path: REPO, name: 'coding' }]
  if (!TEAMS) return repos
  const doc = teamsConfig.loadTeams({ codingRoot: REPO })
  const unknown = TEAMS.filter((t) => !doc.teams[t])
  if (unknown.length) throw new Error(`unknown team ${unknown.join(', ')} (teams: ${Object.keys(doc.teams).join(', ')})`)
  return repos.filter((r) => {
    try { return teamsConfig.teamsOf(r.path, { teamsDoc: doc }).some((t) => TEAMS.includes(t)) } catch { return false }
  })
}

function extractCorpus() {
  const since = Date.now() - DAYS * 864e5
  const rows = []
  const seen = new Set()
  const dropped = { noise: 0, short: 0, subagent: 0, duplicate: 0 }
  for (const repo of discoveredRepos()) {
    const base = join(repo.path, '.coding', 'history')
    if (!existsSync(base)) continue
    for (const year of readdirSync(base).filter((d) => /^\d{4}$/.test(d))) {
      for (const month of readdirSync(join(base, year)).filter((d) => /^\d{2}$/.test(d))) {
        const dir = join(base, year, month)
        for (const f of readdirSync(dir).filter((x) => x.endsWith('.jsonl'))) {
          const fp = join(dir, f)
          if (statSync(fp).mtimeMs < since) continue
          let agent = '?'
          for (const line of readFileSync(fp, 'utf8').split('\n')) {
            if (!line) continue
            let o
            try { o = JSON.parse(line) } catch { continue }
            if (o.customType === 'lsl.promptSet') { agent = o.data?.agent || '?'; continue }
            if (o.type !== 'message' || o.message?.role !== 'user') continue
            if (Date.parse(o.timestamp) < since) continue
            const c = o.message.content
            const raw = (Array.isArray(c) ? c.map((b) => b?.text || '').join('\n') : String(c || '')).trim()
            if (!raw) continue
            if (agent === 'sub-agent') { dropped.subagent++; continue }
            if (isHarnessNoise(raw)) { dropped.noise++; continue }
            const text = cleanPrompt(raw)
            if (text.replace(/\[(image|pasted \d+ chars)\]/g, '').trim().length < MIN_CHARS) { dropped.short++; continue }
            const key = text.toLowerCase()
            if (seen.has(key)) { dropped.duplicate++; continue }
            seen.add(key)
            rows.push({
              id: createHash('sha1').update(text).digest('hex').slice(0, 12),
              ts: o.timestamp, agent, repo: repo.name, session: f.replace(/\.jsonl$/, ''),
              text: text.slice(0, 800),
            })
          }
        }
      }
    }
  }
  return { rows, dropped }
}

// ---------------------------------------------------------------------------
// derivation (derive-intent-spine.mjs's recipe, reworded for jobs)
// ---------------------------------------------------------------------------

const RULES = `
A category names a KIND OF JOB: what the person asked the coding agent to DO,
judged from the request alone. Two prompts belong together when doing them takes
the same kind of work, whatever part of the system they are about.

FORBIDDEN as category names:
 - repository, module, service or technology names (glass, Docker, dashboard, proxy)
 - structural labels (Architecture, Configuration, Integration, Utilities)
 - unfalsifiable catch-alls (Misc, Other, General requests, Follow-ups)

EXCLUDABILITY RULE — the most important one. Every category must be able to
REJECT prompts. Write its test so a reader can say "no, that one does not belong
here". Do NOT broaden a category with a trailing clause such as "... and related
tasks". Prefer TWO precise categories over one broad one.`

function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffled(arr, seed) {
  const rnd = mulberry32(seed)
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] }
  return a
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48)

async function deriveTaxonomy(poolRows, seed, tag) {
  const ck = readCk(`taxonomy-${tag}.json`)
  if (ck) { console.log(`taxonomy ${tag}: from checkpoint (${ck.classes.length} classes)`); return ck }
  const SAMPLES = 8
  const order = shuffled(poolRows, seed)
  const proposals = []
  for (let s = 0; s < SAMPLES; s++) {
    const batch = order.filter((_, i) => i % SAMPLES === s).slice(0, 60)
    const list = batch.map((r, i) => `${i + 1}. ${r.text.slice(0, 300).replace(/\s+/g, ' ')}`).join('\n')
    const { json } = await completeJson([{ role: 'user', content:
`Below are ${batch.length} requests real people typed to an AI coding agent.
${RULES}

Propose 10-18 job categories that would cover these requests.

REQUESTS:
${list}

Respond ONLY with JSON: {"categories":[{"name":"...","test":"one sentence: what belongs AND what is excluded"}]}` }])
    const got = json.categories || []
    proposals.push(...got)
    console.log(`  derive ${tag} ${s + 1}/${SAMPLES}  (+${got.length})`)
  }
  const { json, model } = await completeJson([{ role: 'user', content:
`These are overlapping job-category proposals from eight independent samples of the same corpus.
${RULES}

Consolidate into a FINAL set of ${CAP_LO}-${CAP_HI} mutually exclusive job categories.
Merge only true duplicates. Do NOT merge two categories just to reach a smaller
number — a larger, sharper set is better than a small blurry one. No catch-all.

PROPOSALS:
${proposals.map((c) => `- ${c.name}: ${c.test || ''}`).join('\n')}

Respond ONLY with JSON: {"categories":[{"name":"...","test":"..."}]}` }])
  let cats = json.categories || []
  // The consolidation prompt names the cap, and the model does not obey it: the
  // first P0 run asked for 14-18 and got 22 and 30, which is the over-granular
  // range intent-spine measured as unstable. So the cap is enforced here, by
  // asking for merges until the set fits, and the rounds are recorded.
  const merges = []
  for (let round = 0; cats.length > CAP_HI && round < 3; round++) {
    const before = cats.length
    const { json: merged } = await completeJson([{ role: 'user', content:
`This job taxonomy has ${before} categories; it must have at most ${CAP_HI}.
${RULES}

Merge the closest pairs until at most ${CAP_HI} remain. A merged category gets a
test that admits both and still rejects everything else. Keep every other
category exactly as it is.

CATEGORIES:
${cats.map((c) => `- ${c.name}: ${c.test || ''}`).join('\n')}

Respond ONLY with JSON: {"categories":[{"name":"...","test":"..."}]}` }])
    cats = merged.categories || cats
    merges.push({ round, before, after: cats.length })
    console.log(`  cap ${tag}: ${before} -> ${cats.length}`)
  }
  if (cats.length > CAP_HI || cats.length < CAP_LO) console.log(`  cap ${tag}: ${cats.length} classes is OUTSIDE ${CAP_LO}-${CAP_HI}`)
  const classes = cats.map((c) => ({ id: slug(c.name), name: c.name, test: c.test }))
  const tax = { tag, seed, model, derivedAt: new Date().toISOString(), proposals: proposals.length, merges, classes }
  writeJson(`taxonomy-${tag}.json`, tax)
  console.log(`taxonomy ${tag}: ${classes.length} classes (${model})`)
  return tax
}

// ---------------------------------------------------------------------------
// labelling
// ---------------------------------------------------------------------------

async function labelSet(rows, tax, tag) {
  const ck = readCk(`labels-${tag}.json`)
  if (ck && ck.n === rows.length) { console.log(`labels ${tag}: from checkpoint`); return ck.labels }
  const ids = new Set(tax.classes.map((c) => c.id))
  const catalogue = tax.classes.map((c) => `- ${c.id}: ${c.test}`).join('\n')
  const batches = []
  for (let i = 0; i < rows.length; i += BATCH) batches.push(rows.slice(i, i + BATCH))
  const results = await pool(batches, 3, async (batch, b) => {
    const list = batch.map((r, i) => `${i + 1}. ${r.text.slice(0, 500).replace(/\s+/g, ' ')}`).join('\n')
    const { json } = await completeJson([{ role: 'user', content:
`Assign each request below to exactly ONE job category, by the category's test.
If no category's test admits it, answer "none" — do not force a fit.

CATEGORIES:
${catalogue}

REQUESTS:
${list}

Respond ONLY with JSON: {"labels":[{"i":1,"class":"<category id or none>"}]}` }])
    const got = json.labels || []
    const byI = new Map(got.map((g) => [Number(g.i), String(g.class || '').trim()]))
    console.log(`  label ${tag} ${b + 1}/${batches.length}`)
    return batch.map((_, i) => {
      const c = byI.get(i + 1)
      return ids.has(c) ? c : (c === 'none' ? 'none' : 'invalid')
    })
  })
  const labels = results.flat()
  writeJson(`labels-${tag}.json`, { tag, taxonomy: tax.tag, n: rows.length, labels })
  return labels
}

/**
 * The one-prompt classification request, shared by teacher and students so the
 * two only ever differ in the model. A committed taxonomy adds its examples, its
 * "none" rule and its precedence order; a derived one has only the tests.
 */
function classifyMessages(tax, text) {
  const catalogue = tax.classes.map((c) => [`- ${c.id}: ${c.test}`,
    ...(c.examples || []).map((e) => `    e.g. ${e}`)].join('\n')).join('\n')
  const request = text.slice(0, 500).replace(/\s+/g, ' ')
  // A committed taxonomy carries its own prompt, which the proxy's shadow tagger
  // renders the same way (proxy-bridge/job-class.mjs in rapid-llm-proxy).
  if (tax.prompt) {
    const fill = { none: tax.none, precedence: (tax.precedence || []).join(' > '), catalogue, request }
    return [{ role: 'user', content: tax.prompt.replace(/\{(none|precedence|catalogue|request)\}/g, (_, k) => fill[k]) }]
  }
  const none = tax.none || 'If no category\'s test admits it, answer "none" — do not force a fit.'
  const order = tax.precedence ? `\nIf more than one category fits, take the one that comes first in: ${tax.precedence.join(' > ')}.` : ''
  return [{ role: 'user', content:
`Assign the request below to exactly ONE job category, by the category's test.
${none}${order}

CATEGORIES:
${catalogue}

REQUEST:
${text.slice(0, 500).replace(/\s+/g, ' ')}

Respond ONLY with JSON: {"class":"<category id or none>"}` }]
}

/**
 * A model labels the held-out set under `tax`, one prompt per call: the runtime
 * shape, where every prompt is classified as it arrives. `route` is the proxy
 * process plus, for a student, the model its route's model_profiles name. An
 * answer that still will not parse after the re-asks counts as 'invalid'.
 */
async function singleLabels(rows, tax, route, tag) {
  const ck = readCk(`labels-${tag}.json`)
  if (ck && ck.n === rows.length) { console.log(`labels ${tag}: from checkpoint`); return ck }
  const ids = new Set(tax.classes.map((c) => c.id))
  const served = new Set()
  const latency = []
  const confidences = new Array(rows.length).fill(null)
  // A slow student (a decision model on a laptop CPU) saves its progress as it
  // goes, so a run that is stopped resumes where it was instead of starting over.
  const partialName = `labels-${tag}.partial.json`
  const partial = route.ollaya ? (readCk(partialName) || { labels: {}, confidences: {}, latency: [] }) : null
  if (partial && Object.keys(partial.labels).length) console.log(`labels ${tag}: resuming, ${Object.keys(partial.labels).length} already labelled`)
  if (partial) for (const v of partial.latency) latency.push(v)
  let done = partial ? Object.keys(partial.labels).length : 0
  const labels = await pool(rows, route.concurrency || 6, async (r, i) => {
    if (partial && partial.labels[i] != null) { confidences[i] = partial.confidences[i] ?? null; served.add(`ollaya/${route.ollaya}`); return partial.labels[i] }
    let c = 'invalid'
    try {
      let got
      if (route.ollaya) {
        let out
        try { out = await decide(tax, r.text, route.ollaya) } catch (err) {
          console.log(`  ${tag}: item ${i}: ${err.message}, asking once more`)
          out = await decide(tax, r.text, route.ollaya)
        }
        served.add(out.model)
        if (Number.isFinite(out.latencyMs)) latency.push(Math.round(out.latencyMs))
        if (Number.isFinite(out.confidence)) confidences[i] = out.confidence
        got = out.label
      } else {
        const out = await completeJson(classifyMessages(tax, r.text), route)
        served.add(out.model)
        if (Number.isFinite(out.latencyMs)) latency.push(out.latencyMs)
        got = String(out.json.class || '').trim()
      }
      c = ids.has(got) ? got : (got === 'none' ? 'none' : 'invalid')
    } catch (err) { console.log(`  ${tag}: ${err.message}`) }
    if (partial) {
      partial.labels[i] = c
      partial.confidences[i] = confidences[i]
      if (Number.isFinite(latency.at(-1))) partial.latency = latency.slice()
      if (Object.keys(partial.labels).length % 10 === 0) writeJson(partialName, partial)
    }
    if (++done % 50 === 0) console.log(`  label ${tag} ${done}/${rows.length}`)
    return c
  })
  latency.sort((x, y) => x - y)
  const res = { tag, taxonomy: tax.tag, model: route.model || route.ollaya || null, served: [...served], n: rows.length, labels,
    ...(route.ollaya ? { confidences } : {}),
    latencyMs: { p50: latency[Math.floor(latency.length / 2)], p90: latency[Math.floor(latency.length * 0.9)] } }
  writeJson(`labels-${tag}.json`, res)
  return res
}

const studentRoute = (model) => (model.startsWith('ollaya:')
  ? { ollaya: model.slice('ollaya:'.length), concurrency: Number(opt('ollaya-concurrency', 2)) }
  : { process: 'job-class-student', model, complexity: 'small' })

/**
 * A decision model (Ollaya, the TypeSafe wire) answers a typed `choice` instead
 * of reading a prompt: the classes are its options, each described by its test
 * and examples, "none" is one more option described by the taxonomy's none rule,
 * and the precedence order is the question's instructions. The state is the
 * same bounded request text an LLM student is given. It returns calibrated
 * probabilities, kept as `confidence` so the report can show what a threshold
 * buys.
 */
async function decide(tax, text, model) {
  const criteria = {}
  for (const c of tax.classes) criteria[c.id] = c.test + (c.examples?.length ? ` Examples: ${c.examples.join(' | ')}` : '')
  criteria.none = tax.none || 'No job at all: a test message, trivia, or a fragment no class can be read from.'
  const instructions = 'What kind of job does this request to a coding agent hand over?'
    + (tax.precedence ? ` If more than one class fits, take the one that comes first in: ${tax.precedence.join(' > ')}.` : '')
  const res = await fetch(`${OLLAYA}/api/decide`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    // A 4B model on a laptop CPU takes 20-60 s; a request that has not answered
    // in five minutes is hung (an unbounded one stalled a run for ten hours).
    signal: AbortSignal.timeout(Number(opt('ollaya-timeout-s', 300)) * 1000),
    body: JSON.stringify({ model, state: text.slice(0, 500).replace(/\s+/g, ' '), questions: { job_class: { type: 'choice', instructions, criteria } } }),
  })
  if (!res.ok) throw new Error(`ollaya HTTP ${res.status} ${(await res.text()).slice(0, 160)}`)
  const j = await res.json()
  const a = j.answers?.job_class
  return { label: String(a?.choice || ''), confidence: a?.confidence, model: `ollaya/${j.model || model}`, latencyMs: j.eval_duration ? j.eval_duration / 1e6 : undefined }
}

/** Score each student's labels against the teacher's `ref`, with `ref2` (a second teacher pass) for "sure". */
async function scoreStudents(rows, tax, ref, ref2, tagOf) {
  const sure = ref.map((x, i) => (x === ref2[i] ? i : -1)).filter((i) => i >= 0)
  const list = []
  for (const model of opt('students', '').split(',').map((m) => m.trim()).filter(Boolean)) {
    const st = await singleLabels(rows, tax, studentRoute(model), tagOf(model))
    const l = st.labels
    const both = l.map((x, i) => (x !== 'none' && ref[i] !== 'none' ? i : -1)).filter((i) => i >= 0)
    list.push({
      model, served: st.served, latencyMs: st.latencyMs,
      kappa: cohenKappa(ref, l),
      accuracy: l.filter((x, i) => x === ref[i]).length / l.length,
      kappaSure: cohenKappa(sure.map((i) => ref[i]), sure.map((i) => l[i])),
      accuracySure: sure.filter((i) => l[i] === ref[i]).length / sure.length,
      accuracyCommitted: both.filter((i) => l[i] === ref[i]).length / both.length,
      none: l.filter((x) => x === 'none').length / l.length,
      invalid: l.filter((x) => x === 'invalid').length,
      // A decision model's confidence as an abstain threshold: at each level, the
      // share of turns it would label and its agreement with the teacher on those.
      ...(st.confidences ? {
        thresholds: [0.5, 0.7, 0.9].map((t) => {
          const kept = st.confidences.map((c, i) => (c != null && c >= t ? i : -1)).filter((i) => i >= 0)
          return { t, coverage: kept.length / l.length, accuracy: kept.length ? kept.filter((i) => l[i] === ref[i]).length / kept.length : NaN }
        }),
      } : {}),
    })
  }
  return { sureCoverage: sure.length / rows.length, list }
}

function studentTable(st, ceiling) {
  return [
    `Reference: the teacher's labels. "Sure" = the ${pct(st.sureCoverage)} of items where the teacher gave the same label twice. "Both commit" = items where neither answered none. Ceiling: the teacher's own kappa between its two passes, ${f3(ceiling)}.`, '',
    '| Student | Served by | kappa vs teacher | agree | kappa (sure) | agree (sure) | agree (both commit) | none | invalid | p50 / p90 ms |', '|---|---|---|---|---|---|---|---|---|---|',
    ...st.list.map((x) => `| ${x.model} | ${x.served.join(', ')} | ${f3(x.kappa)} | ${pct(x.accuracy)} | ${f3(x.kappaSure)} | ${pct(x.accuracySure)} | ${pct(x.accuracyCommitted)} | ${pct(x.none)} | ${x.invalid} | ${x.latencyMs.p50 ?? 'n/a'} / ${x.latencyMs.p90 ?? 'n/a'} |`),
    ...(st.list.some((x) => x.thresholds) ? ['',
      'Decision models only: labelling a turn only when the model\'s confidence reaches the threshold (coverage = share of turns labelled; agree = with the teacher, on those).', '',
      '| Student | ≥ 0.5: coverage / agree | ≥ 0.7: coverage / agree | ≥ 0.9: coverage / agree |', '|---|---|---|---|',
      ...st.list.filter((x) => x.thresholds).map((x) => `| ${x.model} | ${x.thresholds.map((h) => `${pct(h.coverage)} / ${Number.isFinite(h.accuracy) ? pct(h.accuracy) : 'n/a'}`).join(' | ')} |`)] : []),
  ]
}

// ---------------------------------------------------------------------------
// agreement
// ---------------------------------------------------------------------------

function cohenKappa(a, b) {
  const n = a.length
  if (!n) return NaN
  let agree = 0
  const pa = new Map(), pb = new Map()
  for (let i = 0; i < n; i++) {
    if (a[i] === b[i]) agree++
    pa.set(a[i], (pa.get(a[i]) || 0) + 1)
    pb.set(b[i], (pb.get(b[i]) || 0) + 1)
  }
  const po = agree / n
  let pe = 0
  for (const [k, v] of pa) pe += (v / n) * ((pb.get(k) || 0) / n)
  return pe === 1 ? 1 : (po - pe) / (1 - pe)
}

function adjustedRand(a, b) {
  const n = a.length
  const c2 = (x) => (x * (x - 1)) / 2
  const cell = new Map(), ra = new Map(), rb = new Map()
  for (let i = 0; i < n; i++) {
    const k = `${a[i]}\u0000${b[i]}`
    cell.set(k, (cell.get(k) || 0) + 1)
    ra.set(a[i], (ra.get(a[i]) || 0) + 1)
    rb.set(b[i], (rb.get(b[i]) || 0) + 1)
  }
  const sumCell = [...cell.values()].reduce((s, v) => s + c2(v), 0)
  const sumA = [...ra.values()].reduce((s, v) => s + c2(v), 0)
  const sumB = [...rb.values()].reduce((s, v) => s + c2(v), 0)
  const expected = (sumA * sumB) / c2(n)
  const max = (sumA + sumB) / 2
  return max === expected ? 1 : (sumCell - expected) / (max - expected)
}

/** Hungarian algorithm on a square cost matrix; returns assignment row -> col. */
function hungarian(cost) {
  const n = cost.length
  const u = new Array(n + 1).fill(0), v = new Array(n + 1).fill(0)
  const p = new Array(n + 1).fill(0), way = new Array(n + 1).fill(0)
  for (let i = 1; i <= n; i++) {
    p[0] = i
    let j0 = 0
    const minv = new Array(n + 1).fill(Infinity)
    const used = new Array(n + 1).fill(false)
    do {
      used[j0] = true
      const i0 = p[j0]
      let delta = Infinity, j1 = 0
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j]
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0 }
        if (minv[j] < delta) { delta = minv[j]; j1 = j }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) { u[p[j]] += delta; v[j] -= delta } else minv[j] -= delta
      }
      j0 = j1
    } while (p[j0] !== 0)
    do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1 } while (j0)
  }
  const assign = new Array(n).fill(-1)
  for (let j = 1; j <= n; j++) if (p[j]) assign[p[j] - 1] = j - 1
  return assign
}

/** Match B's classes 1:1 onto A's by co-occurrence; report the pairs and their Jaccard. */
function matchClasses(a, b) {
  const la = [...new Set(a)], lb = [...new Set(b)]
  const n = Math.max(la.length, lb.length)
  const count = Array.from({ length: n }, () => new Array(n).fill(0))
  for (let i = 0; i < a.length; i++) count[la.indexOf(a[i])][lb.indexOf(b[i])]++
  const max = Math.max(...count.flat())
  const assign = hungarian(count.map((row) => row.map((c) => max - c)))
  const pairs = []
  const mapB = new Map()
  for (let r = 0; r < la.length; r++) {
    const c = assign[r]
    if (c < 0 || c >= lb.length || count[r][c] === 0) continue
    const inA = a.filter((x) => x === la[r]).length
    const inB = b.filter((x) => x === lb[c]).length
    const both = count[r][c]
    pairs.push({ a: la[r], b: lb[c], both, inA, inB, jaccard: both / (inA + inB - both) })
    mapB.set(lb[c], la[r])
  }
  return { pairs: pairs.sort((x, y) => y.both - x.both), mapB }
}

function distribution(labels) {
  const m = new Map()
  for (const l of labels) m.set(l, (m.get(l) || 0) + 1)
  return [...m.entries()].sort((x, y) => y[1] - x[1]).map(([cls, n]) => ({ cls, n, share: n / labels.length }))
}

// ---------------------------------------------------------------------------
// student (optional)
// ---------------------------------------------------------------------------

async function studentLoo(rows, labels, k = 5) {
  const { EmbeddingModel, FlagEmbedding } = await import('fastembed')
  const { normalizeVector, cosineSimilarityNormalized } = await import('./lib/prompt-classifier-knn.mjs')
  const embedder = await FlagEmbedding.init({ model: EmbeddingModel.AllMiniLML6V2, cacheDir: resolve(REPO, '.data/fastembed-cache') })
  const vecs = []
  for await (const batch of embedder.embed(rows.map((r) => r.text), 64)) for (const v of batch) vecs.push(normalizeVector(v))
  const keep = labels.map((l, i) => (l !== 'none' && l !== 'invalid' ? i : -1)).filter((i) => i >= 0)
  let correct = 0
  for (const i of keep) {
    const nn = keep.filter((j) => j !== i)
      .map((j) => ({ j, s: cosineSimilarityNormalized(vecs[i], vecs[j]) }))
      .sort((x, y) => y.s - x.s).slice(0, k)
    const vote = new Map()
    for (const { j, s } of nn) vote.set(labels[j], (vote.get(labels[j]) || 0) + s)
    const best = [...vote.entries()].sort((x, y) => y[1] - x[1])[0]?.[0]
    if (best === labels[i]) correct++
  }
  return { k, n: keep.length, accuracy: correct / keep.length }
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

const f3 = (x) => (Number.isFinite(x) ? x.toFixed(3) : 'n/a')
const pct = (x) => `${(x * 100).toFixed(1)}%`

/**
 * The reference set: every prompt a committed taxonomy was scored on, with both
 * teacher passes, and `class` where they agree (null where the teacher itself
 * could not decide: the taxonomy is unclear there). Upserted by prompt id, so the
 * held-out and the test run of one taxonomy version share one file.
 */
function writeReference(name, version, set, rows, t1, t2) {
  const file = outFile(`reference-${name}-v${version}.jsonl`)
  const byId = new Map(existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((r) => [r.id, r]) : [])
  rows.forEach((r, i) => {
    if (t1[i] === 'invalid' || t2[i] === 'invalid') return
    byId.set(r.id, { id: r.id, ts: r.ts, agent: r.agent, repo: r.repo, set, text: r.text, teacher: [t1[i], t2[i]], class: t1[i] === t2[i] ? t1[i] : null })
  })
  writeFileSync(file, [...byId.values()].map((r) => JSON.stringify(r)).join('\n') + '\n')
  const agreed = [...byId.values()].filter((r) => r.class).length
  console.log(`reference set: ${byId.size} prompts, ${agreed} with an agreed class -> ${file}`)
}

/**
 * A committed (hand-written) taxonomy instead of two derivations: nothing to
 * compare it with, so the question is only whether the teacher applies it
 * consistently and whether a cheap student reproduces the teacher. The teacher
 * labels one prompt per call here too, so teacher and students see exactly the
 * same request and differ only in the model.
 */
async function committedRun(heldout, set) {
  const file = resolve(REPO, opt('taxonomy', ''))
  const { load } = await import('js-yaml')
  const raw = load(readFileSync(file, 'utf8'))
  // A team package (lib/job-classes/package.mjs) names itself; config/job-classes.yaml is named by its file.
  const name = raw.name || basename(file).replace(/\.ya?ml$/, '')
  const tax = { tag: `${name}-v${raw.version ?? 0}${set === 'heldout' ? '' : `-${set}`}`, classes: raw.classes, none: raw.none, precedence: raw.precedence , prompt: raw.prompt }
  const ids = tax.classes.map((c) => c.id)
  if (new Set(ids).size !== ids.length) throw new Error(`${file}: duplicate class ids`)
  for (const id of tax.precedence || []) if (!ids.includes(id)) throw new Error(`${file}: precedence names unknown class ${id}`)
  console.log(`taxonomy ${tax.tag}: ${ids.length} classes from ${file}`)
  const teacher = { process: 'job-class-teacher' }
  const t1 = await singleLabels(heldout, tax, teacher, `${tax.tag}-teacher1`)
  const t2 = await singleLabels(heldout, tax, teacher, `${tax.tag}-teacher2`)
  const self = cohenKappa(t1.labels, t2.labels)
  const dist = distribution(t1.labels)
  const maxShare = dist.filter((d) => d.cls !== 'none').at(0)?.share || 0
  const students = opt('students', '') ? await scoreStudents(heldout, tax, t1.labels, t2.labels, (m) => `${tax.tag}-${slug(m)}`) : null
  writeReference(name, raw.version ?? 0, set, heldout, t1.labels, t2.labels)
  writeJson(`report-${tax.tag}.json`, { generatedAt: new Date().toISOString(), taxonomy: tax.tag, n: heldout.length, teacher: t1.served, selfKappa: self, maxShare, dist, students })
  const md = [
    `# Committed taxonomy ${tax.tag} (${new Date().toISOString().slice(0, 10)})`, '',
    `${set === 'heldout' ? `Held-out ${heldout.length} prompts (the P0 set, which the taxonomy was tuned on)` : `Test set: ${heldout.length} prompts from the P0 derivation pool, never read while tuning`}. Teacher: ${t1.served.join(', ')}, one prompt per call, two passes.`, '',
    `| Measure | Value |`, '|---|---|',
    `| teacher pass 1 vs pass 2 (kappa) | ${f3(self)} |`,
    `| "none" (pass 1) | ${pct(t1.labels.filter((x) => x === 'none').length / heldout.length)} |`,
    `| largest class | ${pct(maxShare)} (gate ≤ ${pct(GATE.maxShare)}) |`,
    `| invalid labels | ${t1.labels.concat(t2.labels).filter((x) => x === 'invalid').length} |`,
    ...(students ? ['', '## LLM students', '', ...studentTable(students, self)] : []),
    '', '## Distribution (teacher pass 1)', '', ...dist.map((d) => `- **${d.cls}** ${d.n} (${pct(d.share)})`),
  ].join('\n')
  writeFileSync(outFile(`report-${tax.tag}.md`), md + '\n')
  console.log(`\n${md}\n\nfull report: ${outFile(`report-${tax.tag}.md`)}`)
}

async function main() {
  const { rows, dropped } = extractCorpus()
  const ranked = rows.map((r) => ({ r, h: createHash('sha1').update(`heldout:${r.id}`).digest('hex') }))
    .sort((x, y) => (x.h < y.h ? -1 : 1))
  // A rerun keeps the checkpointed held-out set, read from the checkpointed
  // corpus: the labels in the checkpoints were made for exactly that text, and
  // the window has moved since (the LSL is also rewritten in place, e.g. by a
  // redaction change, so the same prompt can come back with a different id).
  const split = readCk('split.json')
  // A checkpoint written before --team existed was built from every repo.
  if (split && (split.scope || 'all') !== SCOPE) throw new Error(`${OUT} holds a corpus for scope ${split.scope || 'all'}, not ${SCOPE} (use --out or --fresh)`)
  const pinned = split?.heldout
  const oldCorpus = pinned && existsSync(outFile('corpus.jsonl'))
    ? new Map(readFileSync(outFile('corpus.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((r) => [r.id, r]))
    : null
  if (pinned && (!oldCorpus || pinned.some((id) => !oldCorpus.has(id)))) throw new Error('split.json names prompts missing from corpus.jsonl (use --fresh)')
  const heldout = pinned ? pinned.map((id) => oldCorpus.get(id)) : ranked.slice(0, HELDOUT).map((x) => x.r)
  const heldIds = new Set(heldout.map((r) => r.id))
  const derivePool = ranked.filter((x) => !heldIds.has(x.r.id)).map((x) => x.r)
  if (pinned) console.log(`held-out: ${heldout.length} prompts from the checkpointed corpus`)
  else writeFileSync(outFile('corpus.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n')
  writeJson('split.json', { scope: SCOPE, heldout: heldout.map((r) => r.id), pool: derivePool.length })
  const byAgent = {}
  for (const r of rows) byAgent[r.agent] = (byAgent[r.agent] || 0) + 1
  console.log(`scope: ${SCOPE} (${TEAMS ? discoveredRepos().map((r) => r.name).join(', ') : 'every discovered repo'}) -> ${OUT}`)
  console.log(`corpus: ${rows.length} prompts over ${DAYS} days (dropped ${JSON.stringify(dropped)}); held-out ${heldout.length}, pool ${derivePool.length}`)
  console.log(`agents: ${JSON.stringify(byAgent)}`)
  if (has('--corpus-only')) return
  if (opt('taxonomy', '')) {
    if (opt('set', 'heldout') === 'heldout') return committedRun(heldout, 'heldout')
    // The test set for a taxonomy tuned on the held-out set: prompts from the same
    // checkpointed corpus that nobody tuning it has read (the derivations saw
    // them, but the derived taxonomies are not what is scored here).
    if (!oldCorpus) throw new Error('--set=pool needs a checkpointed corpus (run P0 first)')
    const test = [...oldCorpus.values()].filter((r) => !heldIds.has(r.id))
      .map((r) => ({ r, h: createHash('sha1').update(`pool:${r.id}`).digest('hex') }))
      .sort((x, y) => (x.h < y.h ? -1 : 1)).slice(0, HELDOUT).map((x) => x.r)
    return committedRun(test, 'pool')
  }
  if (heldout.length < HELDOUT || derivePool.length < 8 * 30) throw new Error('corpus too small for a P0 run')

  const A = await deriveTaxonomy(derivePool, 1, 'a')
  const B = await deriveTaxonomy(derivePool, 2, 'b')
  const la = await labelSet(heldout, A, 'a')
  const la2 = await labelSet(heldout, A, 'a2')
  const lb = await labelSet(heldout, B, 'b')

  const { pairs, mapB } = matchClasses(la, lb)
  const lbMapped = lb.map((x) => mapB.get(x) ?? `b:${x}`)
  const shared = new Set(pairs.filter((p) => p.jaccard >= 0.5).map((p) => p.a))
  const sharedIdx = la.map((x, i) => (shared.has(x) && shared.has(lbMapped[i]) ? i : -1)).filter((i) => i >= 0)
  const distA = distribution(la), distB = distribution(lb)
  const maxShare = Math.max(distA.filter((d) => d.cls !== 'none').at(0)?.share || 0, distB.filter((d) => d.cls !== 'none').at(0)?.share || 0)

  const metrics = {
    n: heldout.length,
    selfKappaA: cohenKappa(la, la2),
    ariAB: adjustedRand(la, lb),
    kappaAB: cohenKappa(la, lbMapped),
    kappaShared: cohenKappa(sharedIdx.map((i) => la[i]), sharedIdx.map((i) => lbMapped[i])),
    sharedCoverage: sharedIdx.length / heldout.length,
    noneA: la.filter((x) => x === 'none').length / la.length,
    noneB: lb.filter((x) => x === 'none').length / lb.length,
    invalid: [...la, ...la2, ...lb].filter((x) => x === 'invalid').length,
    maxShare,
  }
  if (has('--student')) metrics.student = await studentLoo(heldout, la)
  if (opt('students', '')) metrics.students = await scoreStudents(heldout, A, la, la2, (m) => `student-${slug(m)}`)
  const pass = metrics.kappaAB >= GATE.kappa && metrics.maxShare <= GATE.maxShare
  writeJson('report.json', { generatedAt: new Date().toISOString(), days: DAYS, cap: [CAP_LO, CAP_HI], gate: GATE, pass, corpus: { n: rows.length, dropped, byAgent }, metrics, pairs, distA, distB, teacher: A.model })

  const md = [
    `# P0 — job-class stability (${new Date().toISOString().slice(0, 10)})`, '',
    `Corpus: ${rows.length} prompts, last ${DAYS} days, agents ${JSON.stringify(byAgent)}. Held-out ${heldout.length}. Teacher: ${A.model}. Cap ${CAP_LO}-${CAP_HI}: A=${A.classes.length}, B=${B.classes.length} classes.`, '',
    `**Gate: ${pass ? 'PASS' : 'FAIL'}** — kappa(A,B) ${f3(metrics.kappaAB)} (needs ≥ ${GATE.kappa}), largest class ${pct(maxShare)} (needs ≤ ${pct(GATE.maxShare)}).`, '',
    '| Measure | Value | Reads as |', '|---|---|---|',
    `| kappa A vs A2 (same taxonomy, labelled twice) | ${f3(metrics.selfKappaA)} | labelling noise floor |`,
    `| kappa A vs B (Hungarian-matched) | ${f3(metrics.kappaAB)} | derivation stability, the gate |`,
    `| ARI A vs B | ${f3(metrics.ariAB)} | same, mapping-free |`,
    `| kappa on shared categories (Jaccard ≥ 0.5) | ${f3(metrics.kappaShared)} over ${pct(metrics.sharedCoverage)} of items | the stable core |`,
    `| "none" under A / B | ${pct(metrics.noneA)} / ${pct(metrics.noneB)} | taxonomy coverage |`,
    `| invalid labels | ${metrics.invalid} | teacher format errors |`,
    ...(metrics.student ? [`| student: LOO ${metrics.student.k}-NN on MiniLM vs A labels | ${pct(metrics.student.accuracy)} of ${metrics.student.n} | can a cheap model reproduce the teacher? |`] : []),
    ...(metrics.students ? ['', '## LLM students (taxonomy A, one prompt per call)', '', ...studentTable(metrics.students, metrics.selfKappaA)] : []),
    '', '## A ↔ B class matching', '', '| A | B | both | in A | in B | Jaccard |', '|---|---|---|---|---|---|',
    ...pairs.map((p) => `| ${p.a} | ${p.b} | ${p.both} | ${p.inA} | ${p.inB} | ${p.jaccard.toFixed(2)} |`),
    '', '## Taxonomy A', '', ...A.classes.map((c) => `- **${c.id}** (${distA.find((d) => d.cls === c.id)?.n || 0}) — ${c.test}`),
    '', '## Taxonomy B', '', ...B.classes.map((c) => `- **${c.id}** (${distB.find((d) => d.cls === c.id)?.n || 0}) — ${c.test}`),
  ].join('\n')
  writeFileSync(outFile('report.md'), md + '\n')
  console.log(`\n${md.split('\n').slice(0, 14).join('\n')}\n\nfull report: ${outFile('report.md')}`)
}

main().catch((err) => { console.error(err?.stack || err); process.exit(1) })
