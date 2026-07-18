#!/usr/bin/env node
/**
 * Measurement reconciler — standalone always-on auto-measure process
 * (Phase 68-04, auto-measure Plan B, Phase 3).
 *
 * Polls each coding agent's foreground session (lib/measurement/
 * foreground-sessions.mjs) and keeps <dataDir>/active-measurement.<agent>.json
 * in sync so the proxy tap (resolveAgentSpanTaskId) binds live wire traffic to
 * the RIGHT task_id — giving interactive sessions a real context-window
 * breakdown WITHOUT the operator ever running `measurement-start` by hand.
 *
 * Ownership contract (why this never fights manual/experiment measurement):
 *   - The GLOBAL slot active-measurement.json is owned by manual measurement +
 *     experiments. This process NEVER reads or writes it.
 *   - Each per-agent slot active-measurement.<agent>.json is owned HERE. The
 *     reconciler only ever overwrites/clears slots it stamped
 *     (meta.source === 'reconciler'); an operator-authored per-agent slot is
 *     left untouched.
 *
 * State machine, per agent, per tick:
 *   detect → fresh?  ──yes─▶ bound to this session?  ──no─▶ start span
 *                    │                                └─yes▶ no-op
 *                    └no──▶ own a stale reconciler slot?  ──yes─▶ clear it
 *                                                          └─no─▶ no-op
 *
 * Config — config/behavior.json (hot-reloaded each tick, non-fatal if absent):
 *   { "autoMeasure": {
 *       "enabled": true,
 *       "agents": { "claude": true, "opencode": true, "copilot": true },
 *       "freshnessMs": 120000, "pollMs": 5000 } }
 * A disabled agent (globally or individually) has its reconciler slot cleared.
 *
 * Env:
 *   LLM_PROXY_DATA_DIR  data dir for the span files (default <REPO_ROOT>/.data)
 *   LLM_PROXY_DIST_DIR  proxy dist dir (default _work/rapid-llm-proxy/dist)
 *   CODING_REPO         repo root (default /Users/Q284340/Agentic/coding)
 *   BEHAVIOR_CONFIG     behavior.json path (default <REPO_ROOT>/config/behavior.json)
 *
 * Usage:
 *   node scripts/measurement-reconciler.mjs [--once] [--verbose]
 */

import process from 'node:process';
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

import {
  AUTO_MEASURE_AGENTS,
  detectForegroundSession,
} from '../lib/measurement/foreground-sessions.mjs';

const REPO_ROOT = process.env.CODING_REPO || '/Users/Q284340/Agentic/coding';
const DATA_DIR = process.env.LLM_PROXY_DATA_DIR || path.join(REPO_ROOT, '.data');
const PROXY_DIST = process.env.LLM_PROXY_DIST_DIR
  || '/Users/Q284340/Agentic/_work/rapid-llm-proxy/dist';
const BEHAVIOR_CONFIG = process.env.BEHAVIOR_CONFIG
  || path.join(REPO_ROOT, 'config', 'behavior.json');

const DEFAULTS = { enabled: true, freshnessMs: 120000, pollMs: 5000 };
const SOURCE = 'reconciler';

/**
 * Load autoMeasure config, applying defaults. Missing/malformed file → defaults
 * (rule 06: degrade to safe "enabled" rather than crash the always-on loop).
 * @returns {{ enabled: boolean, freshnessMs: number, pollMs: number,
 *             agents: Record<string, boolean> }}
 */
export function loadBehaviorConfig(configPath = BEHAVIOR_CONFIG) {
  let raw = {};
  try {
    raw = JSON.parse(fs.readFileSync(configPath, 'utf8'))?.autoMeasure || {};
  } catch {
    raw = {};
  }
  return {
    enabled: raw.enabled !== false,
    freshnessMs: Number(raw.freshnessMs) > 0 ? Number(raw.freshnessMs) : DEFAULTS.freshnessMs,
    pollMs: Number(raw.pollMs) > 0 ? Number(raw.pollMs) : DEFAULTS.pollMs,
    agents: raw.agents && typeof raw.agents === 'object' ? raw.agents : {},
  };
}

/** True when auto-measure is enabled globally AND for this specific agent. */
function agentEnabled(cfg, agent) {
  return cfg.enabled && cfg.agents[agent] !== false;
}

/** Does this per-agent slot belong to the reconciler (safe to overwrite/clear)? */
function isOwnSlot(span) {
  return Boolean(span && span.meta && span.meta.source === SOURCE);
}

