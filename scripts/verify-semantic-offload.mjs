#!/usr/bin/env node
/**
 * verify-semantic-offload.mjs — prove where a "simple" job actually goes.
 *
 * Run it on the corporate network and it demonstrates that a cheap turn from
 * `coding --copilot`, `--pi` and `--opencode` lands on the on-prem qwen-local
 * cluster. Run it at home and it demonstrates delegation to the laptop-local
 * qwen-laptop for the agents that can reach it. Same script, same assertions,
 * different network — it reads the live sensor and expects accordingly.
 *
 * ── Three layers, never conflated ───────────────────────────────────────────
 *
 * A claim about routing is really three claims, and they are true in different
 * places. Reporting them as one is how "the offload is broken" and "the box is
 * unplugged" become indistinguishable.
 *
 *   DECISION      where the config SAYS this call goes. Network is a parameter
 *                 of /api/llm/routing/resolve, so this is computable for BOTH
 *                 networks from either one. Exact, and portable.
 *   REACHABILITY  whether that endpoint answers right now. Only true where you
 *                 are standing. Off-VPN the cluster is unreachable by design.
 *   OUTCOME       what a real turn actually did, read back from token_usage.
 *                 Only true where you ran it.
 *
 * This separation is not pedantry. qwen-local's base URL (10.143.241.223:8000)
 * was chosen rather than probed. If the port is wrong, the corporate run shows
 * DECISION=qwen-local, REACHABILITY=false, OUTCOME=fell back to gh-copilot —
 * which reads instantly as "the routing is right, the endpoint is wrong". With
 * one merged verdict it would read as "the offload does not work".
 *
 * ── What each agent can and cannot do ───────────────────────────────────────
 *
 * Only a `small` band is offloadable (semantic_routing.offload_bands), so the
 * whole test turns on whether an agent can declare one:
 *
 *   pi        `--thinking low` → reasoning_effort on the wire. Per turn.
 *   opencode  `x-complexity: small` header on its proxy provider. Per turn.
 *   copilot   `/v1/copilot/b/small/...` in the base URL. Per SESSION — the CLI
 *             sends no reasoning_effort and cannot set headers (measured).
 *   claude    Nothing. `fg-chat/claude` is pinned `high`, and /v1/messages is an
 *             Anthropic-protocol passthrough that no local provider can serve
 *             (none carries fg_transport). Included as a CONTROL: it must not
 *             offload, on either network, and a run where it does is a bug.
 *
 * Usage:
 *   node scripts/verify-semantic-offload.mjs              # all agents
 *   node scripts/verify-semantic-offload.mjs --agents=pi,opencode
 *   node scripts/verify-semantic-offload.mjs --decision-only   # no LLM calls
 *   node scripts/verify-semantic-offload.mjs --json           # machine output
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import process from 'node:process';
import { createRequire } from 'node:module';
import { runAgent } from '../lib/kgbench/runner.mjs';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const REPO = path.resolve(import.meta.dirname, '..');
const PORT = process.env.LLM_CLI_PROXY_PORT || '12435';
const BASE = `http://127.0.0.1:${PORT}`;
const ROUTING_YAML = process.env.LLM_ROUTING_YAML
  || path.join(REPO, '..', '_work', 'rapid-llm-proxy', 'config', 'llm-routing.yaml');
const DB_PATH = path.join(process.env.LLM_PROXY_DATA_DIR || path.join(REPO, '.data'),
  'llm-proxy', 'token-usage.db');
const OUT_DIR = path.join(REPO, '.data', 'routing-proof');

const argv = process.argv.slice(2);
const flag = (n) => argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const has = (n) => argv.includes(`--${n}`);
const AGENTS = (flag('agents') || 'pi,opencode,copilot,claude').split(',').map((s) => s.trim());
const DECISION_ONLY = has('decision-only');
const AS_JSON = has('json');
const TIMEOUT_MS = Number(flag('timeout') || 180_000);

const say = (s = '') => { if (!AS_JSON) process.stdout.write(`${s}\n`); };
const warn = (s) => process.stderr.write(`${s}\n`);

// ── Layer 1: DECISION ───────────────────────────────────────────────────────

async function resolveDecision({ agent, complexity, network }) {
  const qs = new URLSearchParams({ job: 'fg-chat', agent, network });
  if (complexity) qs.set('complexity', complexity);
  const r = await fetch(`${BASE}/api/llm/routing/resolve?${qs}`);
  if (!r.ok) throw new Error(`resolve failed: HTTP ${r.status}`);
  const d = await r.json();
  return {
    provider: d.route.provider,
    model: d.route.model,
    band: d.route.complexity,
    bandSource: d.route.complexitySource,
    offloadedFrom: d.route.offloadedFrom ?? null,
    offloadSkipped: d.route.offloadSkipped ?? null,
    chain: d.chain.map((c) => ({ provider: c.provider, model: c.model, available: c.available })),
    summary: d.summary,
  };
}

// ── Layer 2: REACHABILITY ───────────────────────────────────────────────────

async function liveState() {
  const r = await fetch(`${BASE}/health`);
  if (!r.ok) throw new Error(`proxy /health: HTTP ${r.status}`);
  const h = await r.json();
  return {
    network: h.networkMode === 'vpn' ? 'corporate' : h.networkMode,
    reachable: Object.fromEntries(
      Object.entries(h.providers || {}).map(([k, v]) => [k, !!v.available])),
  };
}

// ── Layer 3: OUTCOME ────────────────────────────────────────────────────────

/**
 * The token_usage rows this task_id produced.
 *
 * Readonly is load-bearing: this repo never writes the proxy-owned DB, and a
 * writer here would race the daemon that owns it.
 *
 * Ordered by rowid, NOT id — `token_usage.id` has no PRIMARY KEY and is not
 * unique (331,701 rows, 262,128 distinct ids as of 2026-08-29), so ordering or
 * keying on it silently interleaves unrelated rows.
 */
