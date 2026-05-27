/**
 * tests/integration/etm-lsl-rotation.test.js
 *
 * OVERRIDE_CONSTRAINT: no-evolutionary-names
 * (The `EnhancedTranscriptMonitor` class name is an established API name
 * for the ETM and predates the constraint rule; renaming would break dozens
 * of import sites. The rule is a false positive on the literal `Enhanced`
 * substring — see memory/feedback_mkdocs_two_image_dirs.md.)
 *
 * Regression test for the LSL `-N` part-file rotation regression surfaced
 * 2026-05-27. Before the fix, `getActiveSessionFilePath` only consulted
 * the current on-disk file size, so a single fat slice append could grow
 * a file from 50KB → 800KB in one shot (4× the 200KB limit). Worst case,
 * the partNumber>99 safety branch appended without bound to `-99`
 * (observed: 9.8MB `2026-05-02_1600-1700-99_c197ef.md`).
 *
 * The fix makes the picker size-aware about the INTENDED write:
 * `(currentSize + intendedWriteSize) >= maxSizeBytes` advances to the
 * next part. This test exercises both the happy path (small writes stay
 * on the base file) and the rotation path (an intended write that would
 * push over the limit advances to `-1`, `-2`, ...).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let MonitorClass;
let generateLSLFilename;

beforeAll(async () => {
  const etmMod = await import('../../scripts/enhanced-transcript-monitor.js');
  MonitorClass = etmMod.EnhancedTranscriptMonitor || etmMod.default;
  const tz = await import('../../scripts/timezone-utils.js');
  generateLSLFilename = tz.generateLSLFilename;
});

/**
 * Construct a minimal ETM-like object that has just the fields the picker
 * touches. Avoids constructing the real ETM (which spawns subprocesses
 * and opens DBs).
 */
function makeMonitorStub(projectPath, maxSizeKB = 200) {
  return {
    config: {
      projectPath,
      liveLogging: { max_lsl_file_size_kb: maxSizeKB },
    },
    liveLoggingConfig: { max_lsl_file_size_kb: maxSizeKB },
    debug: () => {},
    getActiveSessionFilePath: MonitorClass.prototype.getActiveSessionFilePath,
    getSessionFilePath: MonitorClass.prototype.getSessionFilePath,
  };
}

function makeTranche(date, timeString) {
  const [startHHMM] = timeString.split('-');
  const iso = `${date}T${startHHMM.slice(0, 2)}:${startHHMM.slice(2)}:00.000Z`;
  return {
    date,
    timeString,
    originalTimestamp: new Date(iso).getTime(),
  };
}

