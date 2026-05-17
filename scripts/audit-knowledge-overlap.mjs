#!/usr/bin/env node

/**
 * Read-only audit of overlap between the two knowledge pipelines:
 *
 *   1. Online pipeline: .data/observation-export/insights.json (70 insights)
 *   2. UKB pipeline:    .data/knowledge-export/coding.json (725 entities)
 *
 * Reports three clusters of overlap:
 *
 *   A. Near-duplicate insights (same online pipeline)
 *      Jaccard similarity on topic tokens + first-200-char summary tokens.
 *   B. Near-duplicate UKB entities (same UKB pipeline)
 *      Jaccard similarity on tokenised name + first observation.
 *      Filtered to SubComponent + Detail (covers 659/725 = 91% of entities).
 *   C. Cross-pipeline overlap (insight topic ↔ UKB entity name)
 *      Same Jaccard, but pairs from different sources.
 *
 * Outputs a markdown report to stdout. No writes, no DB connections.
 *
 * Usage:
 *   node scripts/audit-knowledge-overlap.mjs                  # default thresholds
 *   node scripts/audit-knowledge-overlap.mjs --threshold=0.5  # tweak similarity
 *   node scripts/audit-knowledge-overlap.mjs --top=20         # cluster sample size
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const INSIGHTS_PATH = resolve(ROOT, '.data/observation-export/insights.json');
const ENTITIES_PATH = resolve(ROOT, '.data/knowledge-export/coding.json');

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);
const SIM_THRESHOLD = Number(args.threshold ?? 0.45);
const TOP_N = Number(args.top ?? 15);

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'in', 'on', 'for', 'to', 'with', 'is',
  'are', 'be', 'this', 'that', 'it', 'as', 'by', 'at', 'from', 'into', 'via',
  'system', 'module', 'service', 'component', 'subcomponent', 'detail',
  'project', 'file', 'process', 'integration', 'integrations',
]);

function tokenise(text) {
  if (!text) return new Set();
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 3 && !STOPWORDS.has(t))
  );
}

// camelCase- and snake_case-aware tokenisation for identifier-like strings.
// "OntologyClassificationAgent" → {ontology, classification, agent}
// "code_graph_rag" → {code, graph, rag}
function tokeniseIdentifier(text) {
  if (!text) return new Set();
  const split = text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[_\-]/g, ' ');
  return tokenise(split);
}

function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const t of a) if (b.has(t)) intersection++;
  const union = a.size + b.size - intersection;
  return intersection / union;
}

function clusterByJaccard(items, threshold) {
  const clusters = [];
  const assigned = new Array(items.length).fill(-1);
  for (let i = 0; i < items.length; i++) {
    if (assigned[i] !== -1) continue;
    const cluster = [i];
    assigned[i] = clusters.length;
    for (let j = i + 1; j < items.length; j++) {
      if (assigned[j] !== -1) continue;
      const sim = jaccard(items[i].tokens, items[j].tokens);
      if (sim >= threshold) {
        cluster.push(j);
        assigned[j] = clusters.length;
        items[j]._matchedAt = sim;
      }
    }
    if (cluster.length > 1) {
      clusters.push(cluster);
    } else {
      assigned[i] = -1;
    }
  }
  return clusters;
}

function findCrossMatches(insightItems, entityItems, threshold) {
  const matches = [];
  for (const ins of insightItems) {
    for (const ent of entityItems) {
      const sim = jaccard(ins.nameTokens, ent.tokens);
      if (sim >= threshold) {
        matches.push({ insight: ins, entity: ent, sim });
      }
    }
  }
  matches.sort((a, b) => b.sim - a.sim);
  return matches;
}

// --- load + prepare ---------------------------------------------------

const insights = JSON.parse(readFileSync(INSIGHTS_PATH, 'utf8'));
const kg = JSON.parse(readFileSync(ENTITIES_PATH, 'utf8'));
const entities = kg.entities ?? [];

const insightItems = insights.map((i) => ({
  id: i.id,
  topic: i.topic,
  confidence: i.confidence,
  digestCount: (i.digestIds || []).length,
  // Topic-only identity. The summary is *content*, not identity —
  // including it in the token set drowned out the topical signal
  // (the "LLM Proxy" cluster was missed despite obvious overlap).
  tokens: tokeniseIdentifier(i.topic),
  // Alias for symmetry with cross-pipeline matching code.
  nameTokens: tokeniseIdentifier(i.topic),
}));

const STRUCTURAL_TYPES = new Set([
  'SubComponent',
  'Detail',
  'Component',
  'Container',
  'System',
  'Project',
  'Service',
  'Process',
]);

const entityItems = entities
  .filter((e) => STRUCTURAL_TYPES.has(e.entityType))
  .map((e) => ({
    id: e.id,
    name: e.name,
    entityType: e.entityType,
    obsCount: (e.observations || []).length,
    // Name-only, camelCase-aware tokens. Observations were too noisy —
    // boilerplate like "uses a parsing mechanism" produced false-positive
    // clusters of unrelated services.
    tokens: tokeniseIdentifier(e.name),
  }));

// --- run clusters -----------------------------------------------------

const insightDupes = clusterByJaccard(insightItems, SIM_THRESHOLD);
const entityDupes = clusterByJaccard(entityItems, SIM_THRESHOLD);
const crossMatches = findCrossMatches(insightItems, entityItems, SIM_THRESHOLD);

// --- emit report ------------------------------------------------------

const lines = [];
const log = (s = '') => lines.push(s);

log('# Knowledge Overlap Audit');
log('');
log(`_Threshold: Jaccard ≥ ${SIM_THRESHOLD}. Generated: ${new Date().toISOString()}_`);
log('');
log('## Corpus');
log('');
log(`| Source | Count |`);
log(`|---|---|`);
log(`| Insights (online pipeline) | ${insights.length} |`);
log(`| UKB entities (structural types) | ${entityItems.length} of ${entities.length} total |`);
log('');

// --- A. Insight dupes
log('## A. Near-duplicate insights (online pipeline)');
log('');
const insightDupeCount = insightDupes.reduce((s, c) => s + c.length, 0);
log(
  `**${insightDupes.length} cluster(s)** covering **${insightDupeCount} insights** ` +
    `(${((insightDupeCount / insights.length) * 100).toFixed(1)}% of corpus).`
);
log('');

insightDupes.sort((a, b) => b.length - a.length);
for (const cluster of insightDupes.slice(0, TOP_N)) {
  const members = cluster.map((i) => insightItems[i]);
  log(`### Cluster (${members.length} insights)`);
  for (const m of members) {
    log(`- \`${m.id.slice(0, 8)}\` (conf ${m.confidence}, ${m.digestCount} digests) — ${m.topic}`);
  }
  log('');
}
if (insightDupes.length > TOP_N) {
  log(`_…and ${insightDupes.length - TOP_N} smaller clusters._`);
  log('');
}

// --- B. Entity dupes
log('## B. Near-duplicate UKB entities');
log('');
const entityDupeCount = entityDupes.reduce((s, c) => s + c.length, 0);
log(
  `**${entityDupes.length} cluster(s)** covering **${entityDupeCount} entities** ` +
    `(${((entityDupeCount / entityItems.length) * 100).toFixed(1)}% of structural corpus).`
);
log('');

entityDupes.sort((a, b) => b.length - a.length);
for (const cluster of entityDupes.slice(0, TOP_N)) {
  const members = cluster.map((i) => entityItems[i]);
  log(`### Cluster (${members.length} entities)`);
  for (const m of members) {
    log(`- \`${m.id}\` [${m.entityType}, ${m.obsCount} obs] — **${m.name}**`);
  }
  log('');
}
if (entityDupes.length > TOP_N) {
  log(`_…and ${entityDupes.length - TOP_N} smaller clusters._`);
  log('');
}

// --- C. Cross-pipeline overlap
log('## C. Cross-pipeline overlap (insight ↔ UKB entity)');
log('');
log(`**${crossMatches.length} pair(s)** with Jaccard ≥ ${SIM_THRESHOLD}.`);
log('');
log('Each pair = a topic the online pipeline learned that the UKB pipeline _also_ has an entity for.');
log('These are the candidates for unification — insights here become "evidence attached to" the entity.');
log('');

const seenInsights = new Set();
let shown = 0;
for (const m of crossMatches) {
  if (seenInsights.has(m.insight.id)) continue;
  if (shown >= TOP_N) break;
  seenInsights.add(m.insight.id);
  log(
    `- _sim ${m.sim.toFixed(2)}_ — ` +
      `insight \`${m.insight.id.slice(0, 8)}\` "${m.insight.topic}" ` +
      `↔ entity [${m.entity.entityType}] **${m.entity.name}**`
  );
  shown++;
}
if (crossMatches.length > shown) {
  log('');
  log(`_…and ${crossMatches.length - shown} more pairs (some insights match multiple entities)._`);
}

// --- summary
log('');
log('## Summary');
log('');
const insightDupeRate = ((insightDupeCount / insights.length) * 100).toFixed(0);
const entityDupeRate = ((entityDupeCount / entityItems.length) * 100).toFixed(0);
const uniqueInsightsWithEntity = new Set(crossMatches.map((m) => m.insight.id)).size;
const crossRate = ((uniqueInsightsWithEntity / insights.length) * 100).toFixed(0);
log(
  `- Insight-side dedup potential: **~${insightDupeRate}%** of insights live in a multi-member cluster.`
);
log(
  `- UKB-side dedup potential: **~${entityDupeRate}%** of structural entities live in a multi-member cluster.`
);
log(
  `- Cross-pipeline overlap: **${uniqueInsightsWithEntity}/${insights.length}** insights (~${crossRate}%) have a strong UKB entity match.`
);

process.stdout.write(lines.join('\n') + '\n');
