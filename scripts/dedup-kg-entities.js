#!/usr/bin/env node
/**
 * dedup-kg-entities.js — collapse case/acronym variants in the
 * knowledge graph. Targets pre-fuzzy-match-era duplicates the
 * persistence agent's runtime check could not catch.
 *
 * Examples it merges:
 *   CodeGraphRAG          (canonical, all-caps acronym)
 *   CodeGraphRag          → folded into CodeGraphRAG
 *   GraphCodeRAGIntegration / GraphCodeRagIntegration
 *
 * Cross-team contamination ('CollectiveKnowledge' was leaked into
 * 'ui' and 'resi' teams when it should only be in 'coding') is also
 * cleaned up by removing the off-team copies.
 *
 * Usage:
 *   node scripts/dedup-kg-entities.js --dry-run
 *   node scripts/dedup-kg-entities.js --execute
 */

const VKB_BASE = process.env.VKB_BASE_URL || 'http://localhost:8080';
const args = process.argv.slice(2);
const DRY_RUN = !args.includes('--execute');
const TEAM = process.env.TEAM || 'coding';

const ACRONYMS = new Set(['RAG', 'API', 'URL', 'JSON', 'XML', 'HTTP', 'HTTPS',
  'SQL', 'KG', 'LLM', 'PII', 'UI', 'UX', 'OS', 'IO', 'CLI', 'IDE', 'AWS',
  'SDK', 'ORM', 'IPC', 'DAG', 'YAML', 'CSV', 'GUID', 'UUID', 'JWT', 'CORS',
  'DOM', 'CRUD', 'REST', 'GRPC', 'SSE', 'TCP', 'UDP', 'DNS', 'TLS', 'SSL',
  'AST', 'BFS', 'DFS', 'FIFO', 'LIFO', 'NLP', 'VKB', 'OKB', 'UKB', 'ANN',
  'KB', 'MB', 'GB']);

function log(msg) { process.stderr.write(`[dedup-kg] ${msg}\n`); }

function normalize(name) {
  return (name || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
}

/**
 * Score candidate canonical names. Higher is more "canonical".
 * Preference order:
 *   1. Names that contain all-caps acronyms (RAG > Rag).
 *   2. More observations preserved (i.e. more useful entity).
 *   3. Alphabetical fallback for stability.
 */
function score(entity) {
  const name = entity.entity_name || '';
  // Count acronyms detected by checking each PascalCase segment.
  const segments = name.match(/[A-Z]+(?=[A-Z][a-z])|[A-Z][a-z]+|[A-Z]+$/g) || [];
  let acronymHits = 0;
  for (const seg of segments) {
    if (seg.length >= 2 && seg === seg.toUpperCase() && ACRONYMS.has(seg)) {
      acronymHits++;
    }
  }
  const obsCount = Array.isArray(entity.observations) ? entity.observations.length : 0;
  return [acronymHits, obsCount, -name.localeCompare('')];
}

function compareScore(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  }
  return 0;
}

function dedupeObservations(observations) {
  const seen = new Set();
  const out = [];
  for (const obs of observations || []) {
    // Observations come as either strings or { type, content, ... } objects.
    const text = typeof obs === 'string' ? obs : (obs && obs.content) || JSON.stringify(obs);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(obs);
  }
  return out;
}

async function fetchAll(team) {
  const r = await fetch(`${VKB_BASE}/api/entities?limit=10000&team=${encodeURIComponent(team)}`);
  if (!r.ok) throw new Error(`VKB GET failed ${r.status}`);
  const data = await r.json();
  return data.entities || [];
}

async function fetchAllAnyTeam() {
  // The default GET filters by team=coding implicitly; pass a wide list.
  const teams = ['coding', 'ui', 'resi', 'unknown'];
  const out = [];
  for (const t of teams) {
    try {
      const ents = await fetchAll(t);
      for (const e of ents) {
        if (!e.team) e.team = t;
        out.push(e);
      }
    } catch (err) {
      log(`fetch team=${t}: ${err.message}`);
    }
  }
  // De-duplicate by id since teams overlap in some endpoints.
  const seen = new Set();
  return out.filter(e => {
    const k = `${e.team}:${e.entity_name}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

async function updateEntity(name, body) {
  if (DRY_RUN) {
    log(`(dry) PUT ${name} <- ${body.observations?.length || 0} observations`);
    return;
  }
  const r = await fetch(`${VKB_BASE}/api/entities/${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`PUT ${name} failed ${r.status}: ${txt.slice(0, 200)}`);
  }
}

async function deleteEntity(name, team, { force = false } = {}) {
  if (DRY_RUN) {
    log(`(dry) DELETE ${team}:${name}${force ? ' [force]' : ''}`);
    return;
  }
  const qs = new URLSearchParams({ team });
  if (force) qs.set('force', 'true');
  const r = await fetch(`${VKB_BASE}/api/entities/${encodeURIComponent(name)}?${qs}`, {
    method: 'DELETE',
  });
  if (!r.ok && r.status !== 404) {
    const txt = await r.text();
    throw new Error(`DELETE ${team}:${name} failed ${r.status}: ${txt.slice(0, 200)}`);
  }
}

async function main() {
  log(`mode: ${DRY_RUN ? 'DRY RUN' : 'EXECUTE'} (team focus: ${TEAM})`);
  const all = await fetchAllAnyTeam();
  log(`fetched ${all.length} entities total`);

  // Bucket by team + normalized name.
  const groups = new Map();
  for (const e of all) {
    const key = `${e.team || 'coding'}::${normalize(e.entity_name)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }

  let dupClusters = 0, merged = 0;
  for (const [key, list] of groups) {
    if (list.length < 2) continue;
    if (!key.startsWith(`${TEAM}::`)) continue; // only act on focus team
    dupClusters++;
    list.sort((a, b) => compareScore(score(b), score(a)));
    const canonical = list[0];
    const losers = list.slice(1);
    log(`cluster ${key.split('::')[1]}: keep="${canonical.entity_name}" merge=${losers.map(l => `"${l.entity_name}"`).join(', ')}`);

    const mergedObs = dedupeObservations([
      ...(canonical.observations || []),
      ...losers.flatMap(l => l.observations || []),
    ]);

    await updateEntity(canonical.entity_name, {
      entityType: canonical.entity_type,
      observations: mergedObs,
      significance: canonical.metadata?.significance,
      team: canonical.team,
      metadata: canonical.metadata || {},
    });
    for (const loser of losers) {
      await deleteEntity(loser.entity_name, loser.team);
      merged++;
    }
  }

  // Cross-team contamination: any entity in a non-focus team whose
  // normalized name matches an entity in the focus team is a leak.
  const focusNorms = new Set(
    [...groups.entries()]
      .filter(([k]) => k.startsWith(`${TEAM}::`))
      .map(([k]) => k.split('::')[1])
  );
  let crossTeamRemoved = 0;
  for (const e of all) {
    if ((e.team || 'coding') === TEAM) continue;
    const n = normalize(e.entity_name);
    if (focusNorms.has(n)) {
      log(`cross-team leak: ${e.team}:${e.entity_name} → removing (force)`);
      // System-typed leaks are flagged "critical" by GraphDB; the API
      // accepts force=true to override that guard for explicit cleanup.
      await deleteEntity(e.entity_name, e.team, { force: true });
      crossTeamRemoved++;
    }
  }

  log(`Result: ${dupClusters} casing clusters, ${merged} entities folded, ${crossTeamRemoved} cross-team leaks removed`);
}

main().catch((err) => {
  process.stderr.write(`[dedup-kg] FATAL: ${err.stack || err.message}\n`);
  process.exit(1);
});
