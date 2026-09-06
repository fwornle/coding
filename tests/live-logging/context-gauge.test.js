/**
 * Context-window gauge — the per-agent readers, the renderer, and the two
 * couplings that would fail silently.
 *
 * Behaviour-tested rather than grep-gated (unlike statusline-alarm-dots): every
 * reader here is a pure function of files on disk, so a temp fixture store
 * exercises the real code path end to end.
 *
 * What these protect, in order of how badly each would fail unnoticed:
 *
 *   1. WIRE SEMANTICS. copilot reports OpenAI-style usage where input_tokens
 *      already includes cache reads; opencode and pi report Anthropic-style
 *      usage where it does not. Adding cache reads on the copilot path would
 *      roughly double a cache-heavy session's reading and nothing would error —
 *      the gauge would just be wrong. This is the same trap CLAUDE.md documents
 *      for token accounting.
 *   2. CONSTANT WIDTH. status-line-fast.cjs substitutes a freshly rendered gauge
 *      into a line combined-status-line.js already truncated to the pane. If the
 *      width varied by severity, crossing a threshold would push the line past
 *      the pane edge and re-open the trailing-residue bug.
 *   3. THE PATCH REGEX. GAUGE_RE has to match what renderGauge produces. If they
 *      drift the fast path silently stops patching and the gauge freezes at
 *      whatever the last full render wrote — a no-op that looks like a stuck
 *      number, with no error anywhere.
 */

import { describe, test, expect, beforeAll, afterAll, afterEach } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const require = createRequire(import.meta.url);
const gauge = require(path.join(REPO_ROOT, 'lib', 'statusline', 'context-gauge.cjs'));
const { paneIdentity } = require(path.join(REPO_ROOT, 'lib', 'statusline', 'pane-cache-key.cjs'));

let Database;
try {
  Database = require('better-sqlite3');
} catch {
  Database = null;
}

