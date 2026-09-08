/**
 * Which project does a piece of work actually belong to?
 *
 * THE PROBLEM
 *
 * The ETM stamps `metadata.team` from `path.basename(projectPath)` — the shell's
 * cwd. That is where you were standing, not what you were working on. Fix a
 * coding-project bug from inside the a2a-xpr checkout and the resulting insight
 * files under a2a-xpr: 11 of the 52 a2a-xpr entities in the live graph are
 * demonstrably coding topics (copilot-events-tail.mjs, health-coordinator.js,
 * render-statusline-png.mjs, context-gauge.cjs, opencode-token-rows.mjs).
 *
 * WHY NOT EMBEDDINGS
 *
 * The obvious idea — embed the entity, find its neighbours, take their project —
 * was measured and does not work here:
 *
 *   - Qdrant's `kg_entities` payload labels ALL 1,957 points `project: "coding"`.
 *     That field is the knowledge-base name, not the entity's team, so the vote
 *     is a constant. Probed: `a2a-xpr Environment Contract` -> coding=7.10,
 *     `nl-realm.md PoC Documentation` -> coding=7.21. Both genuinely a2a-xpr.
 *   - Voting on the neighbours' own `metadata.team` is circular: they carry the
 *     same cwd-derived error.
 *   - "Nearest Component, then hop to its Project" cannot discriminate either —
 *     the `A2aXpr` Project has zero descendants, so there is no non-coding spine
 *     to match against and every query lands on coding.
 *
 * WHAT WORKS
 *
 * The observations already carry an `artifacts` array of ABSOLUTE file paths.
 * A path resolves to a repository deterministically, with no model involved and
 * no threshold to tune. That is the signal this module reads.
 *
 * It ABSTAINS rather than guesses. A mixed or empty artifact set returns null
 * and the caller keeps whatever the cwd said — a wrong confident answer is worse
 * than no answer, because it is invisible.
 */

import { existsSync, statSync } from 'node:fs';
import path from 'node:path';

/** Cache: directory -> repo root (or null). Resolving walks the tree, so memoize. */
const _repoCache = new Map();

/**
 * The git repository root containing `abs`, by walking up to the nearest `.git`.
 *
 * No configuration and no list of known projects: the filesystem already knows,
 * and a list would go stale the first time a repo is added or moved.
 *
 * `.git` may be a directory (normal clone) or a file (worktree/submodule
 * gitlink) — both count, which matters here because kgbench sandboxes runs in
 * `git worktree` trees.
 *
 * @param {string} abs absolute path to a file or directory
 * @returns {string|null} absolute repo root, or null when outside any repo
 */
