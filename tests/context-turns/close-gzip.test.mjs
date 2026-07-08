// tests/context-turns/close-gzip.test.mjs
//
// Behavior (RESEARCH Test Map): gzip-at-close produces a `.gz` and removes the
// plaintext; a crash mid-run leaves a readable `.jsonl`.
//
// Implemented in 84-05. Drives the real span-close routine
// (closeContextTurns) from scripts/measurement-stop.mjs against a temp
// measurements dir — no live obs-api (observations injected as [] so the gzip
// round-trip is offline/deterministic).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { mkTmpMeasurementsDir, readJsonl } from './_helpers.mjs';
import { closeContextTurns } from '../../scripts/measurement-stop.mjs';

test('gzip-at-close: .gz round-trips lines, plaintext removed, raw-bodies gzipped', () => {
  const tmp = mkTmpMeasurementsDir();
  try {
    const dir = tmp.withTaskId('task-close');
    fs.mkdirSync(dir, { recursive: true });

    const lines = [
      { ts: '2026-07-07T10:06:00.000Z', agent: 'claude', wire: 'anthropic', observation_ref: null },
      { ts: '2026-07-07T10:15:00.000Z', agent: 'claude', wire: 'anthropic', observation_ref: null },
      { ts: '2026-07-07T10:45:00.000Z', agent: 'claude', wire: 'anthropic', observation_ref: null },
    ];
    fs.writeFileSync(
      path.join(dir, 'context-turns.jsonl'),
      lines.map((l) => JSON.stringify(l)).join('\n') + '\n',
    );
    fs.writeFileSync(path.join(dir, 'raw-bodies.jsonl'), '{"raw":1}\n{"raw":2}\n');

    closeContextTurns(dir, {
      from: '2026-07-07T10:00:00.000Z',
      to: '2026-07-07T11:00:00.000Z',
      agent: 'claude',
      observations: [], // offline: no correlation — proves the gzip/unlink lifecycle
    });

    const gzPath = path.join(dir, 'context-turns.jsonl.gz');
    assert.ok(fs.existsSync(gzPath), 'context-turns.jsonl.gz exists');
    assert.ok(
      !fs.existsSync(path.join(dir, 'context-turns.jsonl')),
      'plaintext context-turns.jsonl removed after gzip',
    );

    const roundTripped = zlib.gunzipSync(fs.readFileSync(gzPath)).toString('utf8')
      .split('\n')
      .filter((l) => l.trim().length > 0);
    assert.equal(roundTripped.length, lines.length, 'gunzip round-trips the original line count');
    assert.equal(JSON.parse(roundTripped[0]).ts, lines[0].ts, 'first line survives the round-trip');

    const rbGz = path.join(dir, 'raw-bodies.jsonl.gz');
    assert.ok(fs.existsSync(rbGz), 'raw-bodies.jsonl.gz exists');
    assert.ok(
      !fs.existsSync(path.join(dir, 'raw-bodies.jsonl')),
      'plaintext raw-bodies.jsonl removed after gzip',
    );
  } finally {
    tmp.cleanup();
  }
});

test('crash mid-run (no close ran) leaves a readable plaintext .jsonl', () => {
  const tmp = mkTmpMeasurementsDir();
  try {
    const dir = tmp.withTaskId('task-crash');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'context-turns.jsonl'),
      JSON.stringify({ ts: '2026-07-07T10:06:00.000Z', agent: 'claude', observation_ref: null }) + '\n',
    );
    // Simulate a crash BEFORE span close: closeContextTurns never runs.
    const rows = readJsonl(path.join(dir, 'context-turns.jsonl'));
    assert.equal(rows.length, 1, 'the uncompressed plaintext is still readable for the sweeper');
    assert.ok(
      !fs.existsSync(path.join(dir, 'context-turns.jsonl.gz')),
      'no .gz produced when the span never closed',
    );
  } finally {
    tmp.cleanup();
  }
});

test('missing context-turns file is normal — closeContextTurns never throws', () => {
  const tmp = mkTmpMeasurementsDir();
  try {
    const dir = tmp.withTaskId('task-empty');
    fs.mkdirSync(dir, { recursive: true });
    assert.doesNotThrow(() => closeContextTurns(dir, {
      from: '2026-07-07T10:00:00.000Z',
      to: '2026-07-07T11:00:00.000Z',
      agent: 'claude',
      observations: [],
    }));
    assert.ok(!fs.existsSync(path.join(dir, 'context-turns.jsonl.gz')), 'no .gz when nothing to compress');
  } finally {
    tmp.cleanup();
  }
});
