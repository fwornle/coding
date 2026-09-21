#!/usr/bin/env node
/**
 * backfill-insight-parents.mjs — stage 4, applied to the insights that
 * already exist.
 *
 * WHAT THIS IS FOR
 *
 * `ObservationConsolidator._resolveInsightParent` places an insight in the
 * hierarchy at write time, so every insight written from 2026-09-21 onward
 * carries `metadata.parentId` + `metadata.hierarchyLevel`. The ~959 insights
 * written before that do not, and nothing re-writes an insight whose topic
 * has not changed. Hence a backfill.
 *
 * IT APPLIES THE SAME RULE, deliberately duplicated in shape rather than
 * imported: the consolidator reads the store in-process, this reads obs-api
 * over HTTP because km-core's LevelDB is single-owner and obs-api holds it.
 * The rule itself is one sentence — among the SubComponents an insight
 * mentions, take the one with the FEWEST mentions corpus-wide, ties on the
 * lower id — and the tests that pin it live next to the consolidator.
 *
 * Rarity, not popularity, and that was measured rather than assumed. Ranking
 * by most-mentioned put 231 of 767 insights under `LoggingModule` and 44.7%
 * under three parents, filing "MkDocs Documentation — Directory Layout"
 * there too. Rarity spreads the same 767 over 267 parents at 7.2%
 * top-three. A SubComponent named by few insights is one this insight is
 * distinctively about; one named by hundreds says only that it is popular,
 * and stage 5 cannot synthesise a parent description out of 231 unrelated
 * children.
 *
 * WHY A FIELD AND NOT A `contains` EDGE. Stage 2 arbitrated 42 ambiguous
 * rows on "contains = hierarchy member, has_insight = learning artifact"
 * (repair-writer-ontology-class.mjs:180). All insights are currently held by
 * `has_insight` and none by `contains`; writing `contains` here would put
 * hundreds of rows on both sides of a line that script still arbitrates on.
 *
 * DRY RUN BY DEFAULT, matching the repo convention for anything that mutates
 * the graph (`POST /api/insights/compact` does the same). Re-running is safe:
 * an insight that already has a `parentId` is skipped unless --force.
 *
 * ASK FIRST, INFER SECOND (2026-09-21). The rarity rule above is a prior over
 * what an insight is about; it never reads the insight. The mentions
 * classifier does, and now returns a primary subject, so this script asks it
 * and keeps rarity only as the fallback — matching
 * `ObservationConsolidator._resolveInsightParent` on the write path.
 *
 * That costs one LLM call per insight, so a DRY RUN CLASSIFIES A SAMPLE
 * (--sample=25 by default) rather than the whole corpus: enough to see the two
 * rules disagree and judge which is right, without paying for ~800 calls to
 * produce a report. --apply classifies everything it is going to write.
 *
 * Usage:
 *   node scripts/backfill-insight-parents.mjs                  # sampled dry run
 *   node scripts/backfill-insight-parents.mjs --sample=0       # classify all, write nothing
 *   node scripts/backfill-insight-parents.mjs --rarity-only    # no LLM at all
 *   node scripts/backfill-insight-parents.mjs --project=coding
 *   node scripts/backfill-insight-parents.mjs --apply
 *   node scripts/backfill-insight-parents.mjs --apply --force  # re-place existing
 */

import { classifyMentions } from '../src/live-logging/MentionsClassifier.js';

const OBS_API = process.env.OBS_API_URL || 'http://127.0.0.1:12436';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);
const APPLY = args.apply === true || args.apply === 'true';
const FORCE = args.force === true || args.force === 'true';
const PROJECT = typeof args.project === 'string' ? args.project : null;
/**
 * Archived insights are EXCLUDED by default.
 *
 * 638 of the first 767 candidates turned out to be archived — rows the
 * roll-up pass deliberately folded behind one of 8 parents (`rolledUpInto`)
 * and which the viewer hides by default (`hideArchived`). Giving those a
 * SubComponent parent as well would contradict the placement they already
 * have and would hand stage 5 hundreds of hidden children to synthesise a
 * description from. The consolidator's own resolver excludes archived rows
 * from its candidate pool for the same reason.
 */
const INCLUDE_ARCHIVED = args['include-archived'] === true || args['include-archived'] === 'true';
const RARITY_ONLY = args['rarity-only'] === true || args['rarity-only'] === 'true';
/** Insights to classify in a dry run. 0 = all. Ignored with --apply (always all). */
const SAMPLE = args.sample !== undefined ? Number(args.sample) : 25;

const out = (m = '') => process.stdout.write(`${m}\n`);
const die = (m) => { process.stderr.write(`${m}\n`); process.exit(1); };

const clsOf = (e) => e?.ontologyClass ?? e?.entityType;

async function get(pathname) {
  const res = await fetch(`${OBS_API}${pathname}`);
  if (!res.ok) throw new Error(`GET ${pathname} → ${res.status}`);
  return (await res.json()).data ?? [];
}

