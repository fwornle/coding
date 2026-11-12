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
  inLearningCheckout,
} from '../lib/attribution/repo-router.mjs';

const { CODING_DIR } = createRequire(import.meta.url)('../lib/history/paths.cjs');

const KM = process.env.OBS_API_BASE || 'http://localhost:12436';
const APPLY = process.argv.includes('--apply');
const TEAM_FILTER = (process.argv.find((a) => a.startsWith('--team=')) || '').split('=')[1] || null;

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
      && evidence.length > 0 && evidence.every(inLearningCheckout)) {
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

  if (!APPLY) {
    log('');
    log('DRY RUN complete. Re-run with --apply to write the RE-FILE list.');
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
  log(`DONE: ${written} re-filed, ${abstained.length} abstained.`);
}

main().catch((err) => {
  log(`FATAL: ${err.stack}`);
  process.exit(1);
});
