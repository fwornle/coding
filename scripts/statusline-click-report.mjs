#!/usr/bin/env node
/**
 * Human-readable reports for the clickable status-line fields.
 *
 * Reached from bin/statusline-click, rendered in a tmux popup. The audience is
 * someone who just clicked a two-cell badge because they wanted to know what it
 * meant — so every number here is either labelled in plain words or left out.
 * Raw JSON belongs in curl, not in a popup: the first version of the network
 * report printed the proxy's /health document verbatim and a routing summary
 * line, and told the reader nothing they could act on.
 *
 * console.log is the output mechanism for a CLI report, as in bin/status — the
 * no-console-log constraint targets application logging, not a program whose
 * entire purpose is to print a page of text.
 */

const PROXY = process.env.RAPID_LLM_PROXY_URL || 'http://localhost:12435';
const COORDINATOR = 'http://localhost:3034';

const BAR = '─'.repeat(62);

async function getJson(url, timeoutMs = 4000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ac.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function getText(url, timeoutMs = 4000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ac.signal });
    if (!res.ok) return null;
    return (await res.text()).trim();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function row(label, value) {
  console.log(`  ${String(label).padEnd(16)}${value}`);
}

/**
 * Network + routing.
 *
 * Answers the three questions the [N:… P:…] badge raises and cannot itself
 * answer: which network am I on, does my traffic leave through a corporate
 * proxy, and which account+model actually serves a turn from each agent.
 */
async function reportNet() {
  const health = await getJson(`${PROXY}/health`);
  console.log('Network and LLM routing');
  console.log(BAR);

  if (!health) {
    console.log('\n  The proxy at ' + PROXY + ' is not answering.');
    console.log('  Every agent that routes through it will be failing right now.');
    console.log('\n  Restart it with:');
    console.log('    launchctl kickstart -k gui/$(id -u)/com.coding.llm-cli-proxy');
    return;
  }

  // "corporate" and "public" are the proxy's vocabulary; the coordinator says
  // "vpn" for the same thing as "corporate". Spell out the consequence rather
  // than the label, because the label is what confuses people.
  const net = health.networkMode || 'unknown';
  const egress = health.egress || {};
  console.log('\nWhere you are');
  row('Network', net === 'corporate'
    ? 'corporate (on VPN / on-prem reachable)'
    : net === 'public' ? 'public (off VPN — on-prem models unreachable)' : net);
  row('Egress', egress.proxy
    ? `via corporate proxy ${egress.proxy}`
    : 'direct (no corporate proxy in use)');
  if (egress.reason) row('Decided by', egress.reason);
  if (egress.degraded) row('Degraded', 'yes — the pinned proxy stopped answering');

  console.log('\nProxy');
  row('Status', `${health.status || '?'} · build ${health.build || '?'}`);
  row('Mode', health.mode || '?');

  const providers = health.providers || {};
  const up = Object.entries(providers).filter(([, v]) => v?.available).map(([k]) => k);
  const down = Object.entries(providers).filter(([, v]) => !v?.available).map(([k]) => k);
  console.log('\nAccounts');
  if (up.length) row('Reachable', up.join(', '));
  if (down.length) row('Not reachable', down.join(', '));

  // The part that actually answers "where does my next turn go?".
  console.log('\nWhere a turn goes right now');
  for (const [label, job] of [
    ['claude', 'fg-chat/claude'],
    ['opencode', 'fg-chat/opencode'],
    ['copilot', 'fg-chat/copilot'],
  ]) {
    const resolved = await getJson(`${PROXY}/api/llm/routing/resolve?job=${encodeURIComponent(job)}`);
    const summary = resolved?.summary;
    if (!summary) { row(label, '(no route resolved)'); continue; }
    // "fg-chat/claude (step 2) -> a/b > c/d" — the arrow separates the job from
    // the chain, and ">" separates each fallback hop.
    const chain = summary.split('->').slice(1).join('->').trim();
    const hops = chain.split('>').map((h) => h.trim()).filter(Boolean);
    row(label, hops[0] || chain);
    if (hops.length > 1) {
      console.log(`  ${''.padEnd(16)}falls back to ${hops.slice(1).join(' then ')}`);
    }
  }
  console.log('\n  provider/model — the provider is the ACCOUNT, not the vendor:');
  console.log('  claude-code-max is the personal subscription, anthropic-api is metered.');
}

/** Semantic readiness: what the [🧠] badge is reading, in words. */
async function reportSemantic() {
  const state = await getJson(`${COORDINATOR}/health/state`);
  console.log('Semantic readiness');
  console.log(BAR);
  const p = state?.proxy;
  if (!p) {
    console.log('\n  The health coordinator is not reporting a proxy block.');
    console.log('  Check: launchctl list | grep com.coding.health-coordinator');
    return;
  }
  console.log('');
  row('Ready', p.semantic_ok ? 'yes — background LLM work can run' : 'NO — background LLM work is failing');
  row('Network', p.networkMode || '?');
  row('Self-heal', p.auto_heal_status || '?');
  row('Why', p.reason || '(not stated)');
  if (p.last_round_trip_ms != null) row('Last probe', `${p.last_round_trip_ms} ms`);
  if (p.last_probe_end) row('Probed at', p.last_probe_end);
  if (p.consecutive_failures) row('Failures', `${p.consecutive_failures} in a row`);
  if (p.kickstart_count) row('Restarts', `${p.kickstart_count} since boot`);
  console.log('\n  "recent-real-traffic" means the coordinator saw genuine traffic');
  console.log('  succeed and skipped its own probe — that is the healthy case.');
}

