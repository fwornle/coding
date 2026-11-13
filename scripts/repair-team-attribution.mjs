#!/usr/bin/env node
/**
 * Re-file entities whose team follows the shell rather than the subject.
 *
 * The ETM stamps `metadata.team` from the cwd's basename. Fix a coding-project
 * bug from inside the a2a-xpr checkout and the insight files under a2a-xpr:
 * `Copilot Events Tail Watcher Race Condition`, an insight entirely about
 * `copilot-events-tail.mjs`, sat under a2a-xpr for exactly that reason.
 *
 * EVIDENCE, IN ORDER
 *
 *   1. artifact paths — absolute, resolve to a repo by walking to its .git.
 *      Deterministic; no threshold.
 *   2. distinctive filename citations in the description — a backticked
 *      filename whose basename belongs to exactly ONE known repo.
 *
 * REVERTS
 *
 *   An observation ObservationWriter re-filed by artifacts that were ALL in a
 *   learning checkout (<repo>/.coding — session logs, kb) goes back to the
 *   project it was stamped with (attribution.previousTeam): those files are not
 *   evidence of a turn's subject, and the old router even named the project
 *   '.coding' after the checkout. A '.coding' digest follows the one '.coding'
 *   observation of its day, when there is exactly one.
 *
 * Anything else is ABSTAINED and listed, not rewritten. Embeddings are
 * deliberately not consulted: the reference set cannot discriminate (see the
 * measurements in lib/attribution/repo-router.mjs), so they would launder a
 * guess into something that looks like an answer.
 *
 * USAGE
 *   node scripts/repair-team-attribution.mjs                 # dry run
 *   node scripts/repair-team-attribution.mjs --apply
 *   node scripts/repair-team-attribution.mjs --team=a2a-xpr  # narrow the scan
 *   node scripts/repair-team-attribution.mjs --refile=<entityId>=<team>   # a decision
 *     made by hand where there is no evidence (repeatable; recorded as 'manual')
 *   node scripts/repair-team-attribution.mjs --drop-anchor=<team>  # also delete that
 *     team's Project anchor once the run leaves it without children (repeatable;
 *     '.coding' is always dropped this way)
 *   node scripts/repair-team-attribution.mjs --anchors-only  # no evidence re-files:
 *     only --refile decisions, then parent edges follow the (corrected) labels
 *
 * ANCHORS
 *
 *   Re-filing changes an entity's team, but its parent edge — has_insight /
 *   contains from the old team's Project anchor — stayed, so the graph kept it
 *   under the old project. Every run now also moves such an edge from a learning
 *   artifact (Insight, Digest, Observation) to the anchor of the team it is
 *   filed under, when that anchor exists; structural nodes (Components, Details)
 *   are never moved. A '.coding' anchor left without children is deleted: it
 *   was minted for the learning-checkout mis-attribution and names no project.
 *
 * Env: OBS_API_BASE (default http://localhost:12436)
 */

import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { createRequire } from 'node:module';

import {
  routeFromArtifacts,
  routeFromCitations,
  buildDistinctiveIndex,
  inLearningCheckout, inAgentState,
} from '../lib/attribution/repo-router.mjs';

const { CODING_DIR } = createRequire(import.meta.url)('../lib/history/paths.cjs');

const KM = process.env.OBS_API_BASE || 'http://localhost:12436';
const APPLY = process.argv.includes('--apply');
const DROP_TEAMS = new Set(['.coding', ...process.argv.filter((a) => a.startsWith('--drop-anchor=')).map((a) => a.split('=')[1]).filter(Boolean)]);
const ANCHORS_ONLY = process.argv.includes('--anchors-only');
const TEAM_FILTER = (process.argv.find((a) => a.startsWith('--team=')) || '').split('=')[1] || null;
const MANUAL = process.argv.filter((a) => a.startsWith('--refile=')).map((a) => {
  const [id, team] = a.slice('--refile='.length).split('=');
  if (!id || !team) throw new Error(`--refile expects <entityId>=<team>, got ${a}`);
  return { id, team };
});
const ANCHOR_EDGES = ['has_insight', 'contains'];
const LEARNING_CLASSES = new Set(['Insight', 'Digest', 'Observation']);

/**
 * Repos whose tracked filenames form the citation index.
 *
 * Discovered from the graph itself — every team that has entities and a
 * checkout on disk — rather than hardcoded, so a new project joins by existing.
 */
const SEARCH_ROOTS = [
  process.env.CODING_REPO || path.resolve(new URL('..', import.meta.url).pathname),
  path.join(process.env.HOME || '', 'Agentic'),
  path.join(process.env.HOME || '', 'Agentic', '_work'),
];

function log(msg) {
  process.stderr.write(`[attribution] ${msg}\n`);
}

async function api(p, init) {
  const res = await fetch(`${KM}${p}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${p} -> ${res.status} ${JSON.stringify(body)}`);
  return body?.data ?? body;
}