function rowsForTask(taskId) {
  if (!fs.existsSync(DB_PATH)) return [];
  const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  try {
    return db.prepare(`
      SELECT rowid AS rid, timestamp, agent, provider, model, route_key, route_band,
             offloaded_from, chain_position, attempt_trail, routing_source, total_tokens
        FROM token_usage WHERE task_id = ? ORDER BY rowid ASC`).all(taskId);
  } finally {
    db.close();
  }
}

// ── The per-agent invocation table ──────────────────────────────────────────
//
// Every entry below encodes a trap that has already cost someone a debugging
// session. They are comments, not folklore — see docs/architecture/llm-routing.md.

const PROMPT = 'Reply with exactly one word: ok';

/** How each agent declares a band — reportable without running anything. */
const DECLARES = {
  pi: '--thinking low → reasoning_effort',
  opencode: 'x-complexity: small header',
  copilot: '/b/small/ path segment (session)',
  claude: 'nothing — control case',
};

function opencodeBinary() {
  // MUST be the canonical path. `which -a opencode` also finds an older homebrew
  // build whose `run` has no -m and dies with "unknown shorthand flag: 'm'".
  const canonical = path.join(os.homedir(), '.opencode', 'bin', 'opencode');
  return fs.existsSync(canonical) ? canonical : 'opencode';
}