/**
 * Context usage, in tokens rather than only a percentage.
 *
 * The bridge file Claude Code writes carries percentages ONLY, so the absolute
 * numbers come from the transcript's last usage block — the sum of fresh input,
 * cache reads and cache writes IS the conversation's current context size.
 * Verified against the bridge: 223,028 tokens read back as its 22%.
 */
async function reportCtx() {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const repo = process.env.CODING_REPO || process.cwd();
  const gauge = require(`${repo}/lib/statusline/context-gauge.cjs`);
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');

  const agent = (process.env.CODING_AGENT || 'claude').toLowerCase();
  const tmuxSession = process.env.TMUX_SESSION_NAME;
  console.log('Context window');
  console.log(BAR);

  const usage = gauge.readContextUsage({
    agent,
    projectPath: process.env.TRANSCRIPT_SOURCE_PROJECT || process.cwd(),
    sessionId: agent === 'claude' && tmuxSession
      ? gauge.claudeSessionForTmuxSession(tmuxSession)
      : undefined,
    tmuxSession,
  });

  let tokens = null; let model = null;
  if (agent === 'claude') {
    const sid = tmuxSession ? gauge.claudeSessionForTmuxSession(tmuxSession) : null;
    if (sid) {
      const projects = path.join(os.homedir(), '.claude', 'projects');
      let transcript = null;
      try {
        for (const dir of fs.readdirSync(projects)) {
          const candidate = path.join(projects, dir, `${sid}.jsonl`);
          if (fs.existsSync(candidate)) { transcript = candidate; break; }
        }
      } catch { /* no projects dir */ }
      if (transcript) {
        // Last usage block wins: it describes the most recent turn, which is
        // the only one whose input size equals the CURRENT context.
        for (const line of fs.readFileSync(transcript, 'utf8').split('\n')) {
          if (!line.startsWith('{')) continue;
          let rec; try { rec = JSON.parse(line); } catch { continue; }
          const u = rec?.message?.usage;
          if (u) tokens = u;
          if (rec?.message?.model) model = rec.message.model;
        }
      }
    }
  }
  if (!model && usage?.model) model = usage.model;
  const window = gauge.contextWindowFor(model, null) || gauge.DEFAULT_CONTEXT_WINDOW;

  console.log('');
  row('Agent', agent);
  row('Model', model || '(not reported)');
  row('Window', `${window.toLocaleString('en-US')} tokens`);

  if (tokens) {
    const fresh = tokens.input_tokens || 0;
    const read = tokens.cache_read_input_tokens || 0;
    const write = tokens.cache_creation_input_tokens || 0;
    const used = fresh + read + write;
    const pct = (used / window) * 100;
    console.log('');
    row('In use', `${used.toLocaleString('en-US')} tokens  (${pct.toFixed(1)}% of the window)`);
    row('Free', `${(window - used).toLocaleString('en-US')} tokens`);
    console.log('\nWhat is in there');
    // Read vs write is how the SAME context was billed this turn, not what is
    // in it: a turn after a cache expiry re-writes the whole conversation and
    // shows reads at 0, which the old wording ("the conversation so far") made
    // look like the history had been lost.
    row('Cache reads', `${read.toLocaleString('en-US')}  (served from cache)`);
    row('Cache writes', `${write.toLocaleString('en-US')}  (written to cache this turn)`);
    row('Fresh input', `${fresh.toLocaleString('en-US')}`);
    if (tokens.output_tokens) {
      const think = tokens.output_tokens_details?.thinking_tokens;
      row('Last reply', `${tokens.output_tokens.toLocaleString('en-US')} out`
        + (think ? ` (${think.toLocaleString('en-US')} thinking)` : ''));
    }
  }

  if (usage) {
    console.log('');
    row('Gauge shows', `${usage.usedPct.toFixed(0)}%`);
    if (agent === 'claude') {
      console.log('\n  The gauge reads HIGHER than the raw percentage on purpose: Claude');
      console.log('  Code reserves ~16.5% of the window for auto-compaction, and the');
      console.log('  gauge measures against the USABLE remainder, not the raw window.');
      console.log('  So the gauge hitting 100% means compaction, not a hard wall.');
    }
  } else {
    console.log('\n  No live reading for this agent — the gauge renders empty.');
  }
}

const what = process.argv[2];
if (what === 'net') await reportNet();
else if (what === 'semantic') await reportSemantic();
else if (what === 'ctx') await reportCtx();
else { console.log('usage: statusline-click-report.mjs net|semantic|ctx'); process.exit(2); }