/** Tracked files per candidate repo, for the distinctive-name index. */
function discoverRepos(teams) {
  const filesByTeam = {};
  for (const team of teams) {
    if (team === CODING_DIR) continue; // a learning checkout, never a repo of its own
    for (const root of SEARCH_ROOTS) {
      const dir = path.basename(root) === team ? root : path.join(root, team);
      if (!existsSync(path.join(dir, '.git'))) continue;
      try {
        const out = execFileSync('git', ['-C', dir, 'ls-files'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
        filesByTeam[team] = out.split('\n').filter(Boolean);
        break;
      } catch {
        /* not a usable checkout */
      }
    }
  }
  return filesByTeam;
}

function artifactsOf(entity) {
  const md = entity.metadata ?? {};
  for (const k of ['artifacts', 'files_touched', 'filesTouched', 'validated_file_path']) {
    const v = md[k];
    if (Array.isArray(v) && v.length) return v.filter((x) => typeof x === 'string');
    if (typeof v === 'string' && v) return [v];
  }
  return [];
}

async function main() {
  if (!APPLY) log('DRY RUN — pass --apply to write.');

  const entities = await api('/api/v1/entities?limit=20000');
  const teams = [...new Set(entities.map((e) => (e.metadata ?? {}).team).filter(Boolean))];
  const filesByTeam = discoverRepos(teams);
  log(`checkouts found for: ${Object.keys(filesByTeam).join(', ') || '(none)'}`);

  const index = buildDistinctiveIndex(filesByTeam);
  log(`distinctive filenames indexed: ${index.size}`);

  // team, as before — plus a project-only entity (a digest) filed under the
  // learning checkout, which only the revert pass below handles.
  const teamOf = (e) => {
    const md = e.metadata ?? {};
    return md.team ?? (md.project === CODING_DIR ? CODING_DIR : undefined);
  };
  const scope = entities.filter((e) => {
    const t = teamOf(e);
    if (!t) return false;
    return TEAM_FILTER ? t === TEAM_FILTER : true;
  });
  log(`entities in scope: ${scope.length}${TEAM_FILTER ? ` (team=${TEAM_FILTER})` : ''}`);

  const decided = [];
  const abstained = [];

  const reverted = new Map(); // entity id -> restored team
  for (const e of scope) {
    const current = teamOf(e);
    const attr = (e.metadata ?? {}).attribution;
    const evidence = Array.isArray(attr?.evidence) ? attr.evidence : [];
    if (attr?.stampedFrom === 'artifacts' && attr.previousTeam && attr.previousTeam !== current
      && evidence.length > 0 && evidence.every((a) => inLearningCheckout(a) || inAgentState(a))) {
      decided.push({ e, from: current, to: attr.previousTeam, via: 'revert', evidence });
      reverted.set(e.id, attr.previousTeam);
      continue;
    }
    if (e.ontologyClass === 'Digest' && current === CODING_DIR) continue; // second pass below

    const byArtifact = routeFromArtifacts(artifactsOf(e));
    const byCitation = byArtifact
      ? null
      : routeFromCitations(`${e.name}\n${e.description ?? ''}`, index, { assertsTeam: current });
    const decision = byArtifact ?? byCitation;

    if (!decision) {
      abstained.push({ e, why: 'no decisive evidence' });
      continue;
    }
    if (decision.team === current) continue; // already right

    decided.push({
      e,
      from: current,
      to: decision.team,
      via: byArtifact ? 'artifacts' : 'citations',
      evidence: decision.evidence.slice(0, 3),
    });
  }

  // A '.coding' digest: the one '.coding' observation of its day decides.
  const dayOf = (iso) => String(iso ?? '').slice(0, 10);
  for (const e of scope) {
    if (e.ontologyClass !== 'Digest' || teamOf(e) !== CODING_DIR) continue;
    const day = (e.metadata ?? {}).date ?? dayOf(e.createdAt);
    const sources = scope.filter((o) => o.ontologyClass === 'Observation' && reverted.has(o.id)
      && dayOf((o.metadata ?? {}).createdAt ?? o.createdAt) === day);
    const to = new Set(sources.map((o) => reverted.get(o.id)));
    if (sources.length === 1 && to.size === 1) {
      decided.push({ e, from: CODING_DIR, to: [...to][0], via: 'revert', evidence: [`observation ${sources[0].id}`] });
    } else {
      abstained.push({ e, why: `${sources.length} '.coding' observation(s) on ${day}` });
    }
  }

  // --anchors-only: the labels are reviewed; re-file only what --refile names.
  if (ANCHORS_ONLY) { decided.length = 0; abstained.length = 0; }

  for (const m of MANUAL) {
    const e = entities.find((x) => x.id === m.id);
    if (!e) throw new Error(`--refile: no entity ${m.id}`);
    const current = (e.metadata ?? {}).team ?? (e.metadata ?? {}).project;
    const i = decided.findIndex((d) => d.e.id === m.id);
    if (i >= 0) decided.splice(i, 1);
    const j = abstained.findIndex((a) => a.e.id === m.id);
    if (j >= 0) abstained.splice(j, 1);
    if (current !== m.team) decided.push({ e, from: current, to: m.team, via: 'manual', evidence: ['--refile'] });
  }

  // Parent edges that follow the OLD team (see ANCHORS above).
  const finalTeam = new Map(decided.map((d) => [d.e.id, d.to]));
  const byId = new Map(entities.map((e) => [e.id, e]));
  const anchors = entities.filter((e) => e.ontologyClass === 'Project' && (e.metadata ?? {}).team);
  const anchorOf = new Map(anchors.map((a) => [a.metadata.team, a]));
  const moves = [];
  const remaining = new Map(); // anchor id -> anchor edges left after the moves
  for (const a of anchors) {
    if (TEAM_FILTER && a.metadata.team !== TEAM_FILTER) continue;
    let left = 0;
    for (const type of ANCHOR_EDGES) {
      const rels = await api(`/api/v1/relations?from=${encodeURIComponent(a.id)}&relationType=${type}&limit=5000`);
      for (const r of rels ?? []) {
        const child = byId.get(r.target);
        const md = child?.metadata ?? {};
        const team = finalTeam.get(r.target) ?? md.team ?? md.project;
        const to = team && team !== a.metadata.team ? anchorOf.get(team) : null;
        if (child && LEARNING_CLASSES.has(child.ontologyClass) && to) {
          moves.push({ key: r.key, type, child, from: a, to });
        } else {
          left++;
        }
      }
    }
    remaining.set(a.id, left);
  }
  const drops = anchors.filter((a) => (a.metadata.team === CODING_DIR || DROP_TEAMS.has(a.metadata.team)) && remaining.get(a.id) === 0);

  log('');
  log(`RE-FILE: ${decided.length}`);
  for (const d of decided) {
    log(`  ${d.from} -> ${d.to}  [${d.via}] ${d.e.name.slice(0, 46)}  (${d.evidence.map((x) => path.basename(x)).join(', ')})`);
  }
  log('');
  log(`ABSTAINED (left as-is): ${abstained.length}`);
  for (const a of abstained.slice(0, 15)) {
    log(`  ${(a.e.metadata ?? {}).team} | ${a.e.name.slice(0, 56)}`);
  }
  if (abstained.length > 15) log(`  … and ${abstained.length - 15} more`);

  log('');
  log(`RE-ANCHOR: ${moves.length}`);
  for (const m of moves) {
    log(`  ${m.from.name} -${m.type}-> ${m.child.ontologyClass} ${m.child.name.slice(0, 44)}  =>  from ${m.to.name}`);
  }
  if (drops.length) log(`DROP empty anchor: ${drops.map((a) => a.name).join(', ')}`);

  if (!APPLY) {
    log('');
    log('DRY RUN complete. Re-run with --apply to write the RE-FILE / RE-ANCHOR list.');
    return;
  }

  let written = 0;
  for (const d of decided) {
    // PUT is a SHALLOW merge (km-core mergeAttributes) — send the whole
    // metadata object or the provenance block on it is dropped.
    await api(`/api/v1/entities/${encodeURIComponent(d.e.id)}`, {
      method: 'PUT',
      body: JSON.stringify({
        metadata: {
          ...(d.e.metadata ?? {}),
          team: d.to,
          project: d.to,
          attribution: {
            // Auditable and reversible: what it was, why it moved, and on what.
            stampedFrom: d.via,
            previousTeam: d.from,
            evidence: d.evidence,
            repairedBy: 'repair-team-attribution',
          },
        },
      }),
    });
    written++;
  }
  log('');
  // New parent edge first, then drop the old one: an interrupted run leaves a
  // duplicate edge (harmless, fixed by the next run), never an orphan.
  let anchored = 0;
  const linked = new Set(); // to|type|child already written in this run
  for (const m of moves) {
    // Two old anchors can hold the same child (or the new one already does):
    // write the new edge once, drop every old one.
    const k = `${m.to.id}|${m.type}|${m.child.id}`;
    const have = linked.has(k) || ((await api(`/api/v1/relations?from=${encodeURIComponent(m.to.id)}&to=${encodeURIComponent(m.child.id)}&relationType=${m.type}`)) ?? []).length > 0;
    linked.add(k);
    if (!have) await api('/api/v1/relations', {
      method: 'POST',
      body: JSON.stringify({
        from: m.to.id,
        to: m.child.id,
        relationType: m.type,
        metadata: { reanchoredFrom: m.from.id, repairedBy: 'repair-team-attribution' },
      }),
    });
    await api(`/api/v1/relations/${encodeURIComponent(m.key)}`, { method: 'DELETE' });
    anchored++;
  }
  for (const a of drops) await api(`/api/v1/entities/${encodeURIComponent(a.id)}`, { method: 'DELETE' });
  log(`DONE: ${written} re-filed, ${anchored} re-anchored, ${drops.length} empty anchor(s) dropped, ${abstained.length} abstained.`);
}

main().catch((err) => {
  log(`FATAL: ${err.stack}`);
  process.exit(1);
});
