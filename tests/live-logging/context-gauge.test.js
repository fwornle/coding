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

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
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

  test('fill tracks the percentage in tenths', () => {
    const bar = (p) => gauge.renderGauge(p).replace(/#\[[^\]]*\]/g, '').split(' ')[0];
    expect(bar(0)).toBe('░'.repeat(10));
    expect(bar(50)).toBe('█'.repeat(5) + '░'.repeat(5));
    expect(bar(100)).toBe('█'.repeat(10));
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

describe('paneIdentity (the cache-key coupling)', () => {
  test('the agent is part of the key, so two agents on one project do not share a cache', () => {
    const base = { TRANSCRIPT_SOURCE_PROJECT: '/Users/x/coding', TMUX_PANE_WIDTH: '200' };
    const a = paneIdentity({ ...base, CODING_AGENT: 'claude' }).suffix;
    const b = paneIdentity({ ...base, CODING_AGENT: 'opencode' }).suffix;
    expect(a).not.toBe(b);
    expect(a).toBe('-coding-claude-w200');
  });

  test('panes with no project identity keep the historical shared key', () => {
    expect(paneIdentity({}).suffix).toBe('');
  });
});