out('\n=== insight hierarchy backfill (stage 4) ===');
out(`obs-api : ${OBS_API}`);
out(`mode    : ${APPLY ? 'APPLY — writes metadata.parentId' : 'DRY RUN — writes nothing'}${FORCE ? ' · force (re-place rows that already have a parent)' : ''}`);
out(`scope   : ${PROJECT ?? 'every project'}${INCLUDE_ARCHIVED ? ' · INCLUDING archived' : ' · active only (archived excluded)'}`);
out(`rule    : ${RARITY_ONLY ? 'RARITY only (no LLM)' : 'classifier primary subject, rarity as fallback'}\n`);

let entities, relations;
try {
  entities = await get('/api/v1/entities?limit=100000');
  relations = await get('/api/v1/relations?limit=200000');
} catch (e) {
  die(`cannot read the graph: ${e.message}\nIs obs-api running? curl ${OBS_API}/health`);
}

const byId = new Map(entities.map((e) => [e.id, e]));

// Corpus-wide mention tally per SubComponent, and each one's depth.
const tally = new Map();
const levelOf = new Map();
for (const e of entities) {
  if (clsOf(e) !== 'SubComponent') continue;
  tally.set(e.id, 0);
  levelOf.set(e.id, (e.metadata ?? {}).hierarchyLevel);
}
const mentionsByInsight = new Map();
for (const r of relations) {
  const type = r.attributes?.type;
  if (type !== 'mentions') continue;
  if (tally.has(r.target)) tally.set(r.target, tally.get(r.target) + 1);
  if (!mentionsByInsight.has(r.source)) mentionsByInsight.set(r.source, []);
  mentionsByInsight.get(r.source).push(r.target);
}

const insights = entities.filter(
  (e) => clsOf(e) === 'Insight' && (!PROJECT || (e.metadata ?? {}).project === PROJECT),
);
out(`insights       : ${insights.length}`);
out(`subcomponents  : ${tally.size}`);

/** The rarity prior, unchanged — now the fallback rather than the rule. */
function rarityBest(mentioned) {
  let best = null;
  for (const id of mentioned) {
    if (!tally.has(id)) continue;
    const n = tally.get(id);
    // Fewest corpus-wide mentions wins — see the header.
    if (!best || n < best.n || (n === best.n && String(id) < String(best.id))) best = { id, n };
  }
  return best;
}

// The catalogue the classifier picks from, in the shape it expects. Built from
// the entities already fetched rather than via loadMentionCandidates(kmStore),
// because km-core's LevelDB is single-owner and obs-api holds it.
const candidates = entities
  .filter((e) => ['Component', 'SubComponent', 'Detail'].includes(clsOf(e)))
  .map((e) => ({ id: e.id, name: e.name ?? '', description: e.description ?? '' }));

// Pass 1 — everything the rarity prior alone can decide, no LLM involved.
const pending = [];
let alreadyPlaced = 0;
let noCandidate = 0;
let archivedSkipped = 0;
for (const ins of insights) {
  const meta = ins.metadata ?? {};
  if (meta.archivedAt && !INCLUDE_ARCHIVED) { archivedSkipped += 1; continue; }
  if (meta.parentId && !FORCE) { alreadyPlaced += 1; continue; }
  const best = rarityBest(mentionsByInsight.get(ins.id) ?? []);
  if (!best) { noCandidate += 1; continue; }
  pending.push({ insight: ins, rarity: best });
}

out(`archived       : ${archivedSkipped}  (already rolled up — pass --include-archived to place them anyway)`);
out(`already placed : ${alreadyPlaced}${FORCE ? ' (ignored — force)' : ' (skipped)'}`);
out(`no candidate   : ${noCandidate}  (mention no SubComponent — left unplaced)`);
out(`to place       : ${pending.length}\n`);

// Pass 2 — ask the classifier which entity each insight is actually about.
// APPLY classifies every row it will write; a dry run samples, because the
// report is worth one call per sampled insight and not ~800.
const classifyCount = RARITY_ONLY ? 0
  : APPLY ? pending.length
  : (SAMPLE > 0 ? Math.min(SAMPLE, pending.length) : pending.length);

if (classifyCount > 0) {
  out(`classifying    : ${classifyCount} of ${pending.length} insight(s) against ${candidates.length} candidates`);
  out('                 (one LLM call each, haiku band — this is the slow part)\n');
}

let asked = 0;
let classifierAgreed = 0;
let classifierOverrode = 0;
let classifierDeclined = 0;
let classifierFailed = 0;