export function repoRootForPath(abs) {
  if (typeof abs !== 'string' || !abs.startsWith('/')) return null;

  let dir;
  try {
    dir = existsSync(abs) && statSync(abs).isDirectory() ? abs : path.dirname(abs);
  } catch {
    dir = path.dirname(abs);
  }

  const seen = [];
  while (dir && dir !== '/' && dir !== '.') {
    if (_repoCache.has(dir)) {
      const hit = _repoCache.get(dir);
      for (const d of seen) _repoCache.set(d, hit);
      return hit;
    }
    seen.push(dir);
    if (existsSync(path.join(dir, '.git'))) {
      for (const d of seen) _repoCache.set(d, dir);
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  for (const d of seen) _repoCache.set(d, null);
  return null;
}

/**
 * The team name for an absolute path — the repo's directory name, which is the
 * same string the ETM derives from cwd, so the two vocabularies agree.
 *
 * @returns {string|null} team id, or null when the path is in no repository
 */
export function teamForPath(abs) {
  const root = repoRootForPath(abs);
  return root ? path.basename(root) : null;
}

/**
 * Decide a team from a set of artifact paths.
 *
 * Unanimity is required. Deliberately strict: a session that touched two repos
 * has genuinely ambiguous provenance, and picking the majority would quietly
 * re-file work that legitimately spans both. Abstention is a real answer here —
 * the caller keeps the cwd stamp, which is at least explicable.
 *
 * @param {string[]} artifacts absolute paths
 * @returns {{team: string, evidence: string[]} | null} decision, or null to abstain
 */
export function routeFromArtifacts(artifacts) {
  if (!Array.isArray(artifacts) || artifacts.length === 0) return null;

  const byTeam = new Map();
  for (const a of artifacts) {
    if (typeof a !== 'string') continue;
    const team = teamForPath(a);
    if (!team) continue;
    const list = byTeam.get(team);
    if (list) list.push(a);
    else byTeam.set(team, [a]);
  }

  if (byTeam.size !== 1) return null;
  const [team, evidence] = [...byTeam.entries()][0];
  return { team, evidence };
}

/**
 * Build a basename -> team index for repos whose files can be cited by name.
 *
 * Used for entities written BEFORE the artifact stamp existed, where the only
 * remaining evidence is the filenames in the prose. Only DISTINCTIVE basenames
 * are usable: `README.md`, `mkdocs.yml`, `install.sh` and `CLAUDE.md` exist in
 * several of these repos, and matching on them attributes an a2a-xpr docs
 * insight to coding. Measured on the live pair: 12 shared basenames, and every
 * one of them a false positive waiting to happen.
 *
 * @param {Record<string, string[]>} filesByTeam team id -> tracked file paths
 * @returns {Map<string, string>} basename -> team, ambiguous names omitted
 */
export function buildDistinctiveIndex(filesByTeam) {
  const owners = new Map(); // basename -> Set<team>
  for (const [team, files] of Object.entries(filesByTeam)) {
    for (const f of files) {
      const b = path.basename(f);
      const s = owners.get(b);
      if (s) s.add(team);
      else owners.set(b, new Set([team]));
    }
  }
  const index = new Map();
  for (const [b, teams] of owners) {
    if (teams.size === 1) index.set(b, [...teams][0]);
  }
  return index;
}

/**
 * Basenames that are technically unique to one repo but say nothing about the
 * subject, because every project has one and prose mentions them generically.
 *
 * Found the hard way: `install.sh` is tracked only by the coding repo, so it
 * "distinctively" re-filed an insight literally titled "Documentation Style
 * Guide (a2a-xpr)" to coding. Uniqueness in the index is not the same as
 * evidence about what the text is ABOUT.
 */
const GENERIC_BASENAMES = new Set([
  'install.sh', 'setup.sh', 'build.sh', 'run.sh', 'start.sh', 'test.sh',
  'index.md', 'index.ts', 'index.js', 'main.py', 'main.ts', 'main.go',
  'Makefile', 'Dockerfile', 'docker-compose.yml', 'package.json',
  'tsconfig.json', 'settings.json', 'config.json', 'config.yaml',
]);

/**
 * Is this basename specific enough to decide attribution on its own?
 *
 * The index calls a basename "distinctive" when exactly one KNOWN repo tracks
 * it — but that uniqueness is partly an artifact of the corpus. The sibling
 * repos here are small, so ordinary names like `models.ts`, `team.json` and
 * `types.ts` come out unique and then decide things they should not: a
 * `models.ts` citation re-filed an insight about a fire-safety training agent
 * to the coding project.
 *
 * A compound name (`copilot-events-tail.mjs`, `health-coordinator.js`,
 * `context-gauge.cjs`) is a name someone had to invent, so it identifies a
 * codebase. A short single word is a name every project reuses.
 *
 * Single-word names are not discarded — they just cannot decide ALONE; two of
 * them agreeing still counts (see routeFromCitations).
 */
function isSpecificName(base) {
  const stem = base.replace(/\.[^.]+$/, '');
  return /[-_]/.test(stem) || stem.length >= 15;
}

/** Filenames cited in backticks — how the writers reference code in prose. */
const CITATION_RE = /`([^`\s]+\.(?:mjs|cjs|js|jsx|ts|tsx|py|sh|bash|zsh|json|ya?ml|toml|md))`/g;

/**
 * Decide a team from filenames cited in text, using a distinctive-name index.
 *
 * Same unanimity rule as {@link routeFromArtifacts}: text citing files unique to
 * two different repos is ambiguous, and abstaining is the honest answer.
 *
 * @param {string} text description / name to scan
 * @param {Map<string,string>} index from {@link buildDistinctiveIndex}
 * @param {{assertsTeam?: string|null}} [opts] when the text explicitly names a
 *   team (a title like "Documentation Style Guide (a2a-xpr)"), that authorial
 *   signal outranks an incidental filename, and this abstains rather than
 *   overriding it.
 * @returns {{team: string, evidence: string[]} | null}
 */
export function routeFromCitations(text, index, opts = {}) {
  if (typeof text !== 'string' || !text) return null;

  if (opts.assertsTeam && namesTeam(text, opts.assertsTeam)) return null;

  const byTeam = new Map();
  for (const m of text.matchAll(CITATION_RE)) {
    const base = path.basename(m[1]);
    if (GENERIC_BASENAMES.has(base)) continue;
    const team = index.get(base);
    if (!team) continue;
    const list = byTeam.get(team);
    if (list) list.push(m[1]);
    else byTeam.set(team, [m[1]]);
  }

  if (byTeam.size !== 1) return null;
  const [team, cited] = [...byTeam.entries()][0];
  const evidence = [...new Set(cited)];

  // One weak name is not enough. Two agreeing names are: the chance of two
  // ordinary filenames both being unique to the SAME wrong repo is small,
  // whereas one is exactly how `install.sh` and `models.ts` misfired.
  //
  // Count distinct BASENAMES, not distinct citation strings — `REQUIREMENTS.md`
  // and `docs/REQUIREMENTS.md` are two strings and one piece of evidence, and
  // treating them as two let a single weak name clear the bar.
  const basenames = new Set(evidence.map((f) => f.split('/').pop()));
  const strong = [...basenames].some(isSpecificName);
  if (!strong && basenames.size < 2) return null;

  return { team, evidence };
}

/**
 * Does the text explicitly name this team? Word-bounded so `a2a` does not match
 * inside `a2a-xpr`, which would make every a2a-xpr title look like an a2a one.
 */
export function namesTeam(text, team) {
  if (typeof text !== 'string' || typeof team !== 'string' || !team) return false;
  const esc = team.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\w-])${esc}(?![\\w-])`, 'i').test(text);
}

/** Reset the memoized repo-root lookups (tests that move fixtures around). */
export function _clearCache() {
  _repoCache.clear();
}
