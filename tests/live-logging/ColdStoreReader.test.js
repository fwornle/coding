/**
 * ColdStoreReader Jest tests (Phase 35 plan 35-03 Task 2).
 *
 * Verifies:
 *   1. Range query over observations returns rows in `[from, to)` sorted asc.
 *   2. Repeated identical queries hit the LRU cache (no re-parse).
 *   3. LRU eviction kicks in when cacheSize is exceeded.
 *   4. Missing exportDir → returns [] without throwing.
 *   5. Malformed JSON → returns [] without throwing.
 *   6. Source-grep invariant: ColdStoreReader.js contains zero write-API refs
 *      (CONTEXT.md L6 / Phase 35 invariant #3).
 *   7. readDigests range query works analogously, keyed on `date`.
 *
 * ESM-only: top-level `import` is fine in this project — package.json declares
 * `"type": "module"` and jest runs with `--experimental-vm-modules`.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ColdStoreReader } from '../../src/live-logging/ColdStoreReader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const MODULE_PATH = path.join(REPO_ROOT, 'src', 'live-logging', 'ColdStoreReader.js');

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Build N rows of fixture observations, one per day at 12:00 UTC for the most
 * recent N days. Day 0 = today's UTC midnight, day -1 = yesterday's, etc.
 */
function buildObservationFixtures(daysBack) {
  const todayMidnightUTC = Date.UTC(
    new Date().getUTCFullYear(),
    new Date().getUTCMonth(),
    new Date().getUTCDate(),
  );
  const rows = [];
  for (let i = 0; i < daysBack; i++) {
    const ts = todayMidnightUTC - i * MS_PER_DAY + 12 * 60 * 60 * 1000; // 12:00 UTC of day -i
    const iso = new Date(ts).toISOString();
    rows.push({
      id: `obs-${i}`,
      summary: `Intent: fixture ${i}\nApproach: synthetic\nResult: ok`,
      agent: 'mastra',
      project: 'coding',
      quality: 'normal',
      createdAt: iso,
      digestedAt: null,
      llm: { model: 'gpt-4', provider: 'openai' },
      modifiedFiles: null,
    });
  }
  return rows;
}

function buildDigestFixtures(daysBack) {
  const todayMidnightUTC = Date.UTC(
    new Date().getUTCFullYear(),
    new Date().getUTCMonth(),
    new Date().getUTCDate(),
  );
  const rows = [];
  for (let i = 0; i < daysBack; i++) {
    const ts = todayMidnightUTC - i * MS_PER_DAY + 12 * 60 * 60 * 1000;
    const iso = new Date(ts).toISOString();
    rows.push({
      id: `dig-${i}`,
      date: iso.slice(0, 10),
      theme: `fixture-theme-${i}`,
      summary: `digest fixture ${i}`,
      observationIds: [`obs-${i}`],
      agents: ['mastra'],
      filesTouched: [],
      quality: 'normal',
      createdAt: iso,
      metadata: {},
      project: 'coding',
    });
  }
  return rows;
}

function daysAgoIso(n) {
  const todayMidnightUTC = Date.UTC(
    new Date().getUTCFullYear(),
    new Date().getUTCMonth(),
    new Date().getUTCDate(),
  );
  return new Date(todayMidnightUTC - n * MS_PER_DAY).toISOString();
}

function daysAgoYMD(n) {
  return daysAgoIso(n).slice(0, 10);
}