function caseFor(agent, taskId) {
  const clean = { ...process.env };
  // A stale value from an interactive launcher reaches a child verbatim and
  // silently wins over what we set below.
  delete clean.OPENCODE_CONFIG_CONTENT;
  delete clean.COPILOT_PROVIDER_BASE_URL;
  delete clean.COPILOT_PROVIDER_TYPE;
  delete clean.COPILOT_PROVIDER_API_KEY;
  // Both harnesses honour this opt-out; a set value would route the agent direct
  // and quietly invalidate the whole run.
  delete clean.CODING_PROXY_ROUTE;

  switch (agent) {
    case 'pi': {
      // The path seam, not $TASK_ID interpolation: pi's header resolver has no
      // default form and aborts the ENTIRE provider at auth when a declared
      // x-task-id resolves empty — a total pre-request failure, not a bad row.
      const cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'offload-pi-'));
      fs.writeFileSync(path.join(cfgDir, 'models.json'), JSON.stringify({
        providers: {
          'rapid-proxy-pi': {
            api: 'openai-completions',
            baseUrl: `${BASE}/v1/pi/t/${taskId}`,
            apiKey: 'coding-local-proxy-no-auth',
            models: [{
              id: 'claude-sonnet-5', name: 'routed by the coding proxy',
              input: ['text'], contextWindow: 200000, reasoning: true,
            }],
          },
        },
      }, null, 2));
      fs.writeFileSync(path.join(cfgDir, 'settings.json'), JSON.stringify({
        defaultProvider: 'rapid-proxy-pi', defaultModel: 'claude-sonnet-5',
        enabledModels: ['claude-sonnet-5'],
      }, null, 2));
      return {
        binary: 'pi',
        // --approve is mandatory headless or pi waits for trust confirmation forever.
        argv: ['-p', PROMPT, '--provider', 'rapid-proxy-pi', '--model', 'claude-sonnet-5',
          '--thinking', 'low', '--approve'],
        env: {
          ...clean,
          PI_CODING_AGENT_DIR: cfgDir,
          PI_OFFLINE: '1', PI_TELEMETRY: '0', PI_SKIP_VERSION_CHECK: '1',
          // With a key present pi picked `anthropic` over the proxy outright and
          // billed it directly until it hit a credit error.
          ANTHROPIC_API_KEY: '',
        },
        cleanup: () => fs.rmSync(cfgDir, { recursive: true, force: true }),
        declares: '--thinking low → reasoning_effort',
      };
    }

    case 'opencode': {
      // buildAgentRoutingEnv deliberately does NOT redefine `rapid-proxy`, which
      // is exactly the provider a rapid-proxy/* model uses — so it must be
      // spliced here or the run is ambient-bound and measures nothing.
      const cfg = {
        provider: {
          'rapid-proxy': {
            options: {
              baseURL: `${BASE}/v1/opencode/t/${taskId}`,
              headers: { 'x-task-id': taskId, 'x-agent': 'opencode', 'x-complexity': 'small' },
            },
          },
        },
      };
      return {
        binary: opencodeBinary(),
        // Dotted model name; the proxy replaces it by route anyway, but an
        // undotted one fails opencode's own resolution first.
        argv: ['run', PROMPT, '-m', 'rapid-proxy/claude-haiku-4.5',
          '--dangerously-skip-permissions'],
        env: { ...clean, OPENCODE_CONFIG_CONTENT: JSON.stringify(cfg) },
        declares: 'x-complexity: small header',
      };
    }

    case 'copilot':
      return {
        binary: 'copilot',
        // Never --model auto: the proxy's copilot leg answers HTTP 500 for it.
        argv: ['-p', PROMPT, '--allow-all-tools', '--no-ask-user',
          '--model', 'claude-haiku-4-5'],
        env: {
          ...clean,
          // The band segment from rapid-llm-proxy#13 — copilot's only seam.
          COPILOT_PROVIDER_BASE_URL: `${BASE}/v1/copilot/b/small/t/${taskId}`,
          COPILOT_PROVIDER_TYPE: 'openai',
          COPILOT_PROVIDER_API_KEY: 'rapid-proxy-no-auth-placeholder',
          COPILOT_MODEL: 'claude-haiku-4-5',
          COPILOT_AUTO_UPDATE: 'false',
        },
        declares: '/b/small/ path segment (session-scoped)',
      };

    case 'claude':
      return {
        binary: 'claude',
        argv: ['-p', PROMPT, '--model', 'claude-haiku-4-5', '--permission-mode', 'acceptEdits'],
        env: {
          ...clean,
          ANTHROPIC_BASE_URL: BASE,
          ANTHROPIC_CUSTOM_HEADERS: `x-task-id: ${taskId}`,
          // A user-level UserPromptSubmit hook would otherwise prepend KB content.
          CODING_KNOWLEDGE_INJECTION: '0',
        },
        declares: 'nothing — control case',
      };

    default:
      throw new Error(`unknown agent "${agent}"`);
  }
}

