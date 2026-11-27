'use strict';

/**
 * Every user-facing surface of `coding`, mapped to the feature it belongs to or
 * to `core` (.planning/coding-releases.md, P1).
 *
 * The point is that nothing is left UNMAPPED: tests/features/surface-registry
 * fails when a `bin/*` command or a dashboard route exists that is not listed
 * here, or when an entry disagrees with the code's own guard. That is what keeps
 * "is coding fully composable?" an answerable question.
 *
 * `core` = always present, never switchable: the launcher and its resolver, the
 * feature editor, the health of the machine itself. Everything else names its
 * feature.
 *
 * CLIs: `guard: true` means the command refuses (exit 2, lib/features/require-feature.sh)
 * while its feature is off. An unguarded non-core command says why in `why`.
 */

/** What core consists of, in words — rendered in docs/architecture/features.md. */
const CORE = [
  'bin/coding (the launcher, agent selection, run mode) and coding.bat (the WSL pointer)',
  'the feature resolver and writer (lib/features/), bin/coding-features, the Features tab',
  'config/ and the data home (~/.coding/, bin/coding-data-home)',
  'the repo → project mapping (lib/teams/config.cjs projectIdFor, attribution, the kb layout)',
  'machine status and housekeeping: bin/status, bin/mcp-status, bin/cleanup-orphans',
  'agent plumbing every agent needs: bin/claude-mcp, bin/gsd-browser (browser automation), bin/llm (Docker Model Runner, deliberately not the proxy)',
];

/** @type {Record<string, {feature: string, guard?: boolean, why?: string}>} */
const CLIS = {
  'bin/coding': { feature: 'core' },
  'bin/coding.bat': { feature: 'core' },
  'bin/coding-features': { feature: 'core' },
  'bin/coding-data-home': { feature: 'core' },
  'bin/status': { feature: 'core' },
  'bin/mcp-status': { feature: 'core' },
  'bin/cleanup-orphans': { feature: 'core' },
  'bin/claude-mcp': { feature: 'core' },
  'bin/gsd-browser': { feature: 'core' },
  'bin/llm': { feature: 'core' },
  'bin/semantic': { feature: 'knowledge', guard: true },
  'bin/vkb': { feature: 'knowledge', guard: true },
  'bin/clean-knowledge-base': { feature: 'knowledge', guard: true },
  'bin/fix-knowledge-base': { feature: 'knowledge', guard: true },
  'bin/ckb': {
    feature: 'knowledge',
    guard: false,
    why: 'BROKEN: a tracked symlink whose target is the text of a wrapper script, not a path — it cannot run. Delete or restore.',
  },
  'bin/graphify': { feature: 'codegraph', guard: true },
  'bin/codegraph': { feature: 'codegraph', guard: true },
  'bin/constraints': { feature: 'constraints', guard: true },
  'bin/log-session': { feature: 'lsl', guard: true },
  'bin/init-history.sh': {
    feature: 'lsl',
    guard: false,
    why: "sets up the tools repo's own learning checkout; run by install.sh only when lsl is on",
  },
  'bin/statusline-click': {
    feature: 'statusline',
    guard: false,
    why: 'only tmux calls it, from a status line that exists only while statusline is on',
  },
};

/**
 * Dashboard routes (integrations/system-health-dashboard/src/App.tsx). A route
 * of a feature renders through that feature's gate (`gated(...)`); the nav
 * entry for it, where there is one, gates on the same feature. A route that
 * cannot be gated says why.
 * @type {Record<string, {feature: string, why?: string}>}
 */
const ROUTES = {
  '/': { feature: 'health', why: 'the dashboard itself is the health feature: with it off nothing serves this page' },
  '/sessions': { feature: 'lsl' },
  '/observations': { feature: 'observations' },
  '/digests': { feature: 'observations' },
  '/insights': { feature: 'observations' },
  '/coverage': { feature: 'knowledge' },
  '/token-usage': { feature: 'llm-proxy' },
  '/performance': { feature: 'performance' },
  '/performance/timeline/:taskId': { feature: 'performance' },
  '/cluster': { feature: 'cluster' },
  '/teams': { feature: 'teams' },
  '/features': { feature: 'core' },
};

module.exports = { CORE, CLIS, ROUTES };
