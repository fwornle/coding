'use strict';

/**
 * Data root — the one place that decides WHERE this installation's data lives.
 *
 * WHY THIS EXISTS. The data root used to BE the tools repo: `REPOSITORY_PATH ||
 * '/coding'` then `<root>/.data/...`. There was no shared helper, so 205
 * derivation sites across 89 production files each re-derived the root using one
 * of seven mutually inconsistent idioms (CODING_REPO, CODING_ROOT,
 * REPOSITORY_PATH, constructor-injected repositoryPath, LLM_PROXY_DATA_DIR, a
 * bare __dirname walk-up, and bare cwd-relative literals — the last of which made
 * the answer depend on which launcher started the process). The consequence was
 * that a colleague's knowledge base lived inside their clone of someone else's
 * tools repo, on top of 119 MB of that person's committed KB content.
 *
 * WHY COMMONJS. Matches lib/features/resolve.cjs and lib/scope/resolve.cjs: the
 * status line is CJS and renders on every prompt. `lib/paths/index.mjs`
 * re-exports this, so there is exactly one implementation.
 *
 * ── LAYOUT ───────────────────────────────────────────────────────────────────
 *
 *   ~/.coding/data/<scope>/        the user-data repo checkout (a git root, or
 *   │                              just a directory if the user declined to name
 *   │                              a remote at install time)
 *   ├── .gitignore                 ships ignoring var/ — see WHY THREE SUBTREES
 *   ├── history/                   LSL transcripts            TRACKED
 *   ├── kb/                        knowledge worth keeping     TRACKED
 *   │   ├── knowledge-graph/exports/      graph JSON exports
 *   │   ├── knowledge-graph/insights/     puml + png per insight
 *   │   ├── observation-export/           observations, digests, insights
 *   │   └── knowledge-export/             per-team JSON
 *   └── var/                       machine-local churn        NOT TRACKED
 *       ├── knowledge-graph/leveldb/      rebuildable from kb/…/exports
 *       ├── llm-proxy/token-usage.db      233 MB today
 *       ├── measurements/                 2.8 GB today
 *       ├── run-snapshots/                28 GB today
 *       ├── experiments/{leveldb,exports}
 *       └── kgbench/runs/
 *
 * WHY THREE SUBTREES AND NOT ONE. The user-data repo exists so a team can track
 * and share its knowledge. Putting everything under one root would put a 233 MB
 * SQLite file, 2.8 GB of measurement archives and 28 GB of run snapshots on the
 * same side of the line as a 30 KB insight export — nobody commits that, so the
 * repo would need a hand-maintained ignore list that drifts the first time a new
 * cache directory appears. Splitting at the root instead means the default is
 * correct in both directions: everything under kb/ and history/ is intended to be
 * committed, everything under var/ is intended not to be, and a new cache
 * directory added under var/ is ignored without anyone editing anything.
 *
 * LevelDB is deliberately on the var/ side. It is a projection: km-core's
 * `hydrate()` rebuilds the graph from the JSON exports on open, which is the
 * documented recovery path when the store is corrupted. Tracking both would
 * commit the same knowledge twice, in a binary format that cannot merge.
 *
 * ONTOLOGIES ARE NOT HERE, on purpose. `.data/ontologies/**` stays committed in
 * the TOOLS repo: it is shipped schema, not user data, and every install needs
 * the same copy. Sites that resolve an ontology directory are intentionally left
 * deriving from the repo root.
 */

const fs = require('node:fs');
const path = require('node:path');

const scope = require('../scope/resolve.cjs');

// ── the root ─────────────────────────────────────────────────────────────────

/**
 * The data root for this installation.
 *
 * CODING_DATA_HOME wins outright — it is how the clean-room install test, the
 * experiment sandboxes and CI point a whole process tree at a throwaway root.
 * Otherwise it is derived from the scope, so two scopes on one machine cannot
 * collide and neither can ever reach the other's knowledge.
 */
function dataHome(opts = {}) {
  const override = (opts.env || process.env).CODING_DATA_HOME;
  if (override != null && String(override).trim() !== '') {
    return path.resolve(String(override).trim());
  }
  if (opts.dataHome) return path.resolve(opts.dataHome);
  return path.join(scope.codingHome(opts), '.coding', 'data', scope.resolveScope(opts));
}

// ── the three subtrees ───────────────────────────────────────────────────────

/** LSL transcripts. `<project>/.specstory/history` symlinks here. TRACKED. */
function historyDir(opts = {}) {
  return path.join(dataHome(opts), 'history');
}

/** Knowledge worth keeping and sharing. TRACKED. */
function kbDir(opts = {}) {
  return path.join(dataHome(opts), 'kb');
}

/** Machine-local churn: databases, caches, archives, snapshots. NOT TRACKED. */
function varDir(opts = {}) {
  return path.join(dataHome(opts), 'var');
}

// ── knowledge base ───────────────────────────────────────────────────────────

/**
 * The graph's durable JSON exports — what km-core hydrates FROM, and the reason
 * the LevelDB below is disposable.
 */
function graphExportsDir(opts = {}) {
  return path.join(kbDir(opts), 'knowledge-graph', 'exports');
}

/** Generated puml/png per insight. */
function insightsDir(opts = {}) {
  return path.join(kbDir(opts), 'knowledge-graph', 'insights');
}

/** The observation cold store: observations.json, digests.json, insights.json. */
function observationExportDir(opts = {}) {
  return path.join(kbDir(opts), 'observation-export');
}

/** Per-team JSON exports (`<team>.json`). */
function knowledgeExportDir(opts = {}) {
  return path.join(kbDir(opts), 'knowledge-export');
}

