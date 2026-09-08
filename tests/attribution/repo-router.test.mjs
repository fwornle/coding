/**
 * repo-router — deciding a project from evidence rather than from the shell.
 *
 * The behaviour worth locking is the ABSTENTION. It would be easy to make this
 * module always return an answer, and that is precisely what makes a
 * misattribution invisible: a confident wrong team looks exactly like a right
 * one. Every ambiguous case below must return null.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { realpathSync } from 'node:fs';

import {
  repoRootForPath,
  teamForPath,
  routeFromArtifacts,
  buildDistinctiveIndex,
  routeFromCitations,
  namesTeam,
  _clearCache,
} from '../../lib/attribution/repo-router.mjs';

/** Two sibling repos, one of them with a nested worktree-style gitlink. */
function fixture() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'attr-')));
  for (const name of ['coding', 'a2a-xpr']) {
    mkdirSync(join(base, name, '.git'), { recursive: true });
    mkdirSync(join(base, name, 'scripts'), { recursive: true });
    writeFileSync(join(base, name, 'scripts', 'x.mjs'), '');
  }
  // A worktree gitlink: `.git` is a FILE, not a directory.
  mkdirSync(join(base, 'wt'), { recursive: true });
  writeFileSync(join(base, 'wt', '.git'), 'gitdir: /somewhere/else\n');
  return base;
}

