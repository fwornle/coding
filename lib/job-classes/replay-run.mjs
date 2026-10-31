/**
 * Replay a past turn with the incumbent and a candidate model, judge the answers,
 * and keep the result (.planning/shared-job-classes.md, P4 "The loop", steps 2–4).
 *
 * THE TURN'S OWN AGENT, WHICHEVER IT WAS. A turn is replayed in the agent that
 * ran it — claude, copilot, opencode or pi — through kgbench's adapters
 * (resolveAgent: argv, answer elicitation, model spelling per agent) and its
 * runAgent (process-group kill, host-stall detection, the tool audit), with
 * agentEnv (proxy pinned, keys stripped, knowledge injection off). Nothing here
 * reads an agent's own transcript: the turn comes from the proxy's record.
 *
 * NO CREDENTIAL OF ITS OWN. Each arm starts a fresh session (replay-sandbox.mjs
 * renderPrompt), so it runs under the agent's normal login and writes into no
 * session store the user reads: claude with --no-session-persistence, pi with
 * --no-session, copilot with COPILOT_HOME inside the sandbox (its model calls go
 * to the proxy, BYOK). opencode has no such switch; its replay sessions land in
 * its history (a recorded gap).
 *
 * NEVER LABELLED AS A PERSON'S TURN. Every arm is bound to a task id through the
 * launcher's own wiring (lib/agents/proxy-routing.mjs wireAgentEnv): the claude
 * x-task-id header, copilot's and opencode's task-scoped proxy path, pi's header
 * extension. The proxy's job-class tagger skips task-bound requests, so a replay
 * cannot become a new labelled turn (the self-reinforcing channel kgbench
 * documents; six replay turns were labelled in the 2026-10-29 run). An arm the
 * wiring cannot bind is refused, not run unbound.
 *
 * Each arm gets its own tree, built the same way, and the run refuses when their
 * tree digests differ: two arms must answer the same input.
 *
 * PARITY GAPS, recorded on every result rather than claimed solved: the earlier
 * conversation arrives as text, not as the agent's own session; knowledge
 * injection is off (that day's digests would hand the replay the future, today's
 * are not what it saw); hooks are absent; git-ignored files are not in the tree;
 * live services are unreachable from the sandbox.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { runAgent, toolViolations, assertProxyReachable, PROXY_PORT } from '../kgbench/runner.mjs';
import { resolveAgent } from '../kgbench/agents.mjs';
import { prepareAgentMcp } from '../kgbench/agent-sandbox.mjs';
import { cellTaskId } from '../kgbench/tokens.mjs';
import { wireAgentEnv } from '../agents/proxy-routing.mjs';
import { replayRoot, repoForProject } from './turn-capture.mjs';
import { SANDBOX_ROOT, buildTree, futureLeaks, renderPrompt, sandboxProfile, treeDigest } from './replay-sandbox.mjs';
import { judgePair } from './replay-judge.mjs';

const require = createRequire(import.meta.url);
const dataHome = require('../paths/data-home.cjs');

const CODING_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Answer-only turns read; they do not edit. Bash stays for `git log`/`ls`, inside the OS sandbox. claude only: the others have no tool allowlist. */
export const DEFAULT_TOOLS = ['Read', 'Glob', 'Grep', 'Bash'];
export const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

export const PARITY_GAPS = [
  'the earlier conversation arrives as text in a fresh session, not as the agent\'s own session',
  'knowledge injection off (the turn saw that day\'s digests)',
  'no hooks: the health line the turn saw is absent',
  'live services unreachable from the sandbox (only the proxy port is open)',
];

/** What each agent's replay cannot hold to, beyond PARITY_GAPS. */
const AGENT_GAPS = {
  claude: [],
  copilot: ['built-in tools ungated (copilot\'s tool names are not mapped to the arm\'s)', 'copilot runs with an empty COPILOT_HOME: none of the user\'s copilot config'],
  opencode: ['built-in tools ungated (opencode has no tool allowlist)', 'opencode\'s session database stays readable, and the replay\'s sessions land in its history'],
  pi: ['built-in tools ungated (pi\'s tool names are not mapped to the arm\'s)'],
};

