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

import { describe, test, expect, beforeAll, beforeEach, afterAll, afterEach } from '@jest/globals';
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

  // Pin the model catalogue OUT of these tests.
  //
  // Every fixture below asserts a percentage, and a percentage is tokens over a
  // window. The wire-semantics tests are about the numerator — whether cache
  // reads are added — so the denominator has to be a constant of the test, not
  // of whichever models.json the developer's machine happens to have cached.
  // Pointing both catalogue sources at paths that do not exist forces
  // contextWindowFor onto its regex table, where claude-* is a flat 200000.
  // The catalogue path gets its own describe block, with its own fixture.
  process.env.OPENCODE_MODELS_JSON = path.join(tmp, 'no-catalogue.json');
  process.env.OPENCODE_CONFIG = path.join(tmp, 'no-config.json');
});
afterAll(() => {
  delete process.env.OPENCODE_MODELS_JSON;
  delete process.env.OPENCODE_CONFIG;
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
    // Sliced to a fixed width rather than cut at the first space: the trough is
    // spaces now, so splitting on one would truncate the bar at its first
    // empty cell and silently assert against a fragment.
    const bar = (p) => [...gauge.renderGauge(p).replace(/#\[[^\]]*\]/g, '')]
      .slice(0, gauge.BAR_SEGMENTS).join('');
    expect(bar(0)).toBe(gauge.EMPTY.repeat(N));
    expect(bar(50)).toBe(gauge.FILLED.repeat(Math.floor(N / 2))
      + gauge.EMPTY.repeat(N - Math.floor(N / 2)));
    expect(bar(100)).toBe(gauge.FILLED.repeat(N));
    // Monotonic: more context used never means fewer filled cells.
    let prev = -1;
    for (let p = 0; p <= 100; p += 1) {
      const filled = [...bar(p)].filter((c) => c === '█').length;
      expect(filled).toBeGreaterThanOrEqual(prev);
      prev = filled;
    }
  });

  test('fill has sub-cell resolution, and any usage at all is visible', () => {
    // Whole-cell fill gave 0 filled cells for anything under one segment's worth
    // (12.5% at BAR_SEGMENTS=8), so the entire first eighth of the context window
    // rendered as an empty trough — 11% and 0% were pixel-identical, and the
    // dithered ░ trough reads as a solid block at terminal font sizes, so it
    // looked like the bar had stopped working rather than like a low reading.
    //
    // Measured in eighths rather than whole blocks: that IS the fix, so a test
    // counting only '█' would assert the behaviour that was wrong.
    // Sliced to a fixed width rather than cut at the first space: the trough is
    // spaces now, so splitting on one would truncate the bar at its first
    // empty cell and silently assert against a fragment.
    const bar = (p) => [...gauge.renderGauge(p).replace(/#\[[^\]]*\]/g, '')]
      .slice(0, gauge.BAR_SEGMENTS).join('');
    const eighths = (p) => [...bar(p)].reduce((n, c) => {
      if (c === '█') return n + gauge.SUBCELLS;
      const i = gauge.PARTIALS.indexOf(c);
      return i === -1 ? n : n + i + 1;
    }, 0);

    // Nothing used still reads as nothing used.
    expect(eighths(0)).toBe(0);
    // Every non-zero reading shows something, including ones far below a cell.
    for (let p = 1; p <= 100; p += 1) expect(eighths(p)).toBeGreaterThan(0);
    // Strictly finer than whole cells: readings that used to collapse together
    // below the first cell boundary are now distinguishable from each other.
    expect(eighths(2)).toBeLessThan(eighths(11));
    // Monotonic in eighths, and exact at the ends.
    let prev = -1;
    for (let p = 0; p <= 100; p += 1) {
      expect(eighths(p)).toBeGreaterThanOrEqual(prev);
      prev = eighths(p);
    }
    expect(eighths(100)).toBe(gauge.BAR_SEGMENTS * gauge.SUBCELLS);
  });

  test('a partially filled cell is still exactly one cell', () => {
    // The whole point of sub-cell fill is resolution WITHOUT width. If a partial
    // glyph ever cost a different number of cells the line would grow past the
    // pane edge on some readings only — the trailing-residue bug, back again and
    // intermittent.
    for (let p = 0; p <= 100; p += 1) {
      expect(cells(gauge.renderGauge(p))).toBe(gauge.GAUGE_CELLS);
    }
    // And the patcher must still recognise every one of them, or the fast path
    // silently stops substituting and the gauge freezes at the last full render.
    for (let p = 0; p <= 100; p += 1) {
      expect(gauge.GAUGE_RE.test(gauge.renderGauge(p))).toBe(true);
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
    // Calm band, empty trough — a painted dark-green bar, nothing filled.
    expect(gauge.GAUGE_ZERO).toContain(gauge.EMPTY.repeat(gauge.BAR_SEGMENTS));
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

describe('contextWindowFor — the model catalogue outranks the regex table', () => {
  /**
   * Why this block exists.
   *
   * The regex table asserts that anything matching /^claude-/ has a 200K window.
   * That was true once and is now false for the models these agents actually
   * run: models.dev puts github-copilot/claude-opus-5 at 1,000,000. The gap was
   * not cosmetic — a measured 188,240-token opencode session rendered 94% bold
   * red (the about-to-compact state) instead of 19% green, and switching model
   * could not move the gauge because the table mapped every claude-* to the same
   * fabricated number.
   *
   * So: the catalogue must win over the table, a user's own per-provider
   * declaration must win over the catalogue, and the table must still answer
   * when neither exists. Those three, in that order, are what is tested here.
   */
  const limits = require(path.join(REPO_ROOT, 'lib', 'statusline', 'model-limits.cjs'));

  let dir;
  let prevRepo;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(tmp, 'catalogue-'));
    // The derived cache is keyed on the source's mtime+size and written under
    // $CODING_REPO/.logs — give each test its own so they cannot share one.
    prevRepo = process.env.CODING_REPO;
    process.env.CODING_REPO = dir;
    limits._resetForTests();
  });
  afterEach(() => {
    if (prevRepo === undefined) delete process.env.CODING_REPO;
    else process.env.CODING_REPO = prevRepo;
    process.env.OPENCODE_MODELS_JSON = path.join(tmp, 'no-catalogue.json');
    process.env.OPENCODE_CONFIG = path.join(tmp, 'no-config.json');
    limits._resetForTests();
  });

  function catalogue(providers) {
    const file = path.join(dir, 'models.json');
    fs.writeFileSync(file, JSON.stringify(providers));
    process.env.OPENCODE_MODELS_JSON = file;
    return file;
  }

  test('a catalogued 1M model reads as 1M, not as the tables 200K', () => {
    catalogue({
      'github-copilot': { models: { 'claude-opus-5': { limit: { context: 1_000_000 } } } },
    });
    expect(gauge.contextWindowFor('claude-opus-5', 'github-copilot')).toBe(1_000_000);
    // The exact regression: 188240 tokens is 19%, not the 94% that painted red.
    expect((188_240 / gauge.contextWindowFor('claude-opus-5', 'github-copilot')) * 100)
      .toBeCloseTo(18.8, 1);
  });

  test('a model id is resolved even under a provider no catalogue knows', () => {
    // The rapid-proxy case: the provider is declared in the user's own config
    // and appears in no public catalogue, but the ids it exposes are the real
    // upstream ids — the proxy rewrites the model by band and forwards.
    catalogue({
      'github-copilot': { models: { 'claude-sonnet-5': { limit: { context: 1_000_000 } } } },
    });
    expect(gauge.contextWindowFor('claude-sonnet-5', 'rapid-proxy')).toBe(1_000_000);
  });

  test('windows differ per provider, and the provider is honoured', () => {
    catalogue({
      'github-copilot': { models: { m: { limit: { context: 1_000_000 } } } },
      other: { models: { m: { limit: { context: 128_000 } } } },
    });
    expect(gauge.contextWindowFor('m', 'other')).toBe(128_000);
    expect(gauge.contextWindowFor('m', 'github-copilot')).toBe(1_000_000);
  });

  test('the users own per-provider limit outranks the catalogue', () => {
    // A self-hosted endpoint is the case: qwen3.8-27b-local is catalogued at
    // 262144, but this user's laptop llama.cpp serves it with a 32K window and
    // says so in opencode.json. Taking the catalogue there would under-report
    // occupancy 8x — green while the agent compacts.
    catalogue({ 'qwen-laptop': { models: { 'qwen3.8-27b-local': { limit: { context: 262_144 } } } } });
    const cfg = path.join(dir, 'opencode.json');
    fs.writeFileSync(cfg, JSON.stringify({
      provider: { 'qwen-laptop': { models: { 'qwen3.8-27b-local': { limit: { context: 32_768 } } } } },
    }));
    process.env.OPENCODE_CONFIG = cfg;
    limits._resetForTests();
    expect(gauge.contextWindowFor('qwen3.8-27b-local', 'qwen-laptop')).toBe(32_768);
  });

  test('an explicit [1m] session flag still outranks everything', () => {
    // The suffix is a statement about THIS SESSION's window; no catalogue keyed
    // on a bare model id can carry it.
    catalogue({ 'github-copilot': { models: { 'claude-opus-5': { limit: { context: 200_000 } } } } });
    expect(gauge.contextWindowFor('claude-opus-5[1m]', 'github-copilot')).toBe(1_000_000);
  });

  test('no catalogue on the machine falls back to the table, never to zero', () => {
    process.env.OPENCODE_MODELS_JSON = path.join(dir, 'absent.json');
    limits._resetForTests();
    expect(gauge.contextWindowFor('claude-sonnet-5', 'github-copilot')).toBe(200_000);
  });

  test('a corrupt catalogue is survivable — it falls back, it does not throw', () => {
    const file = path.join(dir, 'models.json');
    fs.writeFileSync(file, '{not json');
    process.env.OPENCODE_MODELS_JSON = file;
    limits._resetForTests();
    expect(gauge.contextWindowFor('claude-sonnet-5', 'github-copilot')).toBe(200_000);
  });

  test('the derived cache is written once and reused, not re-derived per tick', () => {
    // The catalogue is 4.5MB / 33ms to parse, and the status line renders every
    // 5s in a FRESH process per pane — so the boiled-down map has to survive on
    // disk or the gauge costs a third of the render budget every tick.
    catalogue({ 'github-copilot': { models: { 'claude-opus-5': { limit: { context: 1_000_000 } } } } });
    expect(gauge.contextWindowFor('claude-opus-5', 'github-copilot')).toBe(1_000_000);
    const cache = path.join(dir, '.logs', 'model-context-limits.json');
    expect(fs.existsSync(cache)).toBe(true);
    expect(JSON.parse(fs.readFileSync(cache, 'utf8')).byPair['github-copilot/claude-opus-5'])
      .toBe(1_000_000);
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
  /**
   * Mirrors opencode's real `session` schema for the columns the reader names.
   *
   * parent_id / time_archived / time_created are not decoration: the reader
   * filters on all three to avoid reading a subagent's, an archived, or a
   * pre-restart session. A fixture missing them makes the query throw and every
   * assertion below would then pass against a null the test never asked for.
   */
  function seed(dbPath, messages, session = {}) {
    const d = new Database(dbPath);
    d.exec(`
      CREATE TABLE session (id TEXT PRIMARY KEY, directory TEXT, model TEXT,
                            parent_id TEXT, time_created INTEGER,
                            time_updated INTEGER, time_archived INTEGER,
                            tokens_input INTEGER);
      CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT,
                            time_created INTEGER, data TEXT);
    `);
    d.prepare('INSERT INTO session VALUES (?,?,?,?,?,?,?,?)').run(
      session.id ?? 's1',
      session.directory ?? '/proj',
      session.model ?? '{"id":"claude-sonnet-5"}',
      session.parent_id ?? null,
      session.time_created ?? 100,
      session.time_updated ?? 100,
      session.time_archived ?? null,
      9999999,
    );
    const ins = d.prepare('INSERT INTO message VALUES (?,?,?,?)');
    messages.forEach((m, i) => ins.run(`m${i}`, session.id ?? 's1', i, JSON.stringify(m)));
    d.close();
  }

  /**
   * A compaction message, shaped as opencode really writes one.
   *
   * All three markers together, and a FOREIGN model: verified across all 216
   * compaction messages in a real database, every one carries `summary: true`,
   * `mode: 'compaction'` and `agent: 'compaction'`, and they run on whatever
   * model is configured for compaction — measured as claude-opus-4.6, gpt-5.4
   * and gpt-4o/rapid-proxy in a database whose conversations are claude-opus-5.
   * The foreign model is the point: it is what lent its 128K window to a 194K
   * count that belonged to a 1M model.
   */
  function compaction(inputTokens) {
    return {
      role: 'assistant',
      mode: 'compaction',
      agent: 'compaction',
      summary: true,
      modelID: 'gpt-4o',
      providerID: 'rapid-proxy',
      tokens: { input: inputTokens, output: 5703, cache: { read: 0, write: 0 } },
    };
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

  /**
   * THE 100% RED GAUGE ON A ONE-FIFTH-FULL SESSION.
   *
   * The count and the model used to be gathered independently: `used` as a max
   * over the trailing window, `model` from whichever message happened to be
   * newest. Nothing tied them together, so a window spanning two models paired
   * one model's token count with the other's context window.
   *
   * Measured on a real session: 194,184 claude-opus-5 tokens — 19% of its 1M
   * window — divided by gpt-4o's 128K, which clamps to a bold red 100%.
   */
  test('the window comes from the message that supplied the count, not the newest', () => {
    const db = path.join(tmp, 'oc-model-pairing.db');
    seed(db, [
      // The big reading, on a 200K model.
      { role: 'assistant', modelID: 'claude-sonnet-5', tokens: { input: 100000, cache: { read: 0 } } },
      // Newest, small, on a 128K model — a mid-session /model switch.
      { role: 'assistant', modelID: 'gpt-4o', tokens: { input: 10000, cache: { read: 0 } } },
    ]);
    process.env.OPENCODE_DB_PATH = db;
    try {
      const r = gauge.readContextUsage({ agent: 'opencode', projectPath: '/proj' });
      // 100000 of claude-sonnet-5's 200000. NOT 100000 of gpt-4o's 128000 (78%).
      expect(r.usedPct).toBeCloseTo(50, 5);
      expect(r.model).toBe('claude-sonnet-5');
    } finally {
      delete process.env.OPENCODE_DB_PATH;
    }
  });

  /**
   * Compaction is the one event that makes the conversation SMALLER, so a max
   * over a window that spans it reports the size of the conversation that was
   * just discarded — and goes on reporting it for as many turns as the window
   * is wide.
   */
  test('the trailing window does not reach back past a compaction', () => {
    const db = path.join(tmp, 'oc-compaction-boundary.db');
    seed(db, [
      { role: 'assistant', modelID: 'claude-sonnet-5', tokens: { input: 190000, cache: { read: 0 } } },
      compaction(110000),
      { role: 'assistant', modelID: 'claude-sonnet-5', tokens: { input: 40000, cache: { read: 0 } } },
    ]);
    process.env.OPENCODE_DB_PATH = db;
    try {
      // 40000/200000 — the conversation as it stands. Not 190000/200000 (95%),
      // and not the compaction's own 110000 either.
      expect(gauge.readContextUsage({ agent: 'opencode', projectPath: '/proj' }).usedPct)
        .toBeCloseTo(20, 5);
    } finally {
      delete process.env.OPENCODE_DB_PATH;
    }
  });

  test('a compaction with nothing after it yet reads zero, and says why', () => {
    const db = path.join(tmp, 'oc-compaction-only.db');
    seed(db, [
      { role: 'assistant', modelID: 'claude-sonnet-5', tokens: { input: 190000, cache: { read: 0 } } },
      compaction(110000),
    ]);
    process.env.OPENCODE_DB_PATH = db;
    try {
      const r = gauge.readContextUsage({ agent: 'opencode', projectPath: '/proj' });
      // The session really has been emptied; its new size is not yet measured
      // and arrives on the next assistant turn.
      expect(r.usedPct).toBe(0);
      expect(r.source).toBe('opencode-db-compacted');
    } finally {
      delete process.env.OPENCODE_DB_PATH;
    }
  });

  test.each([
    ['summary', { summary: true }],
    ['mode', { mode: 'compaction' }],
    ['agent', { agent: 'compaction' }],
  ])('a compaction is recognised by its %s marker alone', (_name, marker) => {
    const db = path.join(tmp, `oc-compaction-${_name}.db`);
    seed(db, [
      { role: 'assistant', modelID: 'claude-sonnet-5', tokens: { input: 190000, cache: { read: 0 } } },
      { role: 'assistant', modelID: 'gpt-4o', tokens: { input: 110000, cache: { read: 0 } }, ...marker },
      { role: 'assistant', modelID: 'claude-sonnet-5', tokens: { input: 40000, cache: { read: 0 } } },
    ]);
    process.env.OPENCODE_DB_PATH = db;
    try {
      expect(gauge.readContextUsage({ agent: 'opencode', projectPath: '/proj' }).usedPct)
        .toBeCloseTo(20, 5);
    } finally {
      delete process.env.OPENCODE_DB_PATH;
    }
  });

  /**
   * opencode writes the assistant row when a turn STARTS, with every token
   * field zero, and fills it in when the turn completes. Runs of four such rows
   * back to back are measured in a real database — with a five-message window
   * that leaves room for exactly one real reading, and one more evicts them
   * all, at which point a mid-conversation session reports itself empty.
   */
  test('zero-token placeholder rows do not evict real readings from the window', () => {
    const db = path.join(tmp, 'oc-placeholders.db');
    const placeholder = {
      role: 'assistant',
      modelID: 'claude-sonnet-5',
      tokens: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    };
    seed(db, [
      { role: 'assistant', modelID: 'claude-sonnet-5', tokens: { input: 100000, cache: { read: 0 } } },
      placeholder, placeholder, placeholder, placeholder, placeholder,
    ]);
    process.env.OPENCODE_DB_PATH = db;
    try {
      const r = gauge.readContextUsage({ agent: 'opencode', projectPath: '/proj' });
      expect(r.usedPct).toBeCloseTo(50, 5);
      expect(r.source).toBe('opencode-db');
    } finally {
      delete process.env.OPENCODE_DB_PATH;
    }
  });

  test('a session of nothing but placeholders is still fresh, not a hole', () => {
    const db = path.join(tmp, 'oc-placeholders-only.db');
    seed(db, [
      { role: 'assistant', modelID: 'claude-sonnet-5', tokens: { input: 0, cache: { read: 0 } } },
    ]);
    process.env.OPENCODE_DB_PATH = db;
    try {
      const r = gauge.readContextUsage({ agent: 'opencode', projectPath: '/proj' });
      expect(r.usedPct).toBe(0);
      expect(r.source).toBe('opencode-db-fresh');
    } finally {
      delete process.env.OPENCODE_DB_PATH;
    }
  });
});

describeSqlite('opencode reader — which session belongs to this pane', () => {
  /**
   * These are the ways the reader used to answer with a session the pane was
   * not in. They rendered as one symptom: a pane showing the PREVIOUS
   * conversation's occupancy — 94% bold red on a pane that had not yet sent a
   * message, 100% on one the user had just cleared — and going on showing it
   * until the user typed.
   *
   * The pane's launch instant comes from the record tmux-session-wrapper.sh
   * writes, so each test builds one.
   */
  function seedSessions(dbPath, sessions, messagesBySession) {
    const d = new Database(dbPath);
    d.exec(`
      CREATE TABLE session (id TEXT PRIMARY KEY, directory TEXT, model TEXT,
                            parent_id TEXT, time_created INTEGER,
                            time_updated INTEGER, time_archived INTEGER,
                            tokens_input INTEGER);
      CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT,
                            time_created INTEGER, data TEXT);
    `);
    const si = d.prepare('INSERT INTO session VALUES (?,?,?,?,?,?,?,?)');
    for (const s of sessions) {
      si.run(s.id, s.directory ?? '/proj', '{"id":"claude-sonnet-5"}',
        s.parent_id ?? null, s.time_created, s.time_updated ?? s.time_created,
        s.time_archived ?? null, 0);
    }
    const mi = d.prepare('INSERT INTO message VALUES (?,?,?,?)');
    for (const [sid, msgs] of Object.entries(messagesBySession)) {
      // `at` sets a real timestamp, for the tests that rank sessions by when the
      // user last spoke in each. Index order is the default and is enough
      // wherever only the ordering within one session matters.
      msgs.forEach(({ at, ...m }, i) => mi.run(`${sid}-m${i}`, sid, at ?? i, JSON.stringify(m)));
    }
    d.close();
  }

  /** A pane launch record, exactly as _record_agent_session() writes it. */
  function pane(name, startedAt) {
    const repo = fs.mkdtempSync(path.join(tmp, 'pane-repo-'));
    fs.mkdirSync(path.join(repo, '.data', 'agent-sessions'), { recursive: true });
    fs.writeFileSync(
      path.join(repo, '.data', 'agent-sessions', `${name}.json`),
      JSON.stringify({ agent: 'opencode', projectPath: '/proj', tmuxSession: name, startedAt }),
    );
    return repo;
  }

  const big = (n) => ({ role: 'assistant', modelID: 'claude-sonnet-5', tokens: { input: n, cache: { read: 0 } } });

  /**
   * A user message at a given instant — the evidence that a human was in this
   * session, which is what separates it from a background write.
   */
  const user = (at) => ({ at, role: 'user', time: { created: at } });

  function withPane(repo, dbPath, fn) {
    const prevRepo = process.env.CODING_REPO;
    process.env.CODING_REPO = repo;
    process.env.OPENCODE_DB_PATH = dbPath;
    try {
      return fn();
    } finally {
      if (prevRepo === undefined) delete process.env.CODING_REPO;
      else process.env.CODING_REPO = prevRepo;
      delete process.env.OPENCODE_DB_PATH;
    }
  }

  test('a session from before this pane launched is NOT reported as its context', () => {
    // The reported bug, reduced: opencode creates the session row lazily, on the
    // first assistant message, so a pane that has not been prompted yet owns no
    // row at all — and the newest row in the directory belongs to the session
    // that was running here before the restart.
    const db = path.join(tmp, 'oc-restart.db');
    seedSessions(db, [{ id: 'before', time_created: 1000, time_updated: 2000 }], { before: [big(188000)] });
    const repo = pane('coding-opencode-1', 5000);

    withPane(repo, db, () => {
      const r = gauge.readContextUsage({
        agent: 'opencode', projectPath: '/proj', tmuxSession: 'coding-opencode-1',
      });
      // Zero, not 94%, and not null: the store IS readable, this pane simply has
      // no session yet. A hole would read as a fault; the previous session's
      // number would be a lie.
      expect(r.usedPct).toBe(0);
      expect(r.source).toBe('opencode-db-fresh');
    });
  });

  test('the session this pane started IS reported, once it has one', () => {
    const db = path.join(tmp, 'oc-after.db');
    seedSessions(db, [
      { id: 'before', time_created: 1000, time_updated: 2000 },
      { id: 'after', time_created: 6000, time_updated: 7000 },
    ], { before: [big(188000)], after: [big(100000)] });
    const repo = pane('coding-opencode-2', 5000);

    withPane(repo, db, () => {
      expect(gauge.readContextUsage({
        agent: 'opencode', projectPath: '/proj', tmuxSession: 'coding-opencode-2',
      }).usedPct).toBeCloseTo(50, 5);
    });
  });

  test('a subagent session is never mistaken for the pane conversation', () => {
    // opencode gives every subagent its own session row in the SAME directory,
    // and while one runs it is the most recently updated row there. Ordering
    // alone therefore hands the gauge a @explore task's context.
    const db = path.join(tmp, 'oc-subagent.db');
    seedSessions(db, [
      { id: 'main', time_created: 6000, time_updated: 7000 },
      { id: 'sub', parent_id: 'main', time_created: 6500, time_updated: 9999 },
    ], { main: [big(100000)], sub: [big(20000)] });
    const repo = pane('coding-opencode-3', 5000);

    withPane(repo, db, () => {
      expect(gauge.readContextUsage({
        agent: 'opencode', projectPath: '/proj', tmuxSession: 'coding-opencode-3',
      }).usedPct).toBeCloseTo(50, 5);
    });
  });

  test('an archived session is not the pane current session', () => {
    const db = path.join(tmp, 'oc-archived.db');
    seedSessions(db, [
      { id: 'live', time_created: 6000, time_updated: 7000 },
      { id: 'put-away', time_created: 6500, time_updated: 9999, time_archived: 9999 },
    ], { live: [big(100000)], 'put-away': [big(190000)] });
    const repo = pane('coding-opencode-4', 5000);

    withPane(repo, db, () => {
      expect(gauge.readContextUsage({
        agent: 'opencode', projectPath: '/proj', tmuxSession: 'coding-opencode-4',
      }).usedPct).toBeCloseTo(50, 5);
    });
  });

  test('no launch record means no lower bound — an unwrapped opencode still reads', () => {
    // paneStartedAtMs returns 0 for a pane it has no record of, and 0 must mean
    // "unbounded", never "started at the epoch". An agent run outside the
    // wrapper has no record and must still get a gauge.
    const db = path.join(tmp, 'oc-unwrapped.db');
    seedSessions(db, [{ id: 'only', time_created: 1000, time_updated: 2000 }], { only: [big(100000)] });
    const repo = pane('coding-opencode-5', 5000); // record exists, but for another pane

    withPane(repo, db, () => {
      expect(gauge.readContextUsage({
        agent: 'opencode', projectPath: '/proj', tmuxSession: 'coding-opencode-unknown',
      }).usedPct).toBeCloseTo(50, 5);
    });
  });

  /**
   * THE /clear CASE, which every filter above passes straight through.
   *
   * `/clear` makes a NEW session inside the SAME pane, so both sessions clear
   * the parent/archived/launch-time filters and only the tie-break separates
   * them. `ORDER BY time_updated DESC` cannot: the discarded session goes on
   * being WRITTEN after the new one is created, by work that was already in
   * flight. Measured:
   *
   *   16:19:46.249  /clear — new session row created
   *   16:20:46.849  PREVIOUS session written again (a compaction landing)
   *
   * For that minute the pane the user had just emptied rendered the context of
   * the conversation they had just discarded.
   */
  test('after /clear, a background write to the previous session does not win', () => {
    const db = path.join(tmp, 'oc-clear.db');
    seedSessions(db, [
      // The discarded conversation: last spoken to at 6000, still being written
      // at 9999 by an in-flight compaction.
      { id: 'discarded', time_created: 6000, time_updated: 9999 },
      // /clear, a moment later. No user message yet — that is the whole point.
      { id: 'cleared', time_created: 8000, time_updated: 8000 },
    ], {
      discarded: [user(6000), big(190000)],
      cleared: [],
    });
    const repo = pane('coding-opencode-6', 5000);

    withPane(repo, db, () => {
      const r = gauge.readContextUsage({
        agent: 'opencode', projectPath: '/proj', tmuxSession: 'coding-opencode-6',
      });
      expect(r.usedPct).toBe(0);
      expect(r.source).toBe('opencode-db-fresh');
    });
  });

  test('the session the user last spoke in wins, however old its row is', () => {
    // The property `ORDER BY time_updated DESC` was defending: resuming an
    // earlier session from the picker must move the gauge with it. A prompt is
    // a user message, and a user message outranks any background write.
    const db = path.join(tmp, 'oc-resume.db');
    seedSessions(db, [
      { id: 'resumed', time_created: 6000, time_updated: 9999 },
      { id: 'newer', time_created: 8000, time_updated: 8000 },
    ], {
      resumed: [big(100000), user(9999)],
      newer: [big(190000)],
    });
    const repo = pane('coding-opencode-7', 5000);

    withPane(repo, db, () => {
      expect(gauge.readContextUsage({
        agent: 'opencode', projectPath: '/proj', tmuxSession: 'coding-opencode-7',
      }).usedPct).toBeCloseTo(50, 5);
    });
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
