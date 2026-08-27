/**
 * Tests for the LSL markdown -> pi session backfill.
 *
 * The properties that matter are the ones that make the conversion safe to run
 * over 23k irreplaceable files:
 *   - a chain is converted as ONE unit (parts split mid-token, so per-file
 *     conversion is impossible)
 *   - dry-run touches nothing
 *   - a part that emits nothing is RECORDED as absorbed, never silently lost
 *   - a chain that fails verification leaves its markdown in place
 *
 * Run via: node --test tests/live-logging/backfill-lsl-to-pi.test.mjs
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const REPO = path.resolve(import.meta.dirname, '../..');
const SCRIPT = path.join(REPO, 'scripts', 'backfill-lsl-to-pi.mjs');

let tmp;
let history;

/** A tool block in the ETM's real grammar (heading MUST carry a timestamp). */
const tool = (name, ts, user, out) =>
  `### ${name} - ${ts} UTC [12:00:00 CEST]\n\n`
  + `**User Request:** ${user}\n\n`
  + `**Tool:** ${name}\n**Input:** \`\`\`json\n{"command":"ls"}\n\`\`\`\n\n`
  + `**Result:** ✅ Success\n**Output:** \`\`\`\n${out}\n\`\`\`\n\n---\n\n`;

const setBlock = (id, iso, body) =>
  `<a name="${id}"></a>\n## Prompt Set (${id})\n\n**Time:** ${iso}\n`
  + `**Duration:** 10ms\n**Tool Calls:** 1\n\n${body}`;

const HEADER = '# WORK SESSION (1200-1300)\n\n'
  + '**Generated:** 2026-08-26T12:00:00.000Z\n**Agent:** Claude Code\n\n---\n\n';

function run(args) {
  return execFileSync('node', [SCRIPT, ...args], { encoding: 'utf8', cwd: REPO });
}

/** The history dir is a real git repo in production; the backfill refuses to
 *  delete markdown git cannot restore, so the fixture must be one too. */
function gitInit(dir) {
  const g = (...a) => execFileSync('git', ['-C', dir, ...a], { stdio: 'ignore' });
  g('init', '-q');
  g('config', 'user.email', 'test@example.com');
  g('config', 'user.name', 'test');
  g('commit', '-q', '--allow-empty', '-m', 'init');
}

/** Commit whatever markdown is currently staged-able, so it is recoverable. */
function commitAll(dir) {
  const g = (...a) => execFileSync('git', ['-C', dir, ...a], { stdio: 'ignore' });
  g('add', '-A');
  try { g('commit', '-q', '-m', 'fixture'); } catch { /* nothing to commit */ }
}

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bfill-'));
  history = path.join(tmp, 'proj', '.specstory', 'history', '2026', '08');
  fs.mkdirSync(history, { recursive: true });
  gitInit(path.join(tmp, 'proj', '.specstory', 'history'));
});
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const repoArg = () => ['--repo', path.join(tmp, 'proj')];

