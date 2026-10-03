/**
 * The team / view registry — config/teams/ read at runtime.
 *
 * config/teams/<id>.json has existed since the lower-ontology work but nothing
 * ever read it while serving: the unified viewer derived its "Teams / Views"
 * rail purely from whichever `metadata.team` values happened to appear in the
 * graph. That made the five PREDEFINED entries indistinguishable from the ones
 * an agent session invents by running somewhere new — and made a team with no
 * entities yet (RaaS) invisible. This module is the loader that closes that
 * gap; obs-api serves it at GET /api/teams.
 *
 * Two kinds of entry, and the distinction is load-bearing (see the contract on
 * TeamOntologyConfig in src/knowledge-management/types.ts): `kind: 'project'`
 * is a body of work, `kind: 'team'` is an owner. They are displayed as separate
 * groups, so a caller must not flatten them back together.
 *
 * FAIL-OPEN, deliberately. Everything here feeds a display surface, and the
 * asymmetry in CLAUDE.md applies: a UI that silently drops half its content
 * looks identical to a broken build, so one unreadable file costs its own entry
 * and nothing else. Nothing in this module throws on bad input.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const teamsConfig = createRequire(import.meta.url)('./config.cjs');

const TEAMS_DIR = ['config', 'teams'];

function warn(msg) {
  process.stderr.write(`[teams] ${msg}\n`);
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    warn(`skipping ${file}: ${err.message}`);
    return null;
  }
}

/**
 * Load the predefined team/project registry.
 *
 * Read through lib/teams/config.cjs, which layers config/teams/<id>.json (the
 * ontology config) under config/teams.yaml and ~/.coding/teams.yaml (labels,
 * membership, user-defined teams). A team is a set of repos: `repos` and
 * `include` say which, and `teamsOf()` answers it for one repo.
 *
 * `id` is lowercased because that is what joins against entity metadata: the
 * config spells it `ReSi`, every entity carrying it spells it `resi`.
 *
 * @param {string} repoRoot absolute path to the coding checkout
 * @returns {Array<{id:string,label:string,kind:'team'|'project',description:string,
 *   repos:Array<{path?:string,remote?:string,id?:string}>,include:string[],active:boolean}>}
 *   sorted by label; empty when nothing is readable.
 */
export function loadTeamRegistry(repoRoot) {
  let doc;
  try {
    doc = teamsConfig.loadTeams({ repoRoot });
  } catch (err) {
    warn(`cannot load teams: ${err.message}`);
    return [];
  }
  for (const w of doc.warnings) warn(w);
  const out = Object.values(doc.teams).map((t) => ({
    id: t.id,
    label: t.label,
    // Anything that isn't the literal 'project' is an owner. Defaulting the
    // other way would silently promote a malformed entry into the Projects
    // group, which is the one distinction this registry exists to keep.
    kind: t.kind === 'project' ? 'project' : 'team',
    description: t.description || '',
    repos: t.repos || [],
    include: t.include || [],
    active: doc.active.includes(t.id),
  }));
  out.sort((a, b) => a.label.localeCompare(b.label));
  return out;
}

/** Which teams a repo belongs to — see lib/teams/config.cjs. */
export const teamsOf = (repoPath, opts) => teamsConfig.teamsOf(repoPath, opts);

/**
 * Load the grouping rules for dynamically created views.
 *
 * A rule whose `match` will not compile is dropped rather than allowed to throw
 * at request time — a typo in one regex must not empty the whole rail.
 *
 * @param {string} repoRoot absolute path to the coding checkout
 * @returns {Array<{id:string,label:string,match:string,description:string}>}
 */
export function loadViewGroups(repoRoot) {
  const doc = readJson(join(repoRoot, ...TEAMS_DIR, 'view-groups.json'));
  const groups = doc && Array.isArray(doc.groups) ? doc.groups : [];
  const out = [];

  for (const g of groups) {
    if (!g || typeof g !== 'object') continue;
    const { id, label, match } = g;
    if (typeof id !== 'string' || !id || typeof match !== 'string' || !match) {
      warn(`skipping view group ${JSON.stringify(g)}: needs "id" and "match"`);
      continue;
    }
    try {
      new RegExp(match, 'i');
    } catch (err) {
      warn(`skipping view group "${id}": ${match} is not a valid regex (${err.message})`);
      continue;
    }
    out.push({
      id,
      label: typeof label === 'string' && label ? label : id,
      match,
      description: typeof g.description === 'string' ? g.description : '',
    });
  }

  return out;
}

/**
 * Both halves of the registry in one call — the shape GET /api/teams serves.
 *
 * @param {string} repoRoot absolute path to the coding checkout
 */
export function loadRegistry(repoRoot) {
  let active = [];
  try { active = teamsConfig.loadTeams({ repoRoot }).active; } catch { /* fail open */ }
  return {
    teams: loadTeamRegistry(repoRoot),
    viewGroups: loadViewGroups(repoRoot),
    // The selected teams (empty = all). The viewer's and injection's primary filter.
    active,
  };
}
