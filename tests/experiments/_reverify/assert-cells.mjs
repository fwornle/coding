// Phase 88-03 Task 2 — assert every rv88a cell EXECUTED (tokens>0, terminal=complete) or CLEAN-SKIPPED
// (skip_reason), and FAIL on any silent abort (abort/timeout + 0 tokens + no skip_reason) — the pre-fix
// failure mode. Reads the AUTHORITATIVE runner log lines (the same `writeRun` / status the store received);
// the experiments LevelDB is single-owner and may be locked by obs-api/exporter, so we do NOT open it here.
// Diagnostics via process.stderr.write only (CLAUDE.md no-console-log). Exit non-zero on any violation.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const RUN_ID = 'rv88a';
const EXPECT = ['claude', 'opencode', 'copilot'];
const log = readFileSync(join(HERE, `88-${RUN_ID}.log`), 'utf8');

// terminal_state + skip reason per cell, from the `[experiment-run] <task_id> status=… terminal_state=… [reason=…]` lines
const statusByAgent = {};
for (const m of log.matchAll(/\[experiment-run\]\s+(\S*-rv88a--\S+)\s+status=(\S+)\s+terminal_state=(\S+)(?:\s+reason=(\S+))?/g)) {
  const [, taskId, , terminal, reason] = m;
  const agent = EXPECT.find(a => taskId.includes(`--${a}-`));
  if (agent) statusByAgent[agent] = { taskId, terminal, skip_reason: reason || null };
}
// tokens per cell, from the `writeRun task_id=… totalTokens=…` lines
const tokensByAgent = {};
for (const m of log.matchAll(/writeRun task_id=(\S*-rv88a--\S+?)\s+.*?totalTokens=(\d+)/g)) {
  const [, taskId, tok] = m;
  const agent = EXPECT.find(a => taskId.includes(`--${a}-`));
  if (agent) tokensByAgent[agent] = Number(tok);
}

const rows = [];
let violations = 0;
for (const agent of EXPECT) {
  const st = statusByAgent[agent];
  const tokens = tokensByAgent[agent] ?? 0;
  if (!st) {
    process.stderr.write(`MISSING status line for agent=${agent}\n`);
    violations++;
    rows.push({ agent, terminal: '(missing)', skip_reason: null, tokens, ok: false });
    continue;
  }
  const executed = tokens > 0 && st.terminal === 'complete';
  const cleanSkip = st.skip_reason != null && String(st.skip_reason).length > 0;
  const silentAbort = (st.terminal === 'abort' || st.terminal === 'timeout') && tokens === 0 && !cleanSkip;
  const ok = (executed || cleanSkip) && !silentAbort;
  if (!ok) { process.stderr.write(`VIOLATION agent=${agent} terminal=${st.terminal} tokens=${tokens} skip=${st.skip_reason}\n`); violations++; }
  rows.push({ agent, terminal: st.terminal, skip_reason: st.skip_reason, tokens, ok });
}

process.stderr.write(`\nPer-cell dispositions (run_id=${RUN_ID}):\n`);
for (const r of rows) {
  process.stderr.write(`  ${r.agent.padEnd(9)} terminal=${String(r.terminal).padEnd(10)} tokens=${String(r.tokens).padEnd(8)} skip=${r.skip_reason ?? '-'}  ${r.ok ? 'OK' : 'FAIL'}\n`);
}
if (violations > 0) {
  process.stderr.write(`\nFAILED: ${violations} cell(s) violated execute-or-clean-skip (silent abort or missing).\n`);
  process.exit(1);
}
process.stderr.write('\nPASSED: all 3 cells executed (tokens>0, terminal=complete) or clean-skipped; no silent aborts.\n');
process.exit(0);