describe('backfill', () => {
  it('Test 1 — dry-run writes nothing and removes nothing', () => {
    const md = path.join(history, '2026-08-26_1200-1300-1_abc.md');
    fs.writeFileSync(md, HEADER + setBlock('ps_1', '2026-08-26T12:00:00.000Z',
      tool('Bash', '2026-08-26 12:00:00', 'do it', 'done')));

    commitAll(path.join(tmp, 'proj', '.specstory', 'history'));
    const stdout = run([...repoArg(), '--verify', 'structural']);
    assert.match(stdout, /DRY-RUN/);
    assert.ok(fs.existsSync(md), 'markdown must survive a dry run');
    assert.ok(!fs.existsSync(md.replace(/\.md$/, '.jsonl')), 'no output on a dry run');
  });

  it('Test 2 — --write converts and replaces the markdown', () => {
    commitAll(path.join(tmp, 'proj', '.specstory', 'history'));
    run([...repoArg(), '--verify', 'structural', '--write']);
    const jsonl = path.join(history, '2026-08-26_1200-1300-1_abc.jsonl');
    assert.ok(fs.existsSync(jsonl), 'jsonl written');
    assert.ok(!fs.existsSync(path.join(history, '2026-08-26_1200-1300-1_abc.md')),
      'markdown replaced by default');

    const entries = fs.readFileSync(jsonl, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(entries[0].type, 'session');
    assert.equal(entries[0].version, 3);
    assert.ok(entries.some((e) => e.customType === 'lsl.tranche'));
    assert.ok(entries.some((e) => e.customType === 'lsl.promptSet'));
    const users = entries.filter((e) => e.message?.role === 'user');
    assert.equal(users[0].message.content[0].text, 'do it');
  });

  it('Test 3 — a chain split MID-TOKEN across parts converts as one unit', () => {
    // This is the case that makes per-file conversion impossible: part 1 ends
    // inside the Input JSON fence, part 2 opens with its continuation.
    const whole = HEADER + setBlock('ps_9', '2026-08-26T13:00:00.000Z',
      tool('Bash', '2026-08-26 13:00:00', 'spanning request', 'output here'));
    const cut = whole.indexOf('"command"') + 5;   // mid-token, inside the fence
    fs.writeFileSync(path.join(history, '2026-08-26_1300-1400-1_abc.md'), whole.slice(0, cut));
    fs.writeFileSync(path.join(history, '2026-08-26_1300-1400-2_abc.md'), whole.slice(cut));

    commitAll(path.join(tmp, 'proj', '.specstory', 'history'));
    run([...repoArg(), '--verify', 'structural', '--write']);

    const p1 = path.join(history, '2026-08-26_1300-1400-1_abc.jsonl');
    assert.ok(fs.existsSync(p1), 'the part holding the anchor gets the entries');
    const text = fs.readFileSync(p1, 'utf8');
    assert.match(text, /spanning request/, 'content survives the mid-token split');
    assert.match(text, /output here/, 'the far side of the cut is recovered');
  });

  it('Test 4 — a part that emits nothing is RECORDED as absorbed, not lost', () => {
    const map = JSON.parse(fs.readFileSync(
      path.join(tmp, 'proj', '.specstory', 'history', 'chain-map.json'), 'utf8'));
    const chain = map['2026-08-26_1300-1400_abc'];
    assert.ok(chain, 'chain recorded in the map');
    assert.deepEqual(chain.parts,
      ['2026-08-26_1300-1400-1_abc.md', '2026-08-26_1300-1400-2_abc.md']);

    const accountedFor = chain.emitted.length + chain.absorbed.length;
    assert.equal(accountedFor, chain.parts.length,
      'every source part is either emitted or explicitly absorbed — never merely absent');
    for (const a of chain.absorbed) {
      assert.ok(a.absorbedInto, `${a.md} must name the part that holds its content`);
    }
  });

  it('Test 5 — --keep-md leaves the markdown alongside the conversion', () => {
    const md = path.join(history, '2026-08-26_1500-1600-1_abc.md');
    fs.writeFileSync(md, HEADER + setBlock('ps_5', '2026-08-26T15:00:00.000Z',
      tool('Read', '2026-08-26 15:00:00', 'keep me', 'ok')));
    run([...repoArg(), '--verify', 'structural', '--write', '--keep-md']);
    assert.ok(fs.existsSync(md), 'markdown kept');
    assert.ok(fs.existsSync(md.replace(/\.md$/, '.jsonl')), 'jsonl also written');
  });

  it('Test 5b — untracked markdown is KEPT, never deleted', () => {
    // git cannot restore an untracked file, so the pre-pi-format tag protects
    // nothing for it. km-core's history repo is exactly this case.
    const md = path.join(history, '2026-08-26_1700-1800-1_abc.md');
    fs.writeFileSync(md, HEADER + setBlock('ps_7', '2026-08-26T17:00:00.000Z',
      tool('Bash', '2026-08-26 17:00:00', 'untracked work', 'ok')));
    // deliberately NOT committed
    run([...repoArg(), '--verify', 'structural', '--write']);
    assert.ok(fs.existsSync(md), 'untracked markdown must survive');
    assert.ok(fs.existsSync(md.replace(/\.md$/, '.jsonl')), 'but it is still converted');
  });

  it('Test 6 — re-running is idempotent (same bytes, no duplication)', () => {
    const jsonl = path.join(history, '2026-08-26_1500-1600-1_abc.jsonl');
    const before = fs.readFileSync(jsonl, 'utf8');
    run([...repoArg(), '--verify', 'structural', '--write', '--keep-md']);
    assert.equal(fs.readFileSync(jsonl, 'utf8'), before,
      'deterministic ids make a re-run a no-op');
  });
});