/**
 * Reconcile ONE agent's slot against its live foreground session.
 * Pure decision + span side-effects; returns a short action string for logging.
 *
 * @param {string} agent
 * @param {{ getActiveMeasurement: Function, startMeasurement: Function,
 *           clearAgentSpan: Function }} span
 * @param {ReturnType<typeof loadBehaviorConfig>} cfg
 * @param {{ sessionId: string, lastActivityMs: number } | null} found
 *   the detected foreground session (injected — rule 07: explicit dependency)
 * @param {number} now epoch ms (injected for testability)
 * @returns {string}
 */
export function reconcileAgent(agent, span, cfg, found, now = Date.now()) {
  const current = span.getActiveMeasurement(DATA_DIR, agent);

  if (!agentEnabled(cfg, agent)) {
    return isOwnSlot(current) && span.clearAgentSpan(agent, DATA_DIR) ? 'cleared(disabled)' : 'skip';
  }

  const fresh = found && now - found.lastActivityMs <= cfg.freshnessMs;

  if (!fresh) {
    return isOwnSlot(current) && span.clearAgentSpan(agent, DATA_DIR) ? 'cleared(stale)' : 'idle';
  }
  if (current && current.task_id === found.sessionId) return 'bound';
  if (current && !isOwnSlot(current)) return 'skip(operator-owned)';

  span.startMeasurement({
    task_id: found.sessionId,
    agent,
    goal_sentence: `auto-measured foreground ${agent} session`,
    meta: { auto: true, source: SOURCE, detected_activity_ms: found.lastActivityMs },
  }, DATA_DIR);
  return `started ${found.sessionId}`;
}

/** Run one reconciliation pass across every auto-measure agent. */
export function tick(span, cfg, log) {
  for (const agent of AUTO_MEASURE_AGENTS) {
    let action = 'error';
    try {
      action = reconcileAgent(agent, span, cfg, detectForegroundSession(agent));
    } catch (err) {
      action = `error: ${err.message}`;
    }
    if (log && action !== 'idle' && action !== 'bound' && action !== 'skip') {
      log(`[reconciler] ${agent}: ${action}`);
    }
  }
}

/** Dynamically load the proxy span surface (the single reader/writer, D-08). */
async function loadSpanModule() {
  const modUrl = pathToFileURL(path.join(PROXY_DIST, 'measurement-span.js')).href;
  const { getActiveMeasurement, startMeasurement, clearAgentSpan } = await import(modUrl);
  return { getActiveMeasurement, startMeasurement, clearAgentSpan };
}

/** Clear every reconciler-owned slot — used on shutdown to avoid orphan binds. */
function clearOwnSlots(span, log) {
  for (const agent of AUTO_MEASURE_AGENTS) {
    try {
      const cur = span.getActiveMeasurement(DATA_DIR, agent);
      if (isOwnSlot(cur) && span.clearAgentSpan(agent, DATA_DIR)) {
        log?.(`[reconciler] ${agent}: cleared(shutdown)`);
      }
    } catch {
      /* rule 06 note: shutdown cleanup is best-effort, never blocks exit */
    }
  }
}

async function main() {
  const once = process.argv.includes('--once');
  const verbose = process.argv.includes('--verbose');
  const log = verbose ? (m) => process.stderr.write(`${m}\n`) : null;
  const span = await loadSpanModule();

  if (once) {
    tick(span, loadBehaviorConfig(), log || ((m) => process.stderr.write(`${m}\n`)));
    return;
  }

  let timer = null;
  const stop = (sig) => {
    if (timer) clearInterval(timer);
    clearOwnSlots(span, log);
    process.stderr.write(`[reconciler] ${sig} — stopped\n`);
    process.exit(0);
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));

  const cfg0 = loadBehaviorConfig();
  process.stderr.write(
    `[reconciler] started (poll=${cfg0.pollMs}ms fresh=${cfg0.freshnessMs}ms `
      + `agents=${AUTO_MEASURE_AGENTS.join(',')} data=${DATA_DIR})\n`,
  );
  const run = () => tick(span, loadBehaviorConfig(), log);
  run();
  timer = setInterval(run, cfg0.pollMs);
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] || '').href;
if (isMain) {
  main().catch((err) => {
    process.stderr.write(`[reconciler] fatal: ${err.message}\n`);
    process.exit(1);
  });
}
