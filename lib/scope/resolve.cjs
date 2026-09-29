'use strict';

/**
 * Scope resolver — the one place that decides which tenant this installation's
 * knowledge belongs to.
 *
 * WHY THIS EXISTS. Production code answered "which tenant am I?" with the
 * literal `'coding'` in ~90 places (11 constructor defaults in
 * integrations/semantic-analysis/src/agents/, `domains: ['coding']`, ~40 CLI
 * defaults, both UIs) and answered "am I in the tools repo?" five mutually
 * inconsistent ways — two `===` comparisons against different operands, a
 * basename equality, and two `String.includes` substring tests. A colleague
 * installing this stack for `raas` inherited every one of those answers, which
 * is what made their work land under the `coding` tenant, validated against
 * `config/teams/coding.json`'s strict coding ontology.
 *
 * WHY COMMONJS. Same reason as lib/features/resolve.cjs: the status line is CJS
 * and renders on every prompt, and it needs `isToolsRepo()` to decide whether to
 * draw the redirect badge. `lib/scope/index.mjs` re-exports this so there is
 * exactly one implementation.
 *
 * INSTALL SCOPE vs PER-OBSERVATION PROJECT — these are different things and
 * conflating them is the trap. The scope resolved here is a property of the
 * INSTALLATION: it names the tenant that owns this machine's knowledge base and
 * therefore its data root. It is not "the project I am currently in". obs-api is
 * one daemon serving every project on the machine, and it already tags each
 * observation with its own `project` field; that per-observation tag stays
 * exactly as it is. One install, one KB, one scope, many projects inside it.
 *
 * LAYERS (last wins):
 *   1. DEFAULT_SCOPE           — 'default'
 *   2. ~/.coding/scope         — this machine; written by install.sh
 *   3. CODING_SCOPE            — env, for CI and the test matrix
 *
 * Deliberately NOT layered into config/features.yaml, and deliberately without a
 * committed repo-level layer:
 *   - `features.yaml` carries `profile:` reset semantics (a later layer's profile
 *     replaces an earlier one wholesale) and `setProfile()` drops every explicit
 *     per-feature override. Tenancy must not be resettable by picking a feature
 *     preset, and must not be droppable by switching one.
 *   - a committed `config/scope` would ship one team's tenant name to every
 *     clone, which is the failure this module exists to prevent. The scope is a
 *     per-machine fact, so it lives only in the per-machine file.
 *
 * WHY THE FALLBACK IS 'default' AND NOT THE TOOLS-REPO BASENAME. Deriving it
 * from `$CODING_REPO` resolves to `coding` on every clone, which reintroduces
 * the exact bug: a colleague's raas work tagged `coding` and ontology-validated
 * against the coding lower ontology. An inert, obviously-placeholder scope is
 * the safer wrong answer, and `explain()` reports when it is in force so the
 * dashboard and `coding-features status` can say so out loud.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DEFAULT_SCOPE = 'default';

/**
 * A scope becomes BOTH a directory name (~/.coding/data/<scope>/) and a km-core
 * domain bucket filename (<exportDir>/<scope>.json), so it has to be safe as a
 * path segment. The leading-character class rejects '.' and therefore '.' and
 * '..' outright; the absence of '/' and '\' from the class rejects traversal.
 */
const SCOPE_RE = /^[a-z0-9][a-z0-9._-]*$/;
const SCOPE_MAX = 64;

class ScopeError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ScopeError';
  }
}

// ── paths ────────────────────────────────────────────────────────────────────

/**
 * The home directory that holds ~/.coding. Mirrors lib/features/resolve.cjs:57
 * exactly — CODING_HOME is the established per-install seam and the two modules
 * must never disagree about where ~/.coding is.
 */
function codingHome(opts = {}) {
  return opts.homeDir || process.env.CODING_HOME || os.homedir();
}

/**
 * Where the tools themselves are checked out.
 *
 * CODING_TOOLS_PATH first, matching the precedence the ETM already uses at
 * scripts/enhanced-transcript-monitor.js:501 (note that :29 in the same file has
 * these two reversed — a pre-existing inconsistency this function replaces).
 */
function toolsRepo(opts = {}) {
  return (
    opts.toolsRepo ||
    process.env.CODING_TOOLS_PATH ||
    process.env.CODING_REPO ||
    path.resolve(__dirname, '..', '..')
  );
}

/** Exposed as a function, not a constant, so tests can redirect HOME per-call. */
function scopePaths(opts = {}) {
  return {
    home: opts.scopeFilePath || path.join(codingHome(opts), '.coding', 'scope'),
  };
}

