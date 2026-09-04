/**
 * No file under scripts/ or lib/ may hardcode a real user's checkout path.
 *
 * 31 files did, almost all as the fallback half of
 *
 *   const REPO_ROOT = process.env.CODING_REPO || '/Users/<someone>/Agentic/coding';
 *
 * The override is right and stays. The fallback was the bug: on the machine that wrote it
 * everything works, and anywhere else the script silently resolves to a directory that does
 * not exist — so it reads nothing, writes nowhere, or fails with a path error naming a
 * stranger's home. Nothing on the original machine can observe it, which is why this is a
 * grep test rather than a behavioural one, and why it exists at all: the pattern spreads by
 * copying a neighbouring file.
 *
 * Companion guards, same reasoning, different surface:
 *   tests/integration/launchd-plist-portability.test.js       (plists + their installers)
 *   tests/integration/agent-instructions-portability.test.js  (skills installed globally)
 */

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');

/** An absolute path into somebody's home directory. */
const HOME_PATH = /\/(Users|home)\/([A-Za-z0-9._-]+)\//;

/**
 * Names that are documentation, not a machine.
 *
 * Comments legitimately illustrate the shape of these paths — `decodeEncodedCwd` in
 * lib/lsl/adapters/claude-jsonl-tree.mjs cannot explain itself without showing one. The
 * guard has to separate "an example" from "a real account", so placeholder names and
 * anything in angle brackets are allowed and every other name is not.
 */
const PLACEHOLDERS = new Set(['you', 'me', 'x', 'user', 'username', 'someone', 'staff-id']);

function offendingLines(file) {
  return fs.readFileSync(file, 'utf8').split('\n')
    .map((line, i) => [i + 1, line])
    .filter(([, line]) => {
      const m = HOME_PATH.exec(line);
      if (!m) return false;
      if (PLACEHOLDERS.has(m[2])) return false;
      if (/\/(Users|home)\/(<|\.\.\.)/.test(line)) return false;   // <staff-id>, /Users/.../
      return true;
    })
    .map(([n, line]) => `${path.relative(REPO, file)}:${n}: ${line.trim()}`);
}

/**
 * Tracked files only, and never into lib/km-core — it is a git submodule, so its contents
 * belong to another repository and cannot be fixed by a commit here. `git ls-files` also
 * keeps node_modules and build output out without needing an ignore list.
 */
function trackedFiles() {
  const r = spawnSync('git', ['ls-files', 'scripts', 'lib'], { cwd: REPO, encoding: 'utf8' });
  return r.stdout.split('\n')
    .filter(Boolean)
    .filter((f) => !f.startsWith('lib/km-core/'))
    .map((f) => path.join(REPO, f))
    .filter((f) => fs.existsSync(f) && fs.statSync(f).isFile());
}

describe('scripts/ and lib/ carry no hardcoded checkout path', () => {
  test('no tracked file names a real home directory', () => {
    const hits = trackedFiles().flatMap(offendingLines);
    // Asserted as a joined string so a failure prints the file, line number and the line
    // itself — "somewhere under scripts/" would not be actionable across 400+ files.
    expect(hits.join('\n')).toBe('');
  });

  test('the guard actually fires — it is not vacuously passing', () => {
    // A grep test that matches nothing looks identical to a grep test that is broken.
    const tmp = path.join(REPO, '.git', `portability-probe-${process.pid}.js`);
    fs.writeFileSync(tmp, "const R = process.env.CODING_REPO || '/Users/somebody/Agentic/coding';\n");
    try {
      expect(offendingLines(tmp)).toHaveLength(1);
      expect(offendingLines(tmp)[0]).toContain('/Users/somebody/');
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  });

  test('placeholders in documentation are allowed', () => {
    const tmp = path.join(REPO, '.git', `portability-doc-${process.pid}.js`);
    fs.writeFileSync(tmp, [
      "// '/Users/you/Agentic/coding' -> '-Users-you-Agentic-coding'",
      '// paths like /Users/<staff-id>/… leak the operator id',
      '// the live repo (/Users/.../coding/.data) is absent in the container',
    ].join('\n'));
    try {
      expect(offendingLines(tmp)).toEqual([]);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  });
});

describe('the repo-root derivation resolves to the repo, at every depth used', () => {
  // The refactor is only safe if the derivation reproduces the path it replaced. Depth
  // varies with where a file sits, and an off-by-one lands on the PARENT of the repo —
  // which exists, so nothing throws; scripts just quietly read and write the wrong tree.
  test.each([
    ['scripts/x.mjs', 1],
    ['lib/experiments/x.mjs', 2],
    ['lib/repro/x.mjs', 2],
    ['lib/lsl/token/x.mjs', 3],
    ['lib/lsl/adapters/x.mjs', 3],
    ['lib/repro/fixtures/x.mjs', 3],
  ])('%s resolves up %i level(s) to the repo root', (rel, depth) => {
    const dir = path.dirname(path.join(REPO, rel));
    expect(path.resolve(dir, ...Array(depth).fill('..'))).toBe(REPO);
  });
});

describe('encodeCwd is the inverse of the decoder it sits beside', () => {
  test('round-trips a checkout path through the Claude projects slug', async () => {
    const { encodeCwd } = await import(path.join(REPO, 'lib/lsl/adapters/claude-jsonl-tree.mjs'));
    expect(encodeCwd('/Users/you/Agentic/coding')).toBe('-Users-you-Agentic-coding');
    // A trailing slash must not produce a trailing dash — that would name a directory
    // Claude Code never creates, and the miss would look like "no transcripts".
    expect(encodeCwd('/Users/you/Agentic/coding/')).toBe('-Users-you-Agentic-coding');
  });

  test('it is NOT pi\'s encoding, which wraps in a trailing --', async () => {
    const { encodeCwd } = await import(path.join(REPO, 'lib/lsl/adapters/claude-jsonl-tree.mjs'));
    expect(encodeCwd('/a/b')).not.toMatch(/--$/);
  });
});
