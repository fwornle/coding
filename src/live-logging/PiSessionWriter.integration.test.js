/**
 * Integration tests for the pi-format LSL write path.
 *
 * Exercises the exact call sequence the ETM flush loop uses (tranche header ->
 * prompt-set subtree -> append; removePromptSet -> re-append) against a real
 * file on disk, and hands the result to the real `pi --export` binary.
 *
 * `pi --export` is the acceptance oracle that matters: it is what the dashboard
 * Sessions tab will render, and it is the only check that our entries are
 * actually valid pi session v3 and not merely plausible JSON.
 *
 * Skips the export assertions when `pi` is not on PATH so CI without pi still
 * runs the structural half.
 *
 * Run via: node --test src/live-logging/PiSessionWriter.integration.test.js
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

import {
  sessionHeader, buildTrancheEntries, buildPromptSetEntries,
  removePromptSet, serialize, entryId, makeIdGen, uuidFrom,
} from './PiSessionWriter.js';

const HAS_PI = spawnSync('which', ['pi']).status === 0;
let tmp;

before(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lsl-pi-')); });
after(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

/** Mirror of EnhancedTranscriptMonitor.trancheSpineId(). */
const spineIdFor = (base) => entryId(`${base}:spine`);

/** Mirror of the ETM's header write. */
function writeHeader(file, { timeWindow = '1100-1200', parentSession = null } = {}) {
  const base = path.basename(file);
  const iso = '2026-08-26T11:00:00.000Z';
  const header = sessionHeader({ id: uuidFrom(base), timestamp: iso, cwd: '/repo', ...(parentSession ? { parentSession } : {}) });
  const infoId = entryId(`${base}:info`);
  const spineId = spineIdFor(base);
  let i = 0;
  const gen = () => (i++ === 0 ? infoId : spineId);
  const { entries } = buildTrancheEntries({ timeWindow, agent: 'Claude' }, gen, iso);
  fs.writeFileSync(file, serialize([header, ...entries]));
  return spineId;
}

/** Mirror of the ETM's per-slice append. */
function appendSet(file, promptSetId, blocks) {
  const base = path.basename(file);
  const entries = buildPromptSetEntries({
    promptSetId, blocks, spineId: spineIdFor(base),
    idGen: makeIdGen(`${base}:${promptSetId}`),
    fallbackIso: '2026-08-26T11:00:00.000Z',
    meta: { time: '2026-08-26T11:00:00.000Z', agent: 'Claude' },
  });
  fs.appendFileSync(file, serialize(entries));
}

const BLOCKS_A = [
  { kind: 'tool', userText: 'list the repo', toolName: 'Bash',
    input: { command: 'ls -la' }, output: 'total 0\ndrwxr-xr-x', isError: false },
];
const BLOCKS_B = [
  { kind: 'text', userText: 'and summarise', assistantText: 'Here is the summary.' },
];

describe('pi-format LSL write path', () => {
  it('Test 1 — writes a valid pi session that `pi --export` accepts', { skip: !HAS_PI && 'pi not on PATH' }, () => {
    const f = path.join(tmp, '2026-08-26_1100-1200-1_c197ef.jsonl');
    writeHeader(f);
    appendSet(f, 'ps_1', BLOCKS_A);
    appendSet(f, 'ps_2', BLOCKS_B);

    const out = path.join(tmp, 'export.html');
    execFileSync('pi', ['--export', f, out], { stdio: 'ignore' });
    const html = fs.readFileSync(out, 'utf8');

    // Content is embedded base64 under <script id="session-data">.
    const m = html.match(/<script id="session-data" type="application\/json">([^<]*)</);
    assert.ok(m, 'export must embed session data');
    const data = JSON.parse(Buffer.from(m[1], 'base64').toString());
    assert.equal(data.header.version, 3);
    const texts = JSON.stringify(data.entries);
    assert.match(texts, /list the repo/);
    assert.match(texts, /Here is the summary\./);
    assert.match(texts, /lsl\.promptSet/, 'custom metadata round-trips verbatim');
  });

  it('Test 2 — remove + re-append is byte-identical (idempotent re-flush)', () => {
    const f = path.join(tmp, 'idem.jsonl');
    writeHeader(f);
    appendSet(f, 'ps_1', BLOCKS_A);
    appendSet(f, 'ps_2', BLOCKS_B);
    const before = fs.readFileSync(f, 'utf8');

    // What the ETM does on a re-flush of ps_2: scrub then rewrite.
    const { text, removed } = removePromptSet(before, 'ps_2');
    assert.ok(removed > 0);
    fs.writeFileSync(f, text);
    appendSet(f, 'ps_2', BLOCKS_B);

    assert.equal(fs.readFileSync(f, 'utf8'), before,
      'deterministic per-set id seeds must make a re-flush a true no-op');
  });

  it('Test 3 — removing one set leaves the other and the spine intact', () => {
    const f = path.join(tmp, 'partial.jsonl');
    writeHeader(f);
    appendSet(f, 'ps_1', BLOCKS_A);
    appendSet(f, 'ps_2', BLOCKS_B);

    const { text } = removePromptSet(fs.readFileSync(f, 'utf8'), 'ps_1');
    assert.ok(!text.includes('list the repo'), 'ps_1 gone');
    assert.ok(text.includes('Here is the summary.'), 'ps_2 survives');
    assert.ok(text.includes('lsl.tranche'), 'spine survives');
    assert.ok(text.includes('"type":"session"'), 'file header survives');

    const entries = text.trim().split('\n').map((l) => JSON.parse(l));
    const spine = entries.find((e) => e.customType === 'lsl.tranche');
    const sets = entries.filter((e) => e.customType === 'lsl.promptSet');
    assert.equal(sets.length, 1);
    assert.equal(sets[0].parentId, spine.id, 'survivor still hangs off the spine');
  });

  it('Test 4 — a rotated part chains to its predecessor via parentSession', () => {
    const p1 = path.join(tmp, '2026-08-26_1300-1400-1_c197ef.jsonl');
    const p2 = path.join(tmp, '2026-08-26_1300-1400-2_c197ef.jsonl');
    writeHeader(p1);
    writeHeader(p2, { parentSession: path.basename(p1) });
    const head = JSON.parse(fs.readFileSync(p2, 'utf8').split('\n')[0]);
    assert.equal(head.parentSession, path.basename(p1),
      'markdown could not express this at all — a -N_ part was an orphan fragment');
  });

  it('Test 5 — every emitted line is independently parseable JSON', () => {
    const f = path.join(tmp, 'lines.jsonl');
    writeHeader(f);
    appendSet(f, 'ps_1', [{ kind: 'tool', userText: 'x', toolName: 'Bash',
      // content that would have broken a markdown fence
      input: { command: 'echo "```"' }, output: '```\nnot a fence\n```', isError: false }]);
    const lines = fs.readFileSync(f, 'utf8').trim().split('\n');
    for (const l of lines) assert.doesNotThrow(() => JSON.parse(l));
    const entries = lines.map((l) => JSON.parse(l));
    const res = entries.find((e) => e.message?.role === 'toolResult');
    assert.match(res.message.content[0].text, /not a fence/,
      'JSON escaping removes the fence-break hazard the 500-char markdown cap worked around');
  });
});
