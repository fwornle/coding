// lib/measurement/context-turns-retention.mjs — aged captures are reclaimed by
// mtime: per-task context turns / raw bodies, and the per-run context-breakdown
// snapshots (they carry the same prompt previews; glass G6).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { sweepAgedCaptures } from '../../lib/measurement/context-turns-retention.mjs';

test('aged per-task captures and per-run breakdowns are removed, fresh ones kept', () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'retention-'));
  const measurementsDir = path.join(data, 'measurements');
  const breakdownsDir = path.join(data, 'llm-proxy', 'context-breakdown');
  const write = (file, ageDays) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{}');
    const t = (Date.now() - ageDays * 86_400_000) / 1000;
    fs.utimesSync(file, t, t);
    return file;
  };
  const oldTurns = write(path.join(measurementsDir, 'glass-a', 'context-turns.jsonl'), 9);
  const newTurns = write(path.join(measurementsDir, 'glass-b', 'context-turns.jsonl'), 1);
  const oldBreakdown = write(path.join(breakdownsDir, 'glass-a.json'), 9);
  const newBreakdown = write(path.join(breakdownsDir, 'glass-b.json'), 1);
  const span = write(path.join(measurementsDir, 'glass-a.json'), 9);

  const r = sweepAgedCaptures({ measurementsDir, breakdownsDir, retentionDays: 7, log: () => {} });
  assert.equal(r.removed, 2);
  assert.equal(fs.existsSync(oldTurns), false);
  assert.equal(fs.existsSync(oldBreakdown), false);
  assert.equal(fs.existsSync(newTurns), true);
  assert.equal(fs.existsSync(newBreakdown), true);
  assert.equal(fs.existsSync(span), true, 'the span record (token totals, no prompt text) is not a capture');
  fs.rmSync(data, { recursive: true, force: true });
});