// ── volatile ─────────────────────────────────────────────────────────────────

/** The live graph store. Rebuildable from graphExportsDir(). */
function graphDbDir(opts = {}) {
  return path.join(varDir(opts), 'knowledge-graph', 'leveldb');
}

/**
 * What the proxy family calls its "data dir": the directory it appends
 * `llm-proxy/token-usage.db`, `llm-proxy-export/`, `measurements/` and
 * `active-measurement.json` to.
 *
 * LLM_PROXY_DATA_DIR still wins when set. That is not legacy tolerance — it is
 * what lets the proxy keep running against the old location while the rest of the
 * migration lands, and it is already in ENV_CONTRACT_KEYS
 * (lib/experiments/run-launch.mjs:38) so experiment subprocesses inherit it.
 *
 * NOTE for callers replacing `${LLM_PROXY_DATA_DIR%/.data}`: that suffix-strip in
 * _work/rapid-llm-proxy/bin/start-llm-proxy.sh recovered the repo root from the
 * data dir. Once the two are unrelated it yields a wrong path silently, so the
 * repo root must be passed explicitly instead.
 */
function proxyDataDir(opts = {}) {
  const override = (opts.env || process.env).LLM_PROXY_DATA_DIR;
  if (override != null && String(override).trim() !== '') {
    return path.resolve(String(override).trim());
  }
  return varDir(opts);
}

/**
 * The token-accounting database.
 *
 * The filename lives here, not at each call site. Fifteen production sites used to
 * compose `<dataDir>/llm-proxy/token-usage.db` themselves through four different
 * fallback chains, and three of them omitted `LLM_PROXY_DATA_DIR` entirely — so
 * they read a different database than the proxy wrote to, silently, whenever that
 * variable was set.
 */
function tokenUsageDb(opts = {}) {
  return path.join(proxyDataDir(opts), 'llm-proxy', 'token-usage.db');
}

/** Where the proxy writes its per-bucket token-usage JSON exports. */
function proxyExportDir(opts = {}) {
  return path.join(proxyDataDir(opts), 'llm-proxy-export');
}

/**
 * The active-measurement handoff file, optionally per-agent.
 *
 * Written by the proxy (measurement-span.ts), read by the experiment and
 * measurement tooling — so it has to resolve identically on both sides.
 */
function activeMeasurementPath(agent, opts = {}) {
  const name = agent ? `active-measurement.${agent}.json` : 'active-measurement.json';
  return path.join(proxyDataDir(opts), name);
}

/** Foreground auto-measurement state (session titles and friends). */
function autoMeasureDir(opts = {}) {
  return path.join(varDir(opts), 'auto-measure');
}

/** Experiment store: `{leveldb,exports}` both live here — run data, not knowledge. */
function experimentsDir(opts = {}) {
  return path.join(varDir(opts), 'experiments');
}

/** kgbench run trees. */
function kgbenchDir(opts = {}) {
  return path.join(varDir(opts), 'kgbench');
}

/** Measurement archives (2.8 GB on the developer's machine today). */
function measurementsDir(opts = {}) {
  return path.join(varDir(opts), 'measurements');
}

/** Repro snapshots (28 GB on the developer's machine today). */
function runSnapshotsDir(opts = {}) {
  return path.join(varDir(opts), 'run-snapshots');
}

// ── introspection and setup ──────────────────────────────────────────────────

/**
 * Everything a diagnostic surface needs in one call, so `coding-features status`,
 * the dashboard and the installer can all report the same thing — including
 * WHERE the scope came from and whether it is still the placeholder default.
 */
function explain(opts = {}) {
  const s = scope.explain(opts);
  const root = dataHome(opts);
  const override = (opts.env || process.env).CODING_DATA_HOME;
  return {
    scope: s.scope,
    scopeSource: s.source,
    scopePath: s.path,
    scopeIsDefault: s.isDefault,
    dataHome: root,
    dataHomeOverridden: override != null && String(override).trim() !== '',
    exists: fs.existsSync(root),
    tracked: fs.existsSync(path.join(root, '.git')),
    history: historyDir(opts),
    kb: kbDir(opts),
    var: varDir(opts),
  };
}

/**
 * Create the data root and its three subtrees, idempotently.
 *
 * Writes `.gitignore` only when absent, so a user who has edited theirs keeps it.
 * The ignore list is the whole point of the var/ split, so a root created without
 * it is a root that will eventually stage a 28 GB snapshot directory.
 */
function ensureDataHome(opts = {}) {
  const root = dataHome(opts);
  for (const dir of [root, historyDir(opts), kbDir(opts), varDir(opts)]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const ignore = path.join(root, '.gitignore');
  if (!fs.existsSync(ignore)) {
    fs.writeFileSync(
      ignore,
      [
        '# Machine-local churn: databases, caches, archives, snapshots.',
        '# Everything here is either rebuildable or too large to version.',
        '# See lib/paths/data-home.cjs for why this split exists.',
        'var/',
        '',
      ].join('\n'),
      'utf8',
    );
  }
  return root;
}

module.exports = {
  dataHome,
  tokenUsageDb,
  proxyExportDir,
  activeMeasurementPath,
  autoMeasureDir,
  historyDir,
  kbDir,
  varDir,
  graphExportsDir,
  insightsDir,
  observationExportDir,
  knowledgeExportDir,
  graphDbDir,
  proxyDataDir,
  experimentsDir,
  kgbenchDir,
  measurementsDir,
  runSnapshotsDir,
  explain,
  ensureDataHome,
};