describe('ColdStoreReader', () => {
  let tmpDir;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coldstore-'));
    const obs = buildObservationFixtures(30);
    const dig = buildDigestFixtures(30);
    fs.writeFileSync(path.join(tmpDir, 'observations.json'), JSON.stringify(obs, null, 2));
    fs.writeFileSync(path.join(tmpDir, 'digests.json'), JSON.stringify(dig, null, 2));
  });

  afterAll(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('1. readObservations returns rows in [from, to) sorted ascending by createdAt', () => {
    const reader = new ColdStoreReader({ exportDir: tmpDir, cacheSize: 4 });
    const from = daysAgoIso(14);
    const to = daysAgoIso(7);

    const rows = reader.readObservations({ from, to });

    expect(rows.length).toBeGreaterThanOrEqual(6);
    expect(rows.length).toBeLessThanOrEqual(8);
    for (const row of rows) {
      expect(row.createdAt >= from && row.createdAt < to).toBe(true);
      expect(row).toHaveProperty('id');
      expect(row).toHaveProperty('summary');
      expect(row).toHaveProperty('createdAt');
    }
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].createdAt >= rows[i - 1].createdAt).toBe(true);
    }
  });

  it('2. repeated identical query hits the LRU cache (no re-parse)', () => {
    const reader = new ColdStoreReader({ exportDir: tmpDir, cacheSize: 16 });
    const from = daysAgoIso(14);
    const to = daysAgoIso(7);

    const first = reader.readObservations({ from, to });
    const statsAfterFirst = reader._stats();
    expect(statsAfterFirst.observationsParsed).toBe(1);
    expect(statsAfterFirst.cacheMisses).toBeGreaterThan(0);
    const hitsAfterFirst = statsAfterFirst.cacheHits;

    const second = reader.readObservations({ from, to });
    const statsAfterSecond = reader._stats();
    expect(statsAfterSecond.observationsParsed).toBe(1); // NOT re-parsed
    expect(statsAfterSecond.cacheHits).toBeGreaterThan(hitsAfterFirst);
    expect(second.length).toBe(first.length);
  });

  it('3. LRU eviction caps cache at cacheSize entries', () => {
    const reader = new ColdStoreReader({ exportDir: tmpDir, cacheSize: 3 });
    // Five distinct 1-day windows
    for (let i = 0; i < 5; i++) {
      reader.readObservations({
        from: daysAgoIso(20 - i),
        to: daysAgoIso(19 - i),
      });
    }
    expect(reader._stats().cacheKeys).toBeLessThanOrEqual(3);
  });

  it('4. missing exportDir → returns [] without throwing', () => {
    const reader = new ColdStoreReader({ exportDir: '/nonexistent-12345' });
    const obs = reader.readObservations({ from: daysAgoIso(7), to: daysAgoIso(0) });
    const dig = reader.readDigests({ from: daysAgoYMD(7), to: daysAgoYMD(0) });
    expect(obs).toEqual([]);
    expect(dig).toEqual([]);
  });

  it('5. malformed JSON → returns [] without throwing', () => {
    const badDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coldstore-bad-'));
    try {
      fs.writeFileSync(path.join(badDir, 'observations.json'), 'not valid json');
      fs.writeFileSync(path.join(badDir, 'digests.json'), '{"not":"an array"}');
      const reader = new ColdStoreReader({ exportDir: badDir });
      expect(reader.readObservations({ from: daysAgoIso(7), to: daysAgoIso(0) })).toEqual([]);
      expect(reader.readDigests({ from: daysAgoYMD(7), to: daysAgoYMD(0) })).toEqual([]);
    } finally {
      fs.rmSync(badDir, { recursive: true, force: true });
    }
  });

  it('6. invariant #3 — source contains zero write-API references', () => {
    const src = fs.readFileSync(MODULE_PATH, 'utf8');
    const writeApiRe = /fs\.(writeFile|appendFile|createWriteStream)/;
    expect(writeApiRe.test(src)).toBe(false);
    // Sanity: the reader does actually read.
    expect(src.includes('readFileSync') || src.includes('readFile(')).toBe(true);
  });

  it('7. readDigests returns digests whose date is in [from, to)', () => {
    const reader = new ColdStoreReader({ exportDir: tmpDir, cacheSize: 16 });
    const from = daysAgoYMD(14);
    const to = daysAgoYMD(7);

    const rows = reader.readDigests({ from, to });

    expect(rows.length).toBeGreaterThanOrEqual(6);
    expect(rows.length).toBeLessThanOrEqual(8);
    for (const row of rows) {
      expect(row.date >= from && row.date < to).toBe(true);
      expect(row).toHaveProperty('id');
      expect(row).toHaveProperty('theme');
    }
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].date >= rows[i - 1].date).toBe(true);
    }
  });
});