let tmp;
beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-gauge-test-'));
});
afterAll(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

/** Visible cell width, mirroring how tmux counts this gauge's characters. */
function cells(s) {
  const stripped = String(s).replace(/#\[[^\]]*\]/g, '');
  // The gauge uses only block glyphs (EAW=Ambiguous ⇒ 1 cell in a non-East-Asian
  // locale, which is how both tmux and combined-status-line.js count them),
  // digits, '%' and spaces. All are one cell.
  return [...stripped].length;
}

describe('renderGauge', () => {
  test('is exactly GAUGE_CELLS wide in every severity band and at every extreme', () => {
    for (const pct of [0, 1, 9, 10, 49, 50, 64, 65, 79, 80, 99, 100]) {
      expect(cells(gauge.renderGauge(pct))).toBe(gauge.GAUGE_CELLS);
    }
  });

  test('fill tracks the percentage across the bar', () => {
    // Derived from BAR_SEGMENTS, not hardcoded: the segment count is a width
    // knob (10 → 8 when the line was slimmed), and a test that pins it asserts
    // the knob's value rather than the property that the fill tracks the number.
    const N = gauge.BAR_SEGMENTS;
    const bar = (p) => gauge.renderGauge(p).replace(/#\[[^\]]*\]/g, '').split(' ')[0];
    expect(bar(0)).toBe('░'.repeat(N));
    expect(bar(50)).toBe('█'.repeat(Math.floor(N / 2)) + '░'.repeat(N - Math.floor(N / 2)));
    expect(bar(100)).toBe('█'.repeat(N));
    // Monotonic: more context used never means fewer filled cells.
    let prev = -1;
    for (let p = 0; p <= 100; p += 1) {
      const filled = [...bar(p)].filter((c) => c === '█').length;
      expect(filled).toBeGreaterThanOrEqual(prev);
      prev = filled;
    }
  });

  test('the zero position is a real gauge, not a hole', () => {
    // What a pane shows between a session starting and its agent first
    // reporting. It used to be GAUGE_BLANK, which read on screen as a black gap
    // in the bar and looked like a fault rather than a new session.
    expect(gauge.GAUGE_ZERO).toBe(gauge.renderGauge(0));
    expect(gauge.GAUGE_ZERO).not.toBe(gauge.GAUGE_BLANK);
    expect(gauge.GAUGE_RE.test(gauge.GAUGE_ZERO)).toBe(true);
    // Same width as every other state, so substituting it into an
    // already-truncated line cannot re-open the trailing-residue bug.
    const cells = (t) => t.replace(/#\[[^\]]*\]/g, '').length;
    expect(cells(gauge.GAUGE_ZERO)).toBe(gauge.GAUGE_CELLS);
    // Calm band, empty trough — dull green, nothing filled.
    expect(gauge.GAUGE_ZERO).toContain('░'.repeat(gauge.BAR_SEGMENTS));
    expect(gauge.GAUGE_ZERO).toMatch(/fg=colour46,bg=colour22/);
  });

  test('hasContextReader separates "no reader" from "no reading"', () => {
    // The distinction that lets the zero position exist without lying: a
    // supported agent with nothing to report yet renders zero, an agent whose
    // store cannot be read at all still renders nothing.
    for (const a of ['claude', 'opencode', 'copilot', 'pi', 'CLAUDE']) {
      expect(gauge.hasContextReader(a)).toBe(true);
    }
    for (const a of ['zsh', 'unknown', '', null, undefined]) {
      expect(gauge.hasContextReader(a)).toBe(false);
    }
  });

  test('every band carries a foreground AND a duller background', () => {
    // The background is the whole point of the restyle — a fill watermark over
    // a tinted trough. A band that lost its bg= would render as a bare bar again.
    for (const pct of [10, 55, 70, 95]) {
      expect(gauge.renderGauge(pct)).toMatch(/#\[fg=colour\d+,bg=colour\d+/);
    }
  });

  test('severity thresholds match the meter this replaces', () => {
    const fg = (p) => gauge.renderGauge(p).match(/fg=(colour\d+)/)[1];
    expect(fg(49)).toBe(fg(0));        // green band
    expect(fg(50)).not.toBe(fg(49));   // → yellow
    expect(fg(65)).not.toBe(fg(64));   // → orange
    expect(fg(80)).not.toBe(fg(79));   // → red
    expect(gauge.renderGauge(80)).toContain('bold');
  });

  test('clamps and tolerates junk instead of rendering a broken bar', () => {
    for (const v of [-10, 150, NaN, undefined, null, 'abc']) {
      expect(cells(gauge.renderGauge(v))).toBe(gauge.GAUGE_CELLS);
    }
  });
});

describe('GAUGE_RE (the fast-path patch coupling)', () => {
  test('matches renderGauge output in every band', () => {
    for (const pct of [0, 30, 55, 70, 95, 100]) {
      // Fresh regex per assertion — GAUGE_RE is stateless (no /g), but re-testing
      // the exported instance is exactly what the fast path does.
      expect(gauge.GAUGE_RE.test(gauge.renderGauge(pct))).toBe(true);
    }
  });

  test('replaces a gauge in place without changing the surrounding line', () => {
    const line = `[🔒75%] ${gauge.renderGauge(88)} [📋20-21] 20:17`;
    const patched = line.replace(gauge.GAUGE_RE, gauge.renderGauge(12));
    expect(patched).toContain(' 12%');
    expect(patched).not.toContain(' 88%');
    expect(cells(patched)).toBe(cells(line));
  });

  test('the blank placeholder is the same width as a real gauge', () => {
    // status-line-fast.cjs blanks the gauge when it borrows a sibling pane's
    // cached line. The line has already been left-padded to a stable cell count
    // by then, so a narrower replacement would leave tmux repainting fewer cells
    // than it allocated — the trailing-residue bug.
    expect(cells(gauge.GAUGE_BLANK)).toBe(gauge.GAUGE_CELLS);
  });

  test('a blank can be matched and filled in, and a real gauge can be blanked', () => {
    expect(gauge.GAUGE_RE.test(gauge.GAUGE_BLANK)).toBe(true);
    expect(gauge.GAUGE_BLANK.replace(gauge.GAUGE_RE, gauge.renderGauge(7))).toContain('7%');
    const blanked = gauge.renderGauge(99).replace(gauge.GAUGE_RE, gauge.GAUGE_BLANK);
    expect(blanked).not.toContain('99%');
    expect(cells(blanked)).toBe(gauge.GAUGE_CELLS);
  });

  test('does not match GSD\'s milestone bar, which uses the same glyphs', () => {
    // "v7.6 [█████████░] 95%" — same ten glyphs, same percentage shape. The
    // literal brackets are what keep the two apart.
    expect(gauge.GAUGE_RE.test('v7.6 [█████████░] 95% · executing')).toBe(false);
  });
});

describe('contextWindowFor', () => {
  test('1M-context variants are recognised as such', () => {
    expect(gauge.contextWindowFor('claude-opus-5[1m]')).toBe(1_000_000);
  });

  test('unknown models fall back to the documented default, never to zero', () => {
    // Zero would make pctFromTokens divide by zero and render a nonsense gauge.
    expect(gauge.contextWindowFor('some-model-nobody-has-heard-of')).toBe(
      gauge.DEFAULT_CONTEXT_WINDOW
    );
    expect(gauge.contextWindowFor(undefined)).toBe(gauge.DEFAULT_CONTEXT_WINDOW);
  });
});

describe('claude reader', () => {
  test('normalises against the autocompact reserve, matching the old meter', () => {
    const sessionId = 'claude-fixture-session';
    const bridge = path.join(os.tmpdir(), `claude-ctx-${sessionId}.json`);
    fs.writeFileSync(bridge, JSON.stringify({
      session_id: sessionId,
      remaining_percentage: 49.6,   // ⇒ usable remaining 40% ⇒ 60% used
      total_tokens: 1_000_000,
      timestamp: Math.floor(Date.now() / 1000),
    }));
    try {
      const r = gauge.readContextUsage({ agent: 'claude', sessionId });
      // (49.6 - 16.5) / (100 - 16.5) * 100 = 39.64% remaining ⇒ 60.36% used.
      expect(r.usedPct).toBeCloseTo(60.36, 1);
      expect(r.source).toBe('claude-bridge');
    } finally {
      fs.rmSync(bridge, { force: true });
    }
  });

  test('a session id containing path separators is refused', () => {
    // The id reaches a path.join; traversal must not be able to point the read
    // at an arbitrary file.
    expect(gauge.readContextUsage({ agent: 'claude', sessionId: '../../etc/passwd' })).toBeNull();
  });

  test('missing bridge file yields null, not a zero reading', () => {
    expect(gauge.readContextUsage({ agent: 'claude', sessionId: 'no-such-session' })).toBeNull();
  });
});

const describeSqlite = Database ? describe : describe.skip;

describeSqlite('copilot reader — OpenAI wire', () => {
  test('uses input_tokens ALONE; adding cache reads would double-count', () => {
    const db = path.join(tmp, 'copilot.db');
    const d = new Database(db);
    d.exec(`
      CREATE TABLE sessions (id TEXT PRIMARY KEY, cwd TEXT);
      CREATE TABLE assistant_usage_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, model TEXT,
        input_tokens INTEGER, cache_read_tokens INTEGER, created_at TEXT);
      INSERT INTO sessions VALUES ('s1', '/proj');
      -- 100000 of the 100000 input tokens are cache reads (OpenAI reports the
      -- total in input_tokens). Correct occupancy is 100000 = 50% of 200000.
      -- claude-sonnet-5 (200000 window) is what copilot actually routes to here.
      INSERT INTO assistant_usage_events
        (session_id, model, input_tokens, cache_read_tokens, created_at)
        VALUES ('s1', 'claude-sonnet-5', 100000, 99000, '2026-09-03T10:00:00Z');
    `);
    d.close();

    process.env.COPILOT_SESSION_DB_PATH = db;
    try {
      const r = gauge.readContextUsage({ agent: 'copilot', projectPath: '/proj' });
      expect(r.source).toBe('copilot-db');
      // 100000 / 200000 = 50%. Had cache_read_tokens been added it would read
      // 199000/200000 ≈ 99.5% — a full-looking gauge on a half-full context.
      expect(r.usedPct).toBeCloseTo(50, 5);
    } finally {
      delete process.env.COPILOT_SESSION_DB_PATH;
    }
  });

  test('a project with no copilot session yields null', () => {
    const db = path.join(tmp, 'copilot-empty.db');
    const d = new Database(db);
    d.exec(`
      CREATE TABLE sessions (id TEXT PRIMARY KEY, cwd TEXT);
      CREATE TABLE assistant_usage_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, model TEXT,
        input_tokens INTEGER, cache_read_tokens INTEGER, created_at TEXT);
    `);
    d.close();
    process.env.COPILOT_SESSION_DB_PATH = db;
    try {
      expect(gauge.readContextUsage({ agent: 'copilot', projectPath: '/nope' })).toBeNull();
    } finally {
      delete process.env.COPILOT_SESSION_DB_PATH;
    }
  });
});

describeSqlite('opencode reader — Anthropic wire', () => {
  function seed(dbPath, messages) {
    const d = new Database(dbPath);
    d.exec(`
      CREATE TABLE session (id TEXT PRIMARY KEY, directory TEXT, model TEXT,
                            time_updated INTEGER, tokens_input INTEGER);
      CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT,
                            time_created INTEGER, data TEXT);
      INSERT INTO session VALUES ('s1', '/proj', '{"id":"claude-sonnet-5"}', 100, 9999999);
    `);
    const ins = d.prepare('INSERT INTO message VALUES (?,?,?,?)');
    messages.forEach((m, i) => ins.run(`m${i}`, 's1', i, JSON.stringify(m)));
    d.close();
  }

  test('adds cache reads to input, because opencode reports them separately', () => {
    const db = path.join(tmp, 'oc-wire.db');
    seed(db, [{ role: 'assistant', modelID: 'claude-sonnet-5', tokens: { input: 40000, cache: { read: 60000 } } }]);
    process.env.OPENCODE_DB_PATH = db;
    try {
      // 40000 + 60000 = 100000 of a 200000 window.
      expect(gauge.readContextUsage({ agent: 'opencode', projectPath: '/proj' }).usedPct)
        .toBeCloseTo(50, 5);
    } finally {
      delete process.env.OPENCODE_DB_PATH;
    }
  });

  test('a short trailing step does not drag the reading below the real size', () => {
    // Within one user turn opencode writes one assistant message per loop step.
    // A tiny final step (a summary or title call) must not be mistaken for the
    // conversation shrinking — hence the max over a trailing window.
    const db = path.join(tmp, 'oc-dip.db');
    seed(db, [
      { role: 'assistant', modelID: 'claude-sonnet-5', tokens: { input: 100000, cache: { read: 0 } } },
      { role: 'assistant', modelID: 'claude-sonnet-5', tokens: { input: 300, cache: { read: 0 } } },
    ]);
    process.env.OPENCODE_DB_PATH = db;
    try {
      expect(gauge.readContextUsage({ agent: 'opencode', projectPath: '/proj' }).usedPct)
        .toBeCloseTo(50, 5);
    } finally {
      delete process.env.OPENCODE_DB_PATH;
    }
  });

  test('user messages are ignored — only assistant turns carry a prompt size', () => {
    const db = path.join(tmp, 'oc-roles.db');
    seed(db, [
      { role: 'assistant', modelID: 'claude-sonnet-5', tokens: { input: 100000, cache: { read: 0 } } },
      { role: 'user', tokens: { input: 999999, cache: { read: 0 } } },
    ]);
    process.env.OPENCODE_DB_PATH = db;
    try {
      expect(gauge.readContextUsage({ agent: 'opencode', projectPath: '/proj' }).usedPct)
        .toBeCloseTo(50, 5);
    } finally {
      delete process.env.OPENCODE_DB_PATH;
    }
  });
});

describe('pi reader', () => {
  test('reads the last usage record of the newest session file', () => {
    const cfg = path.join(tmp, 'pi-agent');
    const projectPath = '/Users/x/Agentic/demo';
    const dir = path.join(cfg, 'sessions', gauge.encodePiSessionDir(projectPath));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '2026-09-03T00-00-00Z_a.jsonl'), [
      JSON.stringify({ usage: { input: 10, cacheRead: 0 }, model: 'claude-sonnet-5' }),
      // Anthropic wire: 40000 + 60000 = 100000 of a 200000 window.
      JSON.stringify({ usage: { input: 40000, cacheRead: 60000 }, model: 'claude-sonnet-5' }),
    ].join('\n') + '\n');

    process.env.PI_CODING_AGENT_DIR = cfg;
    try {
      const r = gauge.readContextUsage({ agent: 'pi', projectPath });
      expect(r.source).toBe('pi-session');
      expect(r.usedPct).toBeCloseTo(50, 5);
    } finally {
      delete process.env.PI_CODING_AGENT_DIR;
    }
  });

  test('the agent dir follows SCOPE, not whichever directory still exists', () => {
    // Switching an install to global leaves the old $CODING_REPO/.pi-agent on
    // disk. An existence check would keep reading that frozen snapshot and
    // report a stale context for a live pi pane, forever and without erroring.
    const repo = path.join(tmp, 'scope-repo');
    const stale = path.join(repo, '.pi-agent', 'sessions');
    const projectPath = '/Users/x/Agentic/scoped';
    fs.mkdirSync(path.join(stale, gauge.encodePiSessionDir(projectPath)), { recursive: true });
    fs.writeFileSync(
      path.join(stale, gauge.encodePiSessionDir(projectPath), 'old.jsonl'),
      `${JSON.stringify({ usage: { input: 100000, cacheRead: 0 }, model: 'claude-sonnet-5' })}\n`,
    );
    fs.writeFileSync(path.join(repo, '.env'), 'CODING_AGENT_SCOPE=global\n');

    const prevRepo = process.env.CODING_REPO;
    const prevScope = process.env.CODING_AGENT_SCOPE;
    delete process.env.CODING_AGENT_SCOPE;
    process.env.CODING_REPO = repo;
    try {
      // Global scope → ~/.pi/agent, which has no session for this project, so
      // the honest answer is "no reading" rather than the stale repo-local one.
      expect(gauge.readContextUsage({ agent: 'pi', projectPath })).toBeNull();

      // Flip the same install back to wrapper and the repo-local dir is used.
      fs.writeFileSync(path.join(repo, '.env'), 'CODING_AGENT_SCOPE=wrapper\n');
      expect(gauge.readContextUsage({ agent: 'pi', projectPath }).usedPct).toBeCloseTo(50, 5);
    } finally {
      if (prevRepo === undefined) delete process.env.CODING_REPO;
      else process.env.CODING_REPO = prevRepo;
      if (prevScope !== undefined) process.env.CODING_AGENT_SCOPE = prevScope;
    }
  });

  test('no session directory for the project yields null', () => {
    const cfg = path.join(tmp, 'pi-empty');
    fs.mkdirSync(path.join(cfg, 'sessions'), { recursive: true });
    process.env.PI_CODING_AGENT_DIR = cfg;
    try {
      expect(gauge.readContextUsage({ agent: 'pi', projectPath: '/nope' })).toBeNull();
    } finally {
      delete process.env.PI_CODING_AGENT_DIR;
    }
  });
});

describe('readContextUsage dispatch', () => {
  test('an unknown agent is null, not a throw', () => {
    expect(gauge.readContextUsage({ agent: 'nethack', projectPath: '/proj' })).toBeNull();
    expect(gauge.readContextUsage({})).toBeNull();
  });
});

describe('sessionIdFromTranscriptPath', () => {
  test('a Claude transcript filename IS the session id', () => {
    expect(gauge.sessionIdFromTranscriptPath('/a/b/9fa7be28-a609-4187-a9b7-c558be949917.jsonl'))
      .toBe('9fa7be28-a609-4187-a9b7-c558be949917');
  });

  test('non-transcript paths yield null', () => {
    expect(gauge.sessionIdFromTranscriptPath('/a/b/opencode.db')).toBeNull();
    expect(gauge.sessionIdFromTranscriptPath(null)).toBeNull();
  });
});

/**
 * Which Claude session the gauge draws for.
 *
 * The regression this locks down: a first-turn session rendered 66%, which was
 * the normalised reading of the session the user had just closed. Both renderers
 * resolved the session id from PROJECT-keyed state (the newest-beating
 * coordinator entry, the one transcript per project in the fast path's sidecar),
 * so any project that had hosted two sessions could name the wrong one — and did,
 * for the whole window before the new session's ETM out-beat the old one's.
 *
 * Nothing errored while it was wrong, and both numbers were real, which is why
 * these are behaviour tests over two live-looking bridge files rather than an
 * assertion that some lookup was called.
 */
describe('claudeSessionForTmuxSession (whose context is this)', () => {
  // The record is a file, because it crosses processes: scripts/claude-statusline.cjs
  // writes it under Claude Code, both renderers read it under tmux.
  const recordFile = (name) => path.join(os.tmpdir(), `claude-tmux-session-${name}.json`);
  const written = [];
  const cleanup = () => {
    while (written.length) fs.rmSync(written.pop(), { force: true });
  };
  afterEach(cleanup);

  test('records and returns the session running in a tmux session', () => {
    const name = 'ctx-gauge-test-roundtrip';
    written.push(recordFile(name));
    expect(gauge.recordClaudeSession({
      tmuxSession: name,
      sessionId: 'aaaaaaaa-1111-2222-3333-444444444444',
      cwd: '/proj',
    })).toBe(true);
    expect(gauge.claudeSessionForTmuxSession(name))
      .toBe('aaaaaaaa-1111-2222-3333-444444444444');
  });

  test('THE REGRESSION: a fresh session reads its own context, not the one it replaced', () => {
    // Both sessions belong to one project, so every project-keyed lookup can
    // only return one of them — the reason the wrong one used to win.
    const previous = 'ctx-gauge-test-previous';
    const fresh = 'ctx-gauge-test-fresh';
    const bridges = [previous, fresh].map(id => path.join(os.tmpdir(), `claude-ctx-${id}.json`));
    // remaining 45 ⇒ 66% used; remaining 89 ⇒ 13% used. These are the measured
    // values from the report, so a change to the normalisation shows up here.
    fs.writeFileSync(bridges[0], JSON.stringify({
      session_id: previous, remaining_percentage: 45,
      total_tokens: 1_000_000, timestamp: Math.floor(Date.now() / 1000),
    }));
    fs.writeFileSync(bridges[1], JSON.stringify({
      session_id: fresh, remaining_percentage: 89,
      total_tokens: 1_000_000, timestamp: Math.floor(Date.now() / 1000),
    }));

    const name = 'ctx-gauge-test-regression';
    written.push(recordFile(name));
    try {
      gauge.recordClaudeSession({ tmuxSession: name, sessionId: fresh, cwd: '/proj' });
      const sessionId = gauge.claudeSessionForTmuxSession(name);
      const usage = gauge.readContextUsage({ agent: 'claude', projectPath: '/proj', sessionId });
      expect(Math.round(usage.usedPct)).toBe(13);
      // The number the bug rendered. Asserted explicitly so a future refactor
      // that reintroduces project-keyed resolution fails loudly here.
      expect(Math.round(usage.usedPct)).not.toBe(66);
    } finally {
      bridges.forEach(f => fs.rmSync(f, { force: true }));
    }
  });

  test('no record yields null, so the caller falls back instead of guessing', () => {
    // Null is the signal both renderers use to reach for their older
    // project-keyed lookup — an unwrapped `claude`, or the tick before the first
    // status-line render. It must never be confused with "0% used".
    expect(gauge.claudeSessionForTmuxSession('ctx-gauge-test-absent')).toBeNull();
    expect(gauge.claudeSessionForTmuxSession('')).toBeNull();
    expect(gauge.claudeSessionForTmuxSession(undefined)).toBeNull();
  });

  test('a record past its TTL is refused rather than believed', () => {
    // tmux session names embed the launcher pid, and pids come round again after
    // a reboot. A live session rewrites its record every render, so only a
    // genuinely dead one can age out.
    const name = 'ctx-gauge-test-stale';
    const file = recordFile(name);
    written.push(file);
    gauge.recordClaudeSession({ tmuxSession: name, sessionId: 'stale-session', cwd: '/proj' });
    const rec = JSON.parse(fs.readFileSync(file, 'utf8'));
    rec.ts = Date.now() - (25 * 60 * 60 * 1000);
    fs.writeFileSync(file, JSON.stringify(rec));
    expect(gauge.claudeSessionForTmuxSession(name)).toBeNull();
  });

  test('a session id shaped like a traversal is not recorded', () => {
    // The id reaches path.join in readClaude; refusing it at the writer keeps a
    // poisoned record from ever existing.
    const name = 'ctx-gauge-test-traversal';
    written.push(recordFile(name));
    expect(gauge.recordClaudeSession({ tmuxSession: name, sessionId: '../../etc/passwd' })).toBe(false);
    expect(gauge.claudeSessionForTmuxSession(name)).toBeNull();
  });

  test('a tmux session name that cannot key a file is refused, not coerced', () => {
    expect(gauge.recordClaudeSession({ tmuxSession: '../..', sessionId: 'x' })).toBe(false);
    expect(gauge.recordClaudeSession({ tmuxSession: '', sessionId: 'x' })).toBe(false);
  });
});

describe('paneIdentity (the cache-key coupling)', () => {
  /**
   * An empty per-machine config, so the key is the developer's to predict.
   *
   * paneIdentity() ends the suffix with a fingerprint of the ENABLED FEATURE
   * SET, which it resolves from ~/.coding/features.yaml unless told otherwise.
   * Without this pin the exact-suffix assertion below silently encodes whatever
   * the machine running the suite happens to have switched on — and it did:
   * `statusline: false` on one laptop turned '-coding-claude-w200' into
   * '-coding-claude-w200-fe6' and failed a test about AGENT identity for
   * reasons that have nothing to do with agents.
   */
  let featurelessHome;
  beforeAll(() => {
    featurelessHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pane-identity-'));
    fs.mkdirSync(path.join(featurelessHome, '.coding'), { recursive: true });
  });
  afterAll(() => fs.rmSync(featurelessHome, { recursive: true, force: true }));

  const allOn = () => ({ CODING_REPO: REPO_ROOT, CODING_HOME: featurelessHome });

  test('the agent is part of the key, so two agents on one project do not share a cache', () => {
    const base = { ...allOn(), TRANSCRIPT_SOURCE_PROJECT: '/Users/x/coding', TMUX_PANE_WIDTH: '200' };
    const a = paneIdentity({ ...base, CODING_AGENT: 'claude' }).suffix;
    const b = paneIdentity({ ...base, CODING_AGENT: 'opencode' }).suffix;
    expect(a).not.toBe(b);
    expect(a).toBe('-coding-claude-w200');
  });

  test('a switched-off feature changes the key, all-on leaves it historical', () => {
    // The other half of the same coupling: an all-on install must keep the
    // filenames it has always had, and any narrowing must produce a different
    // one — otherwise a stale line survives the toggle for the cache lifetime.
    const base = { TRANSCRIPT_SOURCE_PROJECT: '/Users/x/coding', TMUX_PANE_WIDTH: '200', CODING_AGENT: 'claude' };
    const paredHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pane-identity-off-'));
    try {
      fs.mkdirSync(path.join(paredHome, '.coding'), { recursive: true });
      fs.writeFileSync(path.join(paredHome, '.coding', 'features.yaml'), 'profile: minimal\n');
      const off = paneIdentity({ ...base, CODING_REPO: REPO_ROOT, CODING_HOME: paredHome }).suffix;
      expect(off).not.toBe('-coding-claude-w200');
      expect(off.startsWith('-coding-claude-w200-f')).toBe(true);
    } finally {
      fs.rmSync(paredHome, { recursive: true, force: true });
    }
  });

  test('panes with no project identity keep the historical shared key', () => {
    expect(paneIdentity({}).suffix).toBe('');
  });
});
