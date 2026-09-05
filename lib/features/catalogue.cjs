'use strict';

/**
 * The feature catalogue — the single source of truth for what `coding` can be
 * composed of.
 *
 * Nine coarse features, one per thing a user actually names. Everything that
 * gates on a feature (service starter, entrypoint, hooks, status line,
 * coordinator, dashboard, CLIs) resolves its id from here, so adding or
 * renaming a feature is a one-file change plus its gate points.
 *
 * `core` is deliberately absent: bin/coding, agent launch, config/ and the
 * resolver itself are not optional and must never be gateable.
 *
 * See docs/architecture/features.md for the full feature -> artifact matrix.
 */

/**
 * @typedef {Object} FeatureDef
 * @property {string} id
 * @property {string} label       Short human name, used in CLI and dashboard.
 * @property {string} description One line, shown next to the toggle.
 * @property {string[]} requires  Feature ids that must be enabled for this one
 *                                to function. A dependent whose dependency is
 *                                off is auto-disabled; the dependency is NEVER
 *                                auto-enabled, because that would undo an
 *                                explicit user choice.
 * @property {'live'|'apply'|'session'} applyTier
 *   How far a running system can honour a change to this feature:
 *     live    — takes effect on next read, no restart
 *     apply   — needs services started/stopped (scripts/apply-features.mjs)
 *     session — only affects agent sessions launched after the change
 * @property {boolean} needsDocker Whether enabling this feature requires the
 *                                 coding-services container.
 */

/** @type {Record<string, FeatureDef>} */
const FEATURES = {
  'lsl': {
    id: 'lsl',
    label: 'Live Session Logging',
    description: 'Verbatim session transcripts written as .specstory markdown.',
    requires: [],
    applyTier: 'apply',
    needsDocker: false,
  },
  'observations': {
    id: 'observations',
    label: 'Observations',
    description: 'The observation → digest → insight pipeline.',
    // The observation tap lives inside the enhanced transcript monitor;
    // nothing else produces observations.
    requires: ['lsl'],
    applyTier: 'apply',
    needsDocker: false,
  },
  'knowledge': {
    id: 'knowledge',
    label: 'Knowledge Base',
    description: 'Semantic analysis, UKB workflows, knowledge graph and VKB.',
    // UKB wave-analysis consumes observations and digests.
    requires: ['observations'],
    applyTier: 'apply',
    needsDocker: true,
  },
  'codegraph': {
    id: 'codegraph',
    label: 'Code Graph',
    description: 'Graphify code knowledge graph and its MCP endpoint.',
    requires: [],
    applyTier: 'apply',
    needsDocker: true,
  },
  'constraints': {
    id: 'constraints',
    label: 'Constraint Monitoring',
    description: 'Guardrail rules checked before every tool call.',
    requires: [],
    applyTier: 'session',
    needsDocker: true,
  },
  'llm-proxy': {
    id: 'llm-proxy',
    label: 'LLM Proxy',
    description: 'rapid-llm-proxy: provider routing, fallback and token accounting.',
    requires: [],
    applyTier: 'apply',
    needsDocker: false,
  },
  'performance': {
    id: 'performance',
    label: 'Performance Measurement',
    description: 'Per-task measurement, experiments and the kgbench benchmark.',
    // Token attribution is read off the proxy's usage tap.
    requires: ['llm-proxy'],
    applyTier: 'apply',
    needsDocker: false,
  },
  'health': {
    id: 'health',
    label: 'Health Monitoring',
    description: 'Health coordinator, auto-healing and the monitoring dashboard.',
    requires: [],
    applyTier: 'apply',
    // False on purpose: the coordinator and both dashboard servers have host
    // implementations (`scripts/health-coordinator.js`,
    // `integrations/system-health-dashboard/{server,static-server}.js`, started
    // by scripts/start-services-robust.js). The supervisord programs of the same
    // name are the containerised alternative, not a requirement — which is what
    // lets the `logging-only` profile run with no Docker at all.
    needsDocker: false,
  },
  'statusline': {
    id: 'statusline',
    label: 'Status Line',
    description: 'The tmux / agent status line.',
    requires: [],
    applyTier: 'live',
    needsDocker: false,
  },
};

/** Stable display/iteration order. Object key order is not a contract. */
const FEATURE_IDS = [
  'lsl',
  'observations',
  'knowledge',
  'codegraph',
  'constraints',
  'llm-proxy',
  'performance',
  'health',
  'statusline',
];

/**
 * Built-in defaults: everything on.
 *
 * This is what makes the whole change a no-op for existing users — with no
 * features.yaml anywhere, the resolved set is exactly the historical stack.
 */
function defaultFeatures() {
  const out = {};
  for (const id of FEATURE_IDS) out[id] = true;
  return out;
}

/**
 * Environment variable name for a feature id.
 * `llm-proxy` -> `CODING_FEATURE_LLM_PROXY`
 */
function envVarFor(id) {
  return `CODING_FEATURE_${id.toUpperCase().replace(/-/g, '_')}`;
}

module.exports = { FEATURES, FEATURE_IDS, defaultFeatures, envVarFor };