describe('ETM getActiveSessionFilePath — size-aware rotation (regression fix 2026-05-27)', () => {
  let tmpDir;
  let projectPath;
  let historyDir;
  let monitor;
  let tranche;
  const MAX_KB = 200;
  const MAX_BYTES = MAX_KB * 1024;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'etm-rotation-'));
    projectPath = path.join(tmpDir, 'coding');
    historyDir = path.join(projectPath, '.specstory', 'history', '2026', '06');
    fs.mkdirSync(historyDir, { recursive: true });
    monitor = makeMonitorStub(projectPath, MAX_KB);
    tranche = makeTranche('2026-06-15', '1000-1100');
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
  });

  test('returns the base file (no -N suffix) when it does not yet exist', () => {
    // The filename's time window is whatever generateLSLFilename produces
    // for the tranche timestamp (uses local TZ, not UTC) — we only assert
    // it has the LSL shape AND lacks a -N part-suffix.
    // Base shape:  _HHMM-HHMM_HASH.md       (positive — matches base only)
    // Part shape:  _HHMM-HHMM-N_HASH.md     (negative — matches parts only)
    const result = monitor.getActiveSessionFilePath(projectPath, tranche, 1024);
    expect(result).toMatch(/\d{4}-\d{2}-\d{2}_\d{4}-\d{4}_[a-z0-9]+\.md$/);
    expect(result).not.toMatch(/\d{4}-\d{4}-\d+_[a-z0-9]+\.md$/);
  });

  test('returns the base file when small + small write would still fit', () => {
    const baseFile = monitor.getSessionFilePath(projectPath, tranche);
    fs.writeFileSync(baseFile, 'x'.repeat(50 * 1024));  // 50KB existing
    // Intended write: 100KB. 50 + 100 = 150KB < 200KB → use base.
    const result = monitor.getActiveSessionFilePath(projectPath, tranche, 100 * 1024);
    expect(result).toBe(baseFile);
  });

  test('advances to part -1 when intended write would push base over the limit', () => {
    const baseFile = monitor.getSessionFilePath(projectPath, tranche);
    fs.writeFileSync(baseFile, 'x'.repeat(150 * 1024));  // 150KB existing
    // Intended write: 100KB. 150 + 100 = 250KB > 200KB → must advance.
    const result = monitor.getActiveSessionFilePath(projectPath, tranche, 100 * 1024);
    expect(result).not.toBe(baseFile);
    expect(result).toMatch(/-1_[a-z0-9]+\.md$/);
  });

  test('intended-write check is the primary rotation trigger (was the regression)', () => {
    // The pre-fix bug: a 50KB base file + 800KB intended write went onto
    // the base file because currentSize alone (50KB) was under the 200KB
    // limit. Post-fix: currentSize+intendedWriteSize > maxSize advances.
    const baseFile = monitor.getSessionFilePath(projectPath, tranche);
    fs.writeFileSync(baseFile, 'x'.repeat(50 * 1024));
    const result = monitor.getActiveSessionFilePath(projectPath, tranche, 800 * 1024);
    expect(result).not.toBe(baseFile);
    expect(result).toMatch(/-1_[a-z0-9]+\.md$/);
  });

  test('chains through multiple full parts to find one with room', () => {
    const baseFile = monitor.getSessionFilePath(projectPath, tranche);
    fs.writeFileSync(baseFile, 'x'.repeat(MAX_BYTES));  // full

    // Manually write -1, -2 as full
    const currentProjectName = path.basename(projectPath);
    for (const n of [1, 2]) {
      const partName = generateLSLFilename(
        tranche.originalTimestamp, currentProjectName, projectPath, projectPath, { partNumber: n },
      );
      fs.writeFileSync(path.join(historyDir, partName), 'x'.repeat(MAX_BYTES));
    }

    // -3 is fresh → picker returns it for a normal-sized write.
    const result = monitor.getActiveSessionFilePath(projectPath, tranche, 10 * 1024);
    expect(result).toMatch(/-3_[a-z0-9]+\.md$/);
  });

  test('single-slice mega-write still lands somewhere (no infinite loop)', () => {
    // If intendedWriteSize alone > maxSizeBytes, picker still returns a
    // fresh empty part (we accept one part > limit rather than corrupt
    // markdown by splitting mid-anchor). The important contract is that
    // it does NOT bloat an existing partially-full part.
    const baseFile = monitor.getSessionFilePath(projectPath, tranche);
    fs.writeFileSync(baseFile, 'x'.repeat(100 * 1024));  // 100KB partial

    const result = monitor.getActiveSessionFilePath(projectPath, tranche, 5 * 1024 * 1024);  // 5MB
    expect(result).not.toBe(baseFile);  // does NOT pile on top of the 100KB base
    expect(result).toMatch(/-[0-9]+_[a-z0-9]+\.md$/);
  });

  test('never appends to a partial -99 (the 9.8MB pre-fix bloat case)', () => {
    // Pre-fix: when partNumber > 99 hit the safety cap, the picker
    // returned the LAST part path and the writer appended forever to it.
    // Verify the new code doesn't return an already-bloated -99.
    const baseFile = monitor.getSessionFilePath(projectPath, tranche);
    fs.writeFileSync(baseFile, 'x'.repeat(MAX_BYTES));  // full

    const currentProjectName = path.basename(projectPath);
    const written = [];
    for (let n = 1; n <= 99; n++) {
      const partName = generateLSLFilename(
        tranche.originalTimestamp, currentProjectName, projectPath, projectPath, { partNumber: n },
      );
      const p = path.join(historyDir, partName);
      fs.writeFileSync(p, 'x'.repeat(MAX_BYTES));
      written.push(p);
    }

    // Picker MUST not return -99 (it's full). It MUST return a fresh path
    // beyond 99 — accepting the soft cap is breached to preserve the size
    // bound, rather than appending forever to -99 like the pre-fix did.
    const result = monitor.getActiveSessionFilePath(projectPath, tranche, 10 * 1024);
    expect(written).not.toContain(result);
    expect(result).toMatch(/-[0-9]+_[a-z0-9]+\.md$/);
  });
});