const plan = [];
for (let i = 0; i < pending.length; i++) {
  const { insight: ins, rarity } = pending[i];
  let chosen = rarity;
  let parentSource = 'rarity';

  if (i < classifyCount) {
    const summary = ins.description || ins.name || '';
    try {
      const { primaryId } = await classifyMentions(summary, candidates);
      asked += 1;
      if (primaryId && tally.has(primaryId)) {
        if (primaryId === rarity.id) classifierAgreed += 1;
        else classifierOverrode += 1;
        chosen = { id: primaryId, n: tally.get(primaryId) };
        parentSource = 'classifier';
      } else {
        // Declined, or named a Component/Detail that cannot be a parent.
        classifierDeclined += 1;
      }
    } catch (e) {
      // Placement is an enrichment; a classifier outage must not cost us the
      // rarity placement we already have.
      classifierFailed += 1;
      process.stderr.write(`  classify failed for ${String(ins.id).slice(0, 8)}: ${e.message}\n`);
    }
    if ((i + 1) % 25 === 0) out(`  ...${i + 1}/${classifyCount}`);
  }

  const parentLevel = levelOf.get(chosen.id);
  plan.push({
    insight: ins,
    parentId: chosen.id,
    parentName: byId.get(chosen.id)?.name ?? '(unnamed)',
    parentMentions: chosen.n,
    hierarchyLevel: Number.isInteger(parentLevel) ? parentLevel + 1 : 3,
    parentSource,
    rarityName: byId.get(rarity.id)?.name ?? '(unnamed)',
    rarityId: rarity.id,
  });
}

if (asked > 0) {
  const decided = classifierAgreed + classifierOverrode;
  out('\n=== classifier vs the rarity prior ===\n');
  out(`  asked              : ${asked}`);
  out(`  answered           : ${decided}  (${((100 * decided) / asked).toFixed(0)}% of asked)`);
  out(`    agreed w/ rarity : ${classifierAgreed}`);
  out(`    overrode rarity  : ${classifierOverrode}`);
  out(`  declined / unusable: ${classifierDeclined}  (kept the rarity placement)`);
  if (classifierFailed) out(`  call failed        : ${classifierFailed}  (kept the rarity placement)`);
  out('');
  out('  Agreement is not the goal — it only says the prior was already right');
  out('  for that row. The overrides are what stage 2 buys, and they are the');
  out('  ones worth reading in the sample below.\n');
}

if (plan.length === 0) { out('Nothing to do.\n'); process.exit(0); }

const dist = new Map();
for (const p of plan) dist.set(p.parentName, (dist.get(p.parentName) ?? 0) + 1);
const ranked = [...dist.entries()].sort((a, b) => b[1] - a[1]);
out('=== parents that would adopt, top 12 ===\n');
for (const [name, n] of ranked.slice(0, 12)) {
  out(`  ${String(n).padStart(4)}  ${name}`);
}
const top3 = ranked.slice(0, 3).reduce((a, [, n]) => a + n, 0);
out(`\ndistinct parents : ${ranked.size ?? dist.size}`);
out(`concentration    : top 3 take ${top3} = ${((100 * top3) / plan.length).toFixed(1)}%`);
out('  Ranking is by RARITY, so a popular hub never adopts an insight that');
out('  named anything more specific. Concentration well above ~10% here would');
out('  mean the mentions themselves have collapsed onto a few names.\n');

const overrides = plan.filter((p) => p.parentSource === 'classifier' && p.parentId !== p.rarityId);
if (overrides.length > 0) {
  out('=== where the classifier disagreed with the prior ===\n');
  out(`  ${'insight'.padEnd(44)}  ${'rarity would say'.padEnd(24)}  classifier says`);
  out(`  ${'-'.repeat(44)}  ${'-'.repeat(24)}  ${'-'.repeat(24)}`);
  for (const p of overrides.slice(0, 15)) {
    out(`  ${String(p.insight.name ?? '').slice(0, 42).padEnd(44)}  ${String(p.rarityName).slice(0, 22).padEnd(24)}  ${p.parentName}`);
  }
  if (overrides.length > 15) out(`  ... and ${overrides.length - 15} more`);
  out('');
}

out('=== sample placements ===\n');
for (const p of plan.slice(0, 8)) {
  out(`  ${String(p.insight.name ?? '').slice(0, 42).padEnd(44)}→ ${p.parentName} @L${p.hierarchyLevel}  [${p.parentSource}]`);
}
out('');

if (!APPLY) {
  out(`DRY RUN — nothing written. Re-run with --apply to place ${plan.length} insights`);
  if (!RARITY_ONLY && classifyCount < pending.length) {
    out(`           (--apply classifies all ${pending.length}, not just the ${classifyCount} sampled here).`);
  }
  out('');
  process.exit(0);
}

let ok = 0;
let failed = 0;
for (const p of plan) {
  try {
    // PUT is a SHALLOW merge (km-core mergeAttributes) — send the WHOLE
    // metadata object or everything already on it is dropped.
    const res = await fetch(`${OBS_API}/api/v1/entities/${encodeURIComponent(p.insight.id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        metadata: {
          ...(p.insight.metadata ?? {}),
          parentId: p.parentId,
          hierarchyLevel: p.hierarchyLevel,
          // Same field the write path records, so "which rule placed this"
          // has one answer across both producers.
          parentSource: p.parentSource,
          placedBy: 'backfill-insight-parents',
          placedAt: new Date().toISOString(),
        },
      }),
    });
    if (!res.ok) throw new Error(`PUT → ${res.status}`);
    ok += 1;
  } catch (e) {
    failed += 1;
    process.stderr.write(`  FAILED ${p.insight.id}: ${e.message}\n`);
  }
}
out(`\nplaced ${ok}, failed ${failed}.\n`);
process.exit(failed > 0 ? 1 : 0);
