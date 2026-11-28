/**
 * Release build (scripts/release/build-tarball.mjs, scripts/release/notes.mjs),
 * against a throwaway fixture repo with one submodule, so the suite needs no
 * network and none of coding's own submodules checked out.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildTarball, pinnedSubmodules, EXCLUDE } from '../../scripts/release/build-tarball.mjs';
import { parseCommits, renderNotes, previousRelease, buildNotes } from '../../scripts/release/notes.mjs';

let tmp;
let repo;
let subSha;

const git = (cwd, ...args) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'protocol.file.allow=always', ...args], {
    cwd,
    encoding: 'utf8',
  }).trim();
const write = (p, s) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, s);
};

before(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coding-relbuild-')));
  const sub = path.join(tmp, 'sub');
  fs.mkdirSync(sub);
  git(sub, 'init', '-q', '-b', 'main');
  write(path.join(sub, 'package.json'), '{"name":"sub"}');
  git(sub, 'add', '.');
  git(sub, 'commit', '-q', '-m', 'feat: sub');
  subSha = git(sub, 'rev-parse', 'HEAD');

  repo = path.join(tmp, 'repo');
  fs.mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'main');
  write(path.join(repo, 'package.json'), '{"version":"8.0.0"}');
  write(path.join(repo, 'bin', 'coding'), '#!/bin/sh\n');
  write(path.join(repo, '.planning', 'plan.md'), 'dev only');
  write(path.join(repo, 'tests', 'x.test.mjs'), '');
  write(path.join(repo, 'docs', 'images', 'big.png'), 'png');
  write(path.join(repo, 'docs', 'guide.md'), 'kept');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'chore: initial');
  git(repo, 'tag', 'v7.6');
  git(repo, 'submodule', 'add', '-q', sub, 'lib/sub');
  git(repo, 'commit', '-q', '-m', 'feat(lib): add sub');
  write(path.join(repo, 'untracked.txt'), 'must not ship');
  // After the submodule's pin: the release must carry the PINNED commit, not this.
  write(path.join(sub, 'later.txt'), 'later');
  git(sub, 'add', '.');
  git(sub, 'commit', '-q', '-m', 'fix: later');
  git(path.join(repo, 'lib', 'sub'), 'pull', '-q', 'origin', 'main');
});
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('build-tarball', () => {
  test('tracked files minus the exclusions, submodule vendored at its pin, release.json last', () => {
    const out = path.join(tmp, 'dist');
    const r = buildTarball({ repo, out });
    assert.equal(path.basename(r.tarball), 'coding-8.0.0.tar.gz');

    const u = path.join(tmp, 'u');
    fs.mkdirSync(u);
    execFileSync('tar', ['-xzf', r.tarball, '-C', u]);
    const root = path.join(u, 'coding-8.0.0');
    const has = (p) => fs.existsSync(path.join(root, p));

    assert.ok(has('bin/coding') && has('docs/guide.md') && has('package.json'));
    for (const p of ['.planning', 'tests', 'docs/images', 'untracked.txt']) assert.ok(!has(p), `${p} shipped`);
    assert.ok(has('lib/sub/package.json'), 'submodule vendored');
    assert.ok(!has('lib/sub/later.txt'), 'submodule taken at the pinned commit, not its working tree');
    assert.ok(!has('.gitmodules') || !fs.statSync(path.join(root, '.gitmodules')).isDirectory());
    assert.equal(execFileSync('find', [root, '-name', '.git'], { encoding: 'utf8' }).trim(), '', 'no .git shipped');

    const marker = JSON.parse(fs.readFileSync(path.join(root, 'release.json'), 'utf8'));
    assert.equal(marker.version, '8.0.0');
    assert.deepEqual(marker.submodules, { 'lib/sub': subSha });
    assert.equal(marker.commit, git(repo, 'rev-parse', 'HEAD'));

    const sum = fs.readFileSync(`${r.tarball}.sha256`, 'utf8').split(/\s+/)[0];
    assert.equal(sum, createHash('sha256').update(fs.readFileSync(r.tarball)).digest('hex'));
  });

  test('pins come from the gitlinks at HEAD', () => {
    assert.deepEqual(pinnedSubmodules(repo), [{ path: 'lib/sub', sha: subSha }]);
  });

  test('refuses a version that is not x.y.z', () => {
    assert.throws(() => buildTarball({ repo, out: path.join(tmp, 'bad'), version: 'next' }), /not a release version/);
  });

  test('every exclusion says why', () => {
    for (const [p, why] of EXCLUDE) assert.ok(p && why, `${p}: no reason`);
  });
});

describe('release notes', () => {
  test('parses conventional commits, scope and breaking marks; drops the rest', () => {
    const c = parseCommits([
      'a1\x1ffeat(install): release layout\x1f',
      'b2\x1ffix!: drop the old flag\x1f',
      'c3\x1fperf: faster\x1fBREAKING CHANGE: config moved',
      'd4\x1fWIP random\x1f',
    ]);
    assert.deepEqual(
      c.map((x) => [x.type, x.scope, x.breaking]),
      [
        ['feat', 'install', false],
        ['fix', null, true],
        ['perf', null, true],
      ],
    );
  });

  test('wip commits are listed with the features; install names the one-liner', () => {
    const md = renderNotes({
      version: '8.0.2',
      since: 'v8.0.1',
      commits: [{ sha: 'b1', type: 'wip', scope: 'bootstrap', subject: 'coding-install.sh', breaking: false }],
    });
    assert.match(md, /### Features\n\n- \*\*bootstrap:\*\* coding-install\.sh \(b1\)/);
    assert.match(md, /releases\/latest\/download\/coding-install\.sh \| bash/);
    assert.match(md, /coding update --rollback/);
  });

  test('render: sections, breaking first, long lists capped', () => {
    const commits = [
      { sha: 'a', type: 'feat', scope: 'x', subject: 'one', breaking: true },
      ...Array.from({ length: 70 }, (_, i) => ({ sha: `f${i}`, type: 'fix', scope: null, subject: `fix ${i}`, breaking: false })),
    ];
    const md = renderNotes({ version: '8.0.0', since: 'v7.6', sinceIsMilestone: true, commits });
    assert.match(md, /First release of the 8\.x line\. Changes since the v7\.6 milestone\./);
    assert.ok(md.indexOf('### Breaking changes') < md.indexOf('### Features'));
    assert.match(md, /…and 10 more/);
    assert.match(md, /ghcr\.io\/fwornle\/coding-services:8\.0\.0/);
  });

  test('previous release ignores milestone tags below the line, and the version itself', () => {
    assert.equal(previousRelease(repo, '8.0.0'), null);
    git(repo, 'tag', 'v8.0.0');
    git(repo, 'tag', 'v8.1.0');
    assert.equal(previousRelease(repo, '8.1.0'), 'v8.0.0');
    assert.equal(previousRelease(repo, '8.2.0'), 'v8.1.0');
    git(repo, 'tag', '-d', 'v8.0.0', 'v8.1.0');
  });

  test('first release counts from the last milestone tag', () => {
    const md = buildNotes({ repo, version: '8.0.0' });
    assert.match(md, /since the v7\.6 milestone/);
    assert.match(md, /\*\*lib:\*\* add sub/);
    assert.doesNotMatch(md, /initial/);
  });

  test('re-run on the own tagged commit of the release still counts from the milestone', () => {
    git(repo, 'tag', 'v8.0.0');
    try {
      assert.match(buildNotes({ repo, version: '8.0.0' }), /since the v7\.6 milestone/);
    } finally {
      git(repo, 'tag', '-d', 'v8.0.0');
    }
  });
});