/** Extra arguments that keep an arm out of the agent's session history. */
const NO_HISTORY_ARGS = { claude: ['--no-session-persistence'], pi: ['--no-session'], copilot: [], opencode: [] };

export function runsDir(opts = {}) {
  return path.join(replayRoot(opts), 'runs');
}

/** A stable, filesystem-safe id for a labelled turn. */
export function turnKey(label) {
  return `${label.conversationKey}-t${label.turnIndex}`;
}

/** The checkout a turn ran in: its capture's, or the project's discovered repo. */
export function liveRepoOf(c) {
  if (c.capture?.meta.repoRoot) return c.capture.meta.repoRoot;
  const r = repoForProject(c.label.project);
  if (!r.dir) throw new Error(`refused: ${r.reason}`);
  return r.dir;
}

/** PATH without the live repos: a shim there (coding/bin) is unreadable inside the sandbox anyway. */
function sandboxPath(p = process.env.PATH || '', home = os.homedir()) {
  const live = path.join(home, 'Agentic');
  return p.split(path.delimiter).filter((d) => d && !(d === live || d.startsWith(`${live}/`))).join(path.delimiter);
}

/**
 * Build one arm's sandbox: tree, prompt, profile. Throws when the sandbox can see past the turn.
 */
function prepareArm({ c, armId, sbxRoot, liveRepo, submodules, osSandbox }) {
  const base = path.join(sbxRoot, armId);
  const repo = path.join(base, 'repo');
  const tree = buildTree({ capture: c.capture, liveRepo, at: c.record.at, dir: repo, submodules });
  const prompt = renderPrompt(c.record, { liveRepo, sandboxPath: repo });
  const subDirs = (c.capture?.meta.submodules || []).map((s) => path.join(repo, s.path));
  const leaks = futureLeaks({ tree: repo, turnAt: c.record.at, promptText: prompt, liveRepo, submoduleDirs: subDirs });
  if (leaks.length) {
    const err = new Error(`refused: the sandbox can see past the turn — ${leaks.join('; ')}`);
    err.leaks = leaks;
    throw err;
  }
  let profileFile = null;
  if (osSandbox) {
    profileFile = path.join(base, 'profile.sb');
    fs.writeFileSync(profileFile, sandboxProfile({ sandboxDir: base, proxyPort: Number(PROXY_PORT) }));
  }
  return { armId, base, repo, prompt, profileFile, tree, digest: treeDigest(repo) };
}