// ── parsing ──────────────────────────────────────────────────────────────────

/**
 * Read a scope file: the first line that is neither blank nor a `#` comment.
 *
 * Plain text rather than YAML on purpose. The value is a single scalar, this is
 * a hot CJS path, and a one-line file cannot develop the "valid YAML, wrong
 * shape" failure mode that `parseLayer` needs a page of validation to catch.
 *
 * Returns null when the file does not exist. Any other error propagates: an
 * unreadable scope file must not silently become the default tenant, because the
 * data root moves with it and the symptom would be a knowledge base that looks
 * empty rather than an error.
 */
function readScopeFile(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw new ScopeError(`cannot read scope file ${file}: ${err.message}`);
  }
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    return trimmed;
  }
  return null;
}

/**
 * Normalise then validate. Lowercasing rather than rejecting mixed case means
 * `RaaS` and `raas` cannot become two directories holding half a knowledge base
 * each, and it matches the existing config/teams/<id>.json convention where the
 * id is lowercase and the display name is a separate field.
 */
function normaliseScope(value, source) {
  if (typeof value !== 'string') {
    throw new ScopeError(`${source}: scope must be a string, got ${typeof value}`);
  }
  const scope = value.trim().toLowerCase();
  if (!scope) {
    throw new ScopeError(`${source}: scope is empty`);
  }
  if (scope.length > SCOPE_MAX) {
    throw new ScopeError(`${source}: scope '${scope}' is longer than ${SCOPE_MAX} characters`);
  }
  if (!SCOPE_RE.test(scope)) {
    throw new ScopeError(
      `${source}: scope '${scope}' is not usable as a directory name — ` +
        `must start with a letter or digit and contain only letters, digits, '.', '_' and '-'`,
    );
  }
  return scope;
}

// ── resolution ───────────────────────────────────────────────────────────────

/**
 * Full resolution with provenance. `resolveScope()` is the thin wrapper; this is
 * what the dashboard, `coding-features status` and the installer use so they can
 * all say WHERE the answer came from rather than just what it is.
 *
 * @returns {{scope: string, source: 'env'|'home'|'default', path: string|null, isDefault: boolean}}
 */
function explain(opts = {}) {
  const env = (opts.env || process.env).CODING_SCOPE;
  if (env != null && String(env).trim() !== '') {
    return {
      scope: normaliseScope(env, 'env CODING_SCOPE'),
      source: 'env',
      path: null,
      isDefault: false,
    };
  }

  const paths = scopePaths(opts);
  const fromFile = readScopeFile(paths.home);
  if (fromFile != null) {
    return {
      scope: normaliseScope(fromFile, paths.home),
      source: 'home',
      path: paths.home,
      isDefault: false,
    };
  }

  return { scope: DEFAULT_SCOPE, source: 'default', path: null, isDefault: true };
}

/** The resolved scope for this installation. */
function resolveScope(opts = {}) {
  return explain(opts).scope;
}

// ── "am I the tools repo?" ───────────────────────────────────────────────────

/**
 * Whether `projectPath` IS the tools checkout.
 *
 * This replaces five disagreeing tests. It is a resolved-path comparison because
 * that is the only one of the five that cannot be fooled:
 *
 *   basename === 'coding'                  any directory named coding, anywhere
 *   projectPath === codingRepo             raw string equality, trailing slash
 *   filePath.includes('coding')            ~/Agentic/coding-history, ~/src/decoding
 *   targetProject.includes(codingPath)     same, plus prefix-only matches
 *   path.resolve(a) === path.resolve(b)    correct — this one
 *
 * `realpathSync` is applied on top so the symlinked LSL history path introduced
 * by the data-root split still compares equal to its target. A path that does
 * not exist yet resolves lexically instead of throwing, because the ETM asks
 * this question about projects it may not have written to yet.
 */
function isToolsRepo(projectPath, opts = {}) {
  if (!projectPath) return false;
  const real = (p) => {
    const resolved = path.resolve(p);
    try {
      return fs.realpathSync(resolved);
    } catch {
      return resolved;
    }
  };
  return real(projectPath) === real(toolsRepo(opts));
}

module.exports = {
  ScopeError,
  DEFAULT_SCOPE,
  SCOPE_RE,
  SCOPE_MAX,
  resolveScope,
  explain,
  normaliseScope,
  scopePaths,
  codingHome,
  toolsRepo,
  isToolsRepo,
};