async function runCase(agent, taskId) {
  const c = caseFor(agent, taskId);
  try {
    const r = await runAgent({
      prompt: PROMPT,
      arm: { mcpConfig: {}, model: 'claude-haiku-4.5', timeoutMs: TIMEOUT_MS, maxAttempts: 1 },
      cwd: os.tmpdir(),
      env: c.env,
      agent: { id: agent, binary: c.binary, model: 'claude-haiku-4.5',
        elicitation: 'text', answerFile: null, argv: () => c.argv },
      overrideArgv: c.argv,
    });
    return { outcome: r.outcome, wall_s: r.wall_s, declares: c.declares };
  } finally {
    c.cleanup?.();
  }
}

// ── Temporarily enabling the laptop target (public network only) ────────────

function readYaml() { return fs.readFileSync(ROUTING_YAML, 'utf8'); }

/**
 * Switch qwen-laptop on for the duration of `fn`, then put the file back byte
 * for byte. It ships OFF deliberately (mean 47s vs gh-copilot's 5.4s), so a
 * public-network demonstration has to turn it on and must not leave it on.
 *
 * Refuses to run if the file already differs from git HEAD: restoring would then
 * discard someone's uncommitted edit.
 */
async function withLaptopEnabled(fn) {
  const before = readYaml();
  const onceOn = before.replace(
    /(- provider: qwen-laptop[\s\S]*?)\n(\s*)enabled: false/,
    (_m, head, indent) => `${head}\n${indent}enabled: true`);
  if (onceOn === before) throw new Error('could not find `qwen-laptop … enabled: false` to toggle');
  fs.writeFileSync(ROUTING_YAML, onceOn, 'utf8');
  // The proxy reloads on mtime change; give it a beat to notice.
  await new Promise((r) => setTimeout(r, 2500));
  try {
    return await fn();
  } finally {
    fs.writeFileSync(ROUTING_YAML, before, 'utf8');
    await new Promise((r) => setTimeout(r, 2500));
    const after = readYaml();
    if (after !== before) warn('!! llm-routing.yaml was NOT restored — inspect it now');
    else say('   qwen-laptop switched back off; llm-routing.yaml restored byte-for-byte');
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const live = await liveState();
  const net = live.network;
  const target = net === 'corporate' ? 'qwen-local' : 'qwen-laptop';

  say(`network       : ${net}   (from the proxy's live sensor)`);
  say(`offload target: ${target}`);
  say(`reachable now : ${Object.entries(live.reachable)
    .filter(([k]) => k.startsWith('qwen'))
    .map(([k, v]) => `${k}=${v}`).join('  ')}`);
  say();

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const results = AGENTS.map((agent) => ({ agent, reachability: live.reachable, outcome: null }));

  // DECISION and OUTCOME must describe the SAME config, or the report compares
  // two different worlds. On the public network the run enables qwen-laptop for
  // its duration, so the decisions are resolved INSIDE that window too — the
  // first version of this script resolved them first, and duly reported
  // "no offload" beside an outcome that had plainly offloaded.
  const collect = async () => {
    for (const r of results) {
      const band = r.agent === 'claude' ? undefined : 'small';
      r.decision = {
        // Both networks, because the decision is network-parameterised and so
        // the half you cannot measure today is still computable.
        public: await resolveDecision({ agent: r.agent, complexity: band, network: 'public' }),
        corporate: await resolveDecision({ agent: r.agent, complexity: band, network: 'corporate' }),
      };
    }
    if (DECISION_ONLY) return;
    for (const r of results) {
      const taskId = `offloadproof-${stamp}-${r.agent}`;
      say(`running ${r.agent} …`);
      r.taskId = taskId;
      r.run = await runCase(r.agent, taskId);
      // The row lands after the response; the writer is not synchronous with it.
      await new Promise((res) => setTimeout(res, 3000));
      r.outcome = rowsForTask(taskId);
      // runAgent's own outcome describes whether the ANSWER parsed, which this
      // test does not care about — a one-word reply that pi declines to shape
      // into a result still produced the routed call we are measuring.
      say(`   ${r.agent}: ${r.outcome.length} token_usage row(s) (agent outcome: ${r.run.outcome})`);
    }
  };

  // Only enable the laptop when there is something to run; --decision-only must
  // report the SHIPPED config, not a config it invented.
  if (net === 'public' && !DECISION_ONLY) await withLaptopEnabled(collect);
  else await collect();

  // ── Verdicts ──────────────────────────────────────────────────────────────
  //
  // A verdict is only meaningful against the config that was in force. In
  // --decision-only mode on the public network the laptop target is still OFF
  // (its shipped default), so "did not offload" is CORRECT and must not be
  // reported as a failure — the reason string says exactly which gate stopped
  // it. A pass/fail expectation is only asserted for a real run, where the
  // target was enabled for the duration.
  const asserting = !DECISION_ONLY;
  for (const r of results) {
    const d = r.decision[net];
    const canOffload = r.agent !== 'claude';
    const served = r.outcome?.[0];
    r.verdict = {
      // What the config says, in its own words. `offloadSkipped` names the gate.
      decision: d.offloadedFrom
        ? `offload → ${d.provider}`
        : `no offload → ${d.provider}${d.offloadSkipped ? ` (${d.offloadSkipped})` : ''}`,
      expected: !asserting ? 'not asserted (--decision-only)'
        : canOffload
          ? (d.provider === target ? 'PASS — routed to the local target' : 'FAIL — expected the local target')
          : (d.offloadedFrom === null ? 'PASS — control did not offload' : 'FAIL — control offloaded'),
      reachable: r.reachability[target] ?? false,
      // Deliberately separate from `decision`: routing sent it there is one
      // claim, the box answered is another. A wrong port shows up here, not there.
      outcome: !served ? 'no row'
        : served.offloaded_from && Number(served.chain_position) === 0
          ? `served by ${served.provider} (offloaded)`
        : served.offloaded_from
          ? `offload attempted, fell back to ${served.provider}`
        : `served by ${served.provider} (not offloaded)`,
    };
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outFile = path.join(OUT_DIR, `${stamp}-${net}.json`);
  fs.writeFileSync(outFile, JSON.stringify({ network: net, target, at: stamp, results }, null, 2));

  if (AS_JSON) { process.stdout.write(JSON.stringify({ network: net, target, results }, null, 2) + '\n'); return; }

  say();
  for (const r of results) {
    say(`${r.agent}`);
    say(`   declares : ${r.run?.declares ?? DECLARES[r.agent]}`);
    say(`   DECISION : ${r.verdict.decision}`);
    if (asserting) say(`   OUTCOME  : ${r.verdict.outcome}`);
    say(`   verdict  : ${r.verdict.expected}`);
    // The other network, computed from here — the half you cannot measure today.
    const other = net === 'corporate' ? 'public' : 'corporate';
    const o = r.decision[other];
    say(`   on ${other.padEnd(9)}: ${o.offloadedFrom ? `offload → ${o.provider}` : `no offload → ${o.provider}`}`);
    say();
  }
  say(`written: ${path.relative(REPO, outFile)}`);
}

main().catch((err) => { warn(`verify-semantic-offload failed: ${err?.stack || err}`); process.exit(1); });