/** One spelling for a model id across agents and the proxy: `rapid-proxy/claude-haiku-5.5` = `claude-haiku-5-5`. */
export const modelKey = (m) => String(m || '').replace(/^[a-z-]+\//, '').replace(/\./g, '-').toLowerCase();

/**
 * The models the proxy actually served an arm, by its task id — the only
 * authority on which model answered (kgbench's `doctor` lesson: a run published
 * one model while the proxy served another, and nothing said so).
 * @returns {Array<{model: string, calls: number, outputTokens: number}>}
 */
export function servedModels(taskId, opts = {}) {
  const file = opts.tokenDb || dataHome.tokenUsageDb(opts);
  if (!opts.db && !fs.existsSync(file)) return [];
  const Database = opts.db ? null : require('better-sqlite3');
  const db = opts.db || new Database(file, { readonly: true, fileMustExist: true });
  try {
    return db.prepare(`SELECT model, COUNT(*) AS calls, SUM(output_tokens) AS outputTokens FROM token_usage
      WHERE task_id = ? GROUP BY model ORDER BY outputTokens DESC`).all(taskId);
  } finally {
    if (!opts.db) db.close();
  }
}

/**
 * An arm answered by the model it asked for: that model wrote most of the output.
 * An agent may make a utility call on another model (a title, a summary); that
 * alone does not void the arm, a different model doing the answering does.
 */
export function servedAsAsked(asked, served) {
  if (!served.length) return false;
  return modelKey(served[0].model) === modelKey(asked);
}

/** The agent's adapter, run under sandbox-exec when there is a profile, kept out of its session history. */
function sandboxedAdapter(adapter, profileFile) {
  const extra = NO_HISTORY_ARGS[adapter.id] || [];
  return {
    ...adapter,
    binary: profileFile ? 'sandbox-exec' : adapter.binary,
    argv: (a) => [...(profileFile ? ['-f', profileFile, adapter.binary] : []), ...adapter.argv(a), ...extra],
  };
}

async function runArm({ prep, agent, model, tools, timeoutMs, runId, key, env = process.env }) {
  const adapter = resolveAgent(agent, { modelRef: model, repoRoot: CODING_ROOT });
  const taskId = cellTaskId({ runId, agent, model, arm: prep.armId, question: key, rep: 1 });
  const arm = { id: prep.armId, model: adapter.model, timeoutMs, allowedTools: tools, mcpConfig: { mcpServers: {} } };
  let base = { ...env, PATH: sandboxPath(env.PATH) };
  delete base.OPENCODE_CONFIG_CONTENT; // an inherited one is the spawning session's, not the arm's
  if (agent === 'copilot') {
    base.COPILOT_HOME = path.join(prep.base, 'copilot-home');
    fs.mkdirSync(base.COPILOT_HOME, { recursive: true });
  }
  // opencode reads MCP servers from its config home: pin a copy with none.
  if (agent === 'opencode') base = prepareAgentMcp({ agent, arm, cwd: prep.repo, runDir: prep.base, env: base }).env;
  const wired = await wireAgentEnv(agent, base, {
    taskId, model: adapter.model, targetProjectDir: prep.base, piConfigDir: path.join(prep.base, 'pi-agent'), onUnreachable: 'unrouted',
  });
  if (wired.unrouted) {
    return { arm: prep.armId, agent, model, taskId, outcome: 'unbound', error: 'the proxy wiring failed: an unbound replay would be labelled as a person\'s turn', answer: '' };
  }
  const r = await runAgent({ prompt: prep.prompt, arm, cwd: prep.repo, env: wired.env, agent: sandboxedAdapter(adapter, prep.profileFile) });
  const escapes = r.outcome === 'ok' && adapter.toolVocabulary === 'arm' ? toolViolations(arm, r.tools_executed) : [];
  const served = servedModels(taskId);
  const wrongModel = r.outcome === 'ok' && !servedAsAsked(adapter.model, served);
  return {
    arm: prep.armId, agent, model: adapter.model, taskId, served,
    outcome: escapes.length ? 'tool_escape' : wrongModel ? 'wrong_model' : r.outcome,
    ...(escapes.length ? { escapes } : {}),
    error: r.error || null,
    answer: r.answer || '',
    tools: r.tools || [], toolsExecuted: r.tools_executed || [], toolsDenied: r.tools_denied || [],
    numTurns: r.num_turns ?? null, inTokens: r.in_tokens ?? null, outTokens: r.out_tokens ?? null,
    totalTokens: r.total_tokens ?? null, costUsd: r.cost_usd ?? null, wallS: r.wall_s ?? null,
  };
}

/**
 * Replay one turn (a replay-locate.mjs candidate) with every arm, then judge.
 *
 * @param {object} o
 * @param {object} o.c                a usable candidate {label, record, capture}
 * @param {string} o.candidate        the candidate model
 * @param {string} [o.incumbent]      default: the model that answered the real turn
 * @param {string} [o.agent]          default: the agent that ran the real turn
 * @param {boolean} [o.aa=false]      also replay the incumbent a second time (the A/A floor between replays)
 * @returns {Promise<object>} the result record (also appended to runs/<runId>/results.jsonl)
 */
export async function replayTurn({
  c, candidate, incumbent, agent, runId, aa = false, tools = DEFAULT_TOOLS, timeoutMs = DEFAULT_TIMEOUT_MS,
  submodules = true, osSandbox = process.platform === 'darwin', keep = false, judge = judgePair, dryRun = false, ...opts
}) {
  const key = turnKey(c.label);
  const who = agent || c.label.agent;
  const inc = incumbent || c.label.model;
  const record = {
    schema: 2, runId, key, at: new Date().toISOString(), agent: who,
    jobClass: c.label.jobClass, teacherClass: c.label.teacherClass, taxonomy: c.label.taxonomy, project: c.label.project,
    promptAt: c.record.at, incumbent: inc, candidate,
    captured: !!c.capture, osSandbox, tools: who === 'claude' ? tools : 'ungated',
    gaps: [...PARITY_GAPS, ...(AGENT_GAPS[who] || []), ...(osSandbox ? [] : ['no OS sandbox: tool rules and the audit only'])],
    arms: [], trial: null, floor: null, floorReal: null, refused: null,
  };
  if (!inc) return { ...record, refused: 'no incumbent model: the turn\'s token rows name none; pass --incumbent' };
  const arms = [{ id: 'incumbent', model: inc }, ...(aa ? [{ id: 'incumbent-b', model: inc }] : []), { id: 'candidate', model: candidate }];
  const sbxRoot = path.join(SANDBOX_ROOT, runId, key);
  try {
    const liveRepo = liveRepoOf(c);
    const preps = arms.map((a) => prepareArm({ c, armId: a.id, sbxRoot, liveRepo, submodules, osSandbox }));
    record.gaps.push(...preps[0].tree.gaps);
    record.sha = preps[0].tree.sha;
    const digests = new Set(preps.map((p) => p.digest));
    if (digests.size !== 1) throw new Error(`refused: the arms' trees differ (${[...digests].map((d) => d.slice(0, 8)).join(' ≠ ')})`);
    record.digest = preps[0].digest;
    // A dry run stops here: the sandboxes are built and checked, nothing is spawned or recorded.
    if (dryRun) return { ...record, dryRun: true, promptChars: preps[0].prompt.length, sandbox: keep ? sbxRoot : null };
    for (const [i, a] of arms.entries()) {
      record.arms.push(await runArm({ prep: preps[i], agent: who, model: a.model, tools, timeoutMs, runId, key }));
    }
  } catch (err) {
    record.refused = err.message;
    if (dryRun) return { ...record, dryRun: true };
  } finally {
    if (!keep) {
      fs.rmSync(sbxRoot, { recursive: true, force: true });
      try { fs.rmdirSync(path.dirname(sbxRoot)); } catch { /* another turn of the run is still there */ }
    }
  }

  const ok = (id) => record.arms.find((a) => a.arm === id && a.outcome === 'ok' && a.answer);
  const request = c.record.prompt;
  if (ok('incumbent') && ok('candidate')) record.trial = await judge({ request, a: ok('incumbent').answer, b: ok('candidate').answer });
  if (ok('incumbent') && c.record.answer) record.floorReal = await judge({ request, a: c.record.answer, b: ok('incumbent').answer });
  if (ok('incumbent') && ok('incumbent-b')) record.floor = await judge({ request, a: ok('incumbent').answer, b: ok('incumbent-b').answer });
  // The A/A floor is the replay-vs-replay pair when it was run, else the real answer vs the incumbent's replay.
  if (!record.floor) record.floor = record.floorReal;

  const dir = path.join(runsDir(opts), runId);
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(path.join(dir, 'results.jsonl'), `${JSON.stringify(record)}\n`);
  return record;
}

/** A run id that sorts by time and fits the proxy's task-id charset. */
export function newRunId(now = new Date()) {
  return `jcr-${now.toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-')}`;
}

/** Every result of every run (or of the named ones). */
export function readResults({ runIds, ...opts } = {}) {
  const root = runsDir(opts);
  let ids;
  try { ids = runIds?.length ? runIds : fs.readdirSync(root); } catch { return []; }
  const out = [];
  for (const id of ids) {
    let text;
    try { text = fs.readFileSync(path.join(root, id, 'results.jsonl'), 'utf8'); } catch { continue; }
    for (const line of text.split('\n')) {
      if (!line) continue;
      try { out.push(JSON.parse(line)); } catch { /* torn line */ }
    }
  }
  return out;
}

/** Fail-closed precondition: the proxy answers (every arm's model calls go through it). */
export async function preflight() {
  const proxy = await assertProxyReachable();
  return proxy.ok ? { ok: true } : { ok: false, error: proxy.detail };
}
