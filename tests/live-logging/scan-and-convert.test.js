/**
 * lib/lsl/scan-and-convert.mjs tests
 *
 * Phase 50 Plan 01 Task 2: factor seed scripts into a reusable primitive.
 *
 * Tests cover the 6 behaviors enumerated in 50-01-PLAN.md Task 2:
 *  1. scanTranscriptsForUnconverted returns { path, mtime, projectHint, parentSession }
 *  2. since-filter
 *  3. empty paths → []
 *  4. dryRun: true does NOT invoke writer
 *  5. dryRun: false invokes writer.processMessages and propagates `tag`
 *  6. race-guard skips mtime within last 5 min
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { jest } from '@jest/globals';

let tmpDir;

// Mock ObservationWriter via jest.unstable_mockModule so we don't touch the
// real DB / network. Use a module-scoped recorder array that each test can
// inspect.
const writerCalls = [];

jest.unstable_mockModule('../../src/live-logging/ObservationWriter.js', () => ({
  ObservationWriter: class {
    constructor(opts) { this.opts = opts; }
    async init() { /* no-op */ }
    async close() { /* no-op */ }
    async processMessages(messages, metadata = {}) {
      writerCalls.push({ messages, metadata });
      // simulate writing: 1 observation per call when messages contain at least one user+assistant
      const hasUser = messages.some(m => m.role === 'user');
      const hasAsst = messages.some(m => m.role === 'assistant');
      return { observations: hasUser && hasAsst ? 1 : 0, errors: 0 };
    }
  },
}));

jest.unstable_mockModule('../../src/live-logging/TranscriptNormalizer.js', () => ({
  parseClaude: (line) => {
    if (!line.trim()) return null;
    try {
      const obj = JSON.parse(line);
      if (obj.role && obj.content !== undefined) return { role: obj.role, content: obj.content };
    } catch { /* ignore */ }
    return null;
  },
  parseCopilot: (line) => {
    if (!line.trim()) return null;
    try {
      const obj = JSON.parse(line);
      if (obj.role && obj.content !== undefined) return { role: obj.role, content: obj.content };
    } catch { /* ignore */ }
    return null;
  },
  parseSpecstory: () => [],
}));

let scanTranscriptsForUnconverted;
let convertTranscriptsToObservations;

beforeAll(async () => {
  ({ scanTranscriptsForUnconverted, convertTranscriptsToObservations } = await import(
    '../../lib/lsl/scan-and-convert.mjs'
  ));
});

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lsl-scan-'));
  writerCalls.length = 0;
});

afterEach(() => {
  if (tmpDir) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

/** Write a fake LSL .md file. Returns absolute path. */
function writeLSL(relativePath, contents = '# Stub LSL\n') {
  const abs = path.join(tmpDir, relativePath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, contents, 'utf-8');
  return abs;
}

/** Write a fake claude jsonl. Returns absolute path. */
function writeJSONL(relativePath, lines) {
  const abs = path.join(tmpDir, relativePath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, lines.map(l => JSON.stringify(l)).join('\n') + '\n', 'utf-8');
  return abs;
}

describe('scanTranscriptsForUnconverted', () => {
  test('Test 1: returns entries with required fields for LSL files', () => {
    const lslRoot = path.join(tmpDir, '.specstory', 'history', '2026', '05');
    writeLSL('.specstory/history/2026/05/2026-05-23_1400-1500_test.md');
    writeLSL('.specstory/history/2026/05/2026-05-23_1500-1600_test.md');
    // Make mtimes old enough to avoid the race guard.
    const yesterdayMs = Date.now() - 24 * 60 * 60 * 1000;
    for (const f of fs.readdirSync(lslRoot)) {
      const p = path.join(lslRoot, f);
      fs.utimesSync(p, yesterdayMs / 1000, yesterdayMs / 1000);
    }
    const result = scanTranscriptsForUnconverted(
      [path.join(tmpDir, '.specstory', 'history')],
      { project: 'coding' },
    );
    expect(result.length).toBe(2);
    for (const entry of result) {
      expect(entry).toHaveProperty('path');
      expect(entry).toHaveProperty('mtime');
      expect(entry).toHaveProperty('projectHint');
      expect(entry).toHaveProperty('parentSession');
      expect(entry.parentSession).toBeNull(); // LSL files have no parent session
    }
  });

  test('Test 2: since filter — only files with mtime >= since are returned', () => {
    const oldFile = writeLSL('.specstory/history/2026/05/2026-05-20_1400-1500_old.md');
    const newFile = writeLSL('.specstory/history/2026/05/2026-05-25_1400-1500_new.md');
    const oldMs = Date.parse('2026-05-21T00:00:00Z');
    const newMs = Date.parse('2026-05-26T00:00:00Z');
    fs.utimesSync(oldFile, oldMs / 1000, oldMs / 1000);
    fs.utimesSync(newFile, newMs / 1000, newMs / 1000);

    const result = scanTranscriptsForUnconverted(
      [path.join(tmpDir, '.specstory', 'history')],
      { since: '2026-05-23T00:00:00Z' },
    );
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe(newFile);
  });

  test('Test 3: empty paths returns [] without throwing', () => {
    expect(scanTranscriptsForUnconverted([], {})).toEqual([]);
  });
});

describe('convertTranscriptsToObservations', () => {
  test('Test 4: dryRun:true does not invoke writer', async () => {
    const p = writeJSONL('fake.jsonl', [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
    ]);
    // Set mtime old enough to clear the race guard.
    const oldMs = Date.now() - 24 * 60 * 60 * 1000;
    fs.utimesSync(p, oldMs / 1000, oldMs / 1000);
    const result = await convertTranscriptsToObservations(
      [{ path: p }],
      { dryRun: true },
    );
    expect(result).toHaveLength(1);
    expect(result[0].observationsWritten).toBe(0);
    expect(result[0].transcriptPath).toBe(p);
    expect(writerCalls).toHaveLength(0);
  });

  test('Test 5: dryRun:false invokes writer.processMessages with tag propagated', async () => {
    const p = writeJSONL('fake.jsonl', [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
    ]);
    const oldMs = Date.now() - 24 * 60 * 60 * 1000;
    fs.utimesSync(p, oldMs / 1000, oldMs / 1000);
    const result = await convertTranscriptsToObservations(
      [{ path: p }],
      { dryRun: false, tag: 'phase-50-test' },
    );
    expect(result).toHaveLength(1);
    expect(result[0].observationsWritten).toBeGreaterThan(0);
    expect(writerCalls.length).toBeGreaterThan(0);
    // tag must propagate to metadata
    const allTags = writerCalls.map(c => c.metadata?.tag || c.metadata?.source);
    expect(allTags.some(t => t === 'phase-50-test')).toBe(true);
  });

  test('Test 6: race-guard skips files with mtime within the last 5 min', async () => {
    const p = writeJSONL('fresh.jsonl', [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
    ]);
    // mtime is just now (within the 5-min race guard).
    const result = await convertTranscriptsToObservations(
      [{ path: p }],
      { dryRun: false },
    );
    expect(result).toHaveLength(1);
    expect(result[0].skipped).toBeGreaterThan(0);
    expect(result[0].observationsWritten).toBe(0);
    expect(writerCalls).toHaveLength(0);
  });
});