describe('repoRootForPath', () => {
  test('walks up to the nearest .git directory', () => {
    const base = fixture();
    try {
      _clearCache();
      assert.equal(repoRootForPath(join(base, 'coding', 'scripts', 'x.mjs')), join(base, 'coding'));
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  test('accepts a .git FILE — kgbench sandboxes runs in git worktrees', () => {
    const base = fixture();
    try {
      _clearCache();
      assert.equal(repoRootForPath(join(base, 'wt', 'deep', 'file.mjs')), join(base, 'wt'));
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  test('returns null outside any repository', () => {
    const base = fixture();
    try {
      _clearCache();
      assert.equal(repoRootForPath(join(base, 'loose.txt')), null);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  test('rejects a relative path rather than resolving it against cwd', () => {
    // Resolving relative to cwd would reintroduce exactly the bug this module
    // exists to fix.
    _clearCache();
    assert.equal(repoRootForPath('scripts/x.mjs'), null);
    assert.equal(repoRootForPath(''), null);
    assert.equal(repoRootForPath(null), null);
  });
});

describe('teamForPath', () => {
  test('is the repo directory name — same vocabulary the ETM derives from cwd', () => {
    const base = fixture();
    try {
      _clearCache();
      assert.equal(teamForPath(join(base, 'a2a-xpr', 'scripts', 'x.mjs')), 'a2a-xpr');
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});

describe('routeFromArtifacts', () => {
  test('decides when every artifact is in one repo', () => {
    const base = fixture();
    try {
      _clearCache();
      const r = routeFromArtifacts([
        join(base, 'coding', 'scripts', 'x.mjs'),
        join(base, 'coding', 'scripts', 'x.mjs'),
      ]);
      assert.equal(r.team, 'coding');
      assert.equal(r.evidence.length, 2);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  test('ABSTAINS when artifacts span two repos', () => {
    // A session that touched both has genuinely ambiguous provenance. Taking
    // the majority would quietly re-file work that legitimately spans both.
    const base = fixture();
    try {
      _clearCache();
      assert.equal(
        routeFromArtifacts([
          join(base, 'coding', 'scripts', 'x.mjs'),
          join(base, 'a2a-xpr', 'scripts', 'x.mjs'),
        ]),
        null,
      );
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  test('abstains on an empty or non-array input', () => {
    _clearCache();
    assert.equal(routeFromArtifacts([]), null);
    assert.equal(routeFromArtifacts(null), null);
    assert.equal(routeFromArtifacts('a/b.mjs'), null);
  });

  test('paths outside any repo are ignored, not counted as a team', () => {
    const base = fixture();
    try {
      _clearCache();
      const r = routeFromArtifacts([
        join(base, 'coding', 'scripts', 'x.mjs'),
        join(base, 'loose.txt'),
      ]);
      assert.equal(r.team, 'coding');
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});

describe('buildDistinctiveIndex', () => {
  test('omits basenames that more than one repo owns', () => {
    // README.md / mkdocs.yml / install.sh / CLAUDE.md are the real-world
    // offenders — 12 basenames are shared between coding and a2a-xpr.
    const idx = buildDistinctiveIndex({
      coding: ['README.md', 'scripts/health-coordinator.js', 'mkdocs.yml'],
      'a2a-xpr': ['README.md', 'docs/nl-realm.md', 'mkdocs.yml'],
    });
    assert.equal(idx.get('health-coordinator.js'), 'coding');
    assert.equal(idx.get('nl-realm.md'), 'a2a-xpr');
    assert.equal(idx.has('README.md'), false, 'shared basename must not be indexed');
    assert.equal(idx.has('mkdocs.yml'), false);
  });
});

describe('routeFromCitations', () => {
  const idx = buildDistinctiveIndex({
    coding: ['scripts/copilot-events-tail.mjs', 'scripts/health-coordinator.js', 'README.md'],
    'a2a-xpr': ['docs/nl-realm.md', 'README.md'],
  });

  test('decides from a distinctive backticked filename', () => {
    const r = routeFromCitations('`copilot-events-tail.mjs` tails an events file.', idx);
    assert.equal(r.team, 'coding');
    assert.deepEqual(r.evidence, ['copilot-events-tail.mjs']);
  });

  test('a shared basename decides nothing', () => {
    assert.equal(routeFromCitations('see `README.md` for setup', idx), null);
  });

  test('ABSTAINS when the text cites files unique to two repos', () => {
    assert.equal(
      routeFromCitations('`health-coordinator.js` and `nl-realm.md` both changed', idx),
      null,
    );
  });

  test('matches a path, keyed on its basename', () => {
    const r = routeFromCitations('edited `scripts/copilot-events-tail.mjs` today', idx);
    assert.equal(r.team, 'coding');
  });

  test('un-backticked filenames are ignored', () => {
    // Prose mentioning a name in passing is far weaker evidence than a citation
    // the writer chose to mark up as code.
    assert.equal(routeFromCitations('we changed copilot-events-tail.mjs', idx), null);
  });

  test('dedupes repeated evidence', () => {
    const r = routeFromCitations('`copilot-events-tail.mjs` … `copilot-events-tail.mjs`', idx);
    assert.deepEqual(r.evidence, ['copilot-events-tail.mjs']);
  });

  test('abstains on empty input', () => {
    assert.equal(routeFromCitations('', idx), null);
    assert.equal(routeFromCitations(null, idx), null);
  });
});

describe('routeFromCitations — precision guards', () => {
  const idx = buildDistinctiveIndex({
    coding: ['install.sh', 'scripts/copilot-events-tail.mjs', 'docs/index.md'],
    'a2a-xpr': ['docs/nl-realm.md'],
  });

  test('a generic basename decides nothing even when it IS unique', () => {
    // install.sh is tracked only by coding, and on that basis alone the first
    // run of this repair re-filed an insight titled "Documentation Style Guide
    // (a2a-xpr)" to coding. Uniqueness in the index is not evidence about the
    // subject.
    assert.equal(routeFromCitations('run `install.sh` to set up', idx), null);
    assert.equal(routeFromCitations('see `index.md`', idx), null);
  });

  test('a title that names its own team outranks an incidental citation', () => {
    const text = 'Documentation Style Guide (a2a-xpr)\nuses `copilot-events-tail.mjs` as an example';
    assert.equal(routeFromCitations(text, idx, { assertsTeam: 'a2a-xpr' }), null);
    // …and without that assertion the citation still decides.
    assert.equal(routeFromCitations(text, idx).team, 'coding');
  });

  test('the guard only fires for the team actually named', () => {
    const text = 'Statusline PNG Gauge Rendering\n`copilot-events-tail.mjs`';
    assert.equal(routeFromCitations(text, idx, { assertsTeam: 'a2a-xpr' }).team, 'coding');
  });
});

describe('namesTeam', () => {
  test('is word-bounded so a2a does not match inside a2a-xpr', () => {
    // Otherwise every a2a-xpr title would read as an a2a one.
    assert.equal(namesTeam('a2a-xpr PoC Documentation', 'a2a'), false);
    assert.equal(namesTeam('a2a-xpr PoC Documentation', 'a2a-xpr'), true);
  });

  test('is case-insensitive and ignores punctuation around the name', () => {
    assert.equal(namesTeam('Style Guide (A2A-XPR)', 'a2a-xpr'), true);
    assert.equal(namesTeam('nothing here', 'coding'), false);
  });

  test('is safe on empty input', () => {
    assert.equal(namesTeam('', 'coding'), false);
    assert.equal(namesTeam('text', ''), false);
    assert.equal(namesTeam(null, 'coding'), false);
  });
});

describe('routeFromCitations — evidence must be specific', () => {
  const idx = buildDistinctiveIndex({
    coding: [
      'src/models.ts', 'docs/REQUIREMENTS.md', 'a/REQUIREMENTS.md',
      'scripts/copilot-events-tail.mjs', 'src/team.json', 'src/cost.ts',
    ],
    'a2a-xpr': ['docs/nl-realm.md'],
  });

  test('one ordinary filename cannot decide alone', () => {
    // `models.ts` is unique only because the sibling repos are small, and on
    // that basis it re-filed an insight about a fire-safety training agent to
    // the coding project.
    assert.equal(routeFromCitations('the `models.ts` shape', idx), null);
    assert.equal(routeFromCitations('see `team.json`', idx), null);
  });

  test('one compound filename is enough — someone had to invent that name', () => {
    assert.equal(routeFromCitations('`copilot-events-tail.mjs` races', idx).team, 'coding');
  });

  test('two ordinary filenames agreeing is enough', () => {
    const r = routeFromCitations('`models.ts` and `cost.ts` moved', idx)
    assert.equal(r.team, 'coding');
  });

  test('the same basename twice is ONE piece of evidence, not two', () => {
    // `REQUIREMENTS.md` and `docs/REQUIREMENTS.md` are two citation strings and
    // one filename; counting strings let a single weak name clear the bar.
    assert.equal(
      routeFromCitations('`REQUIREMENTS.md` and `docs/REQUIREMENTS.md`', idx),
      null,
    );
  });
});
