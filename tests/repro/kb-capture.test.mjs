// tests/repro/kb-capture.test.mjs
//
// Phase 67, Plan 67-04 (Wave 2) — REPRO-01 internal-state capture. Golden suite for
// lib/repro/kb-capture.mjs (D-02 KB capture): filesystem-copy-only capture of the live
// leveldb/ dir + atomic exports/general.json — NEVER a second GraphKMStore on the live
// single-owner DB (Pitfall 5). Uses a SYNTHETIC temp dataDir (no real KB) so the suite
// runs with km-core absent — which itself proves capture opens no store.
//
// Convention: node:test + node:assert/strict (established tests/repro/ pattern — NOT
// jest globals). Builds a throwaway dataDir under mkdtempSync and cleans up. Output via
// process.stderr.write only (no console.* — no-console-log, CLAUDE.md).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { captureKb } from '../../lib/repro/kb-capture.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KB_CAPTURE_SRC = path.resolve(__dirname, '../../lib/repro/kb-capture.mjs');

/** Build a synthetic <dataDir>/knowledge-graph/{leveldb,exports} with known bytes. */
function seedFakeKb(dataDir) {
  const kgDir = path.join(dataDir, 'knowledge-graph');
  const levelDir = path.join(kgDir, 'leveldb');
  const exportsDir = path.join(kgDir, 'exports');
  fs.mkdirSync(levelDir, { recursive: true });
  fs.mkdirSync(exportsDir, { recursive: true });
  // Fake leveldb contents (binary-ish bytes to prove byte-exact copy).
  fs.writeFileSync(path.join(levelDir, 'CURRENT'), 'MANIFEST-000042\n');
  fs.writeFileSync(path.join(levelDir, '000042.ldb'), Buffer.from([0, 1, 2, 3, 255, 254, 10, 0, 42]));
  const generalJson = JSON.stringify({ nodes: [{ id: 'n1' }], edges: [] });
  fs.writeFileSync(path.join(exportsDir, 'general.json'), generalJson);
  return { levelDir, exportsDir, generalJson };
}

describe('captureKb', () => {
  let dataDir;
  let destDir;
  let seeded;

  before(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'repro-kb-src-'));
    destDir = fs.mkdtempSync(path.join(os.tmpdir(), 'repro-kb-dst-'));
    seeded = seedFakeKb(dataDir);
  });

  after(() => {
    for (const d of [dataDir, destDir]) {
      try {
        fs.rmSync(d, { recursive: true, force: true });
      } catch {
        /* best-effort cleanup */
      }
    }
  });

  test('returns the documented status shape with a caveat', () => {
    const res = captureKb(dataDir, destDir);
    assert.equal(typeof res, 'object');
    assert.equal(res.levelDbCaptured, true);
    assert.equal(res.exportCaptured, true);
    assert.equal(typeof res.caveat, 'string');
    assert.ok(res.caveat.length > 0, 'caveat must be a non-empty human-readable string');
  });

  test('copies the leveldb dir byte-exact', () => {
    captureKb(dataDir, destDir);
    const srcCurrent = fs.readFileSync(path.join(seeded.levelDir, 'CURRENT'));
    const dstCurrent = fs.readFileSync(path.join(destDir, 'kb', 'leveldb', 'CURRENT'));
    assert.ok(srcCurrent.equals(dstCurrent), 'CURRENT bytes identical');
    const srcLdb = fs.readFileSync(path.join(seeded.levelDir, '000042.ldb'));
    const dstLdb = fs.readFileSync(path.join(destDir, 'kb', 'leveldb', '000042.ldb'));
    assert.ok(srcLdb.equals(dstLdb), 'binary .ldb bytes identical');
  });

  test('copies exports/general.json byte-exact', () => {
    captureKb(dataDir, destDir);
    const src = fs.readFileSync(path.join(seeded.exportsDir, 'general.json'));
    const dst = fs.readFileSync(path.join(destDir, 'kb', 'exports', 'general.json'));
    assert.ok(src.equals(dst), 'general.json bytes identical');
  });

  test('capture opens NO GraphKMStore on the live dir (Pitfall 5)', () => {
    // Structural guard mirroring the plan acceptance grep: the captureKb region must
    // not reference GraphKMStore. Strip comment lines first, then scan the function.
    const src = fs.readFileSync(KB_CAPTURE_SRC, 'utf8');
    // Strip both line comments (//) and JSDoc block-comment lines (/** … * … */) so the
    // scan inspects executable code only — hydrateSandbox's doc block legitimately names
    // GraphKMStore and must not be mistaken for a store opened during capture.
    const nonComment = src
      .split('\n')
      .filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l))
      .join('\n');
    const start = nonComment.indexOf('function captureKb');
    assert.ok(start >= 0, 'captureKb function found');
    // hydrateSandbox is the only place a store may be opened; find where captureKb ends.
    const afterStart = nonComment.slice(start);
    const nextFn = afterStart.indexOf('function hydrateSandbox');
    const captureBody = nextFn >= 0 ? afterStart.slice(0, nextFn) : afterStart;
    assert.ok(
      !/GraphKMStore/.test(captureBody),
      'captureKb body must not construct a GraphKMStore',
    );
  });

  test('module loads and captures WITHOUT km-core installed (no top-level store import)', () => {
    // The mere fact this test ran (import at top succeeded) proves kb-capture.mjs has no
    // static km-core dependency — capture is filesystem-only. Re-run to be explicit.
    assert.doesNotThrow(() => captureKb(dataDir, destDir));
  });

  test('TRUE-NEGATIVE: missing artifacts degrade to false flags, never throw', () => {
    const emptyData = fs.mkdtempSync(path.join(os.tmpdir(), 'repro-kb-empty-'));
    const emptyDest = fs.mkdtempSync(path.join(os.tmpdir(), 'repro-kb-empty-dst-'));
    try {
      let res;
      assert.doesNotThrow(() => {
        res = captureKb(emptyData, emptyDest);
      });
      assert.equal(res.levelDbCaptured, false);
      assert.equal(res.exportCaptured, false);
      assert.equal(typeof res.caveat, 'string');
    } finally {
      fs.rmSync(emptyData, { recursive: true, force: true });
      fs.rmSync(emptyDest, { recursive: true, force: true });
    }
  });
});
