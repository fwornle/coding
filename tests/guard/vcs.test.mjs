/**
 * git push/fetch/pull and gh for the agent box (lib/guard/vcs.mjs, POST /vcs,
 * docker/agent-box/vcs/vcs-client.mjs) — end to end with real git: the box
 * client in a working clone, the daemon over HTTP, its mirror, and a bare
 * "remote" standing in for GitHub (the pinned https url is mapped onto it).
 *
 * What must hold:
 *   - the daemon never runs git in the agent's repo — only in its mirror
 *   - push sends new commits, updates the tracking ref; never forced, never a delete
 *   - fetch/pull bring the remote's commits in through a bundle
 *   - an unpinned remote, a local-path/file:// remote, and gh writes need approval or are refused
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createGuard, hostRunner } from '../../scripts/coding-guard-daemon.mjs';
import { guardPaths } from '../../lib/guard/home.mjs';
import { parseRemoteUrl, ghPlan, pinRemotes, normaliseRemotes, VcsError } from '../../lib/guard/vcs.mjs';
import { parsePush, splitGlobal, inlineBodyFile } from '../../docker/agent-box/vcs/vcs-client.mjs';

const CLIENT = fileURLToPath(new URL('../../docker/agent-box/vcs/vcs-client.mjs', import.meta.url));
const URL_ = 'https://github.example/acme/widget.git';
const OTHER = 'https://github.example/evil/sink.git';
const ID = { GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.com' };

let tmp;
let server;
let base;
let token;
let boxToken;
let bare;
let clone;
let peer;
const hostCalls = [];

const g = (cwd, ...args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...ID } });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};
const commit = (cwd, file, text) => { fs.writeFileSync(path.join(cwd, file), text); g(cwd, 'add', file); g(cwd, 'commit', '-q', '-m', `edit ${file}`); return g(cwd, 'rev-parse', 'HEAD'); };

/** Run the box client as the box would (git shim → vcs-client.mjs) — async: the guard serves from this process. */
function box(cwd, ...args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLIENT, ...args], {
      cwd,
      env: { ...process.env, ...ID, CODING_GUARD_URL: base, CODING_GUARD_BOX_TOKEN: boxToken, CODING_GUARD_SESSION: 'coding-box-claude-9', CODING_BOX_REAL_GIT: 'git' },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-vcs-'));
  bare = path.join(tmp, 'remote.git');
  clone = path.join(tmp, 'work');
  peer = path.join(tmp, 'peer');
  g(tmp, 'init', '-q', '--bare', '-b', 'main', bare);
  g(tmp, 'clone', '-q', bare, peer);
  commit(peer, 'a.txt', 'one\n');
  g(peer, 'push', '-q', 'origin', 'HEAD:main');
  g(tmp, 'clone', '-q', bare, clone);
  g(clone, 'remote', 'set-url', 'origin', URL_);
  const fakeGh = path.join(tmp, 'gh');
  fs.writeFileSync(fakeGh, '#!/bin/sh\necho "repo=$GH_REPO args=$*"\n', { mode: 0o755 });

  const paths = guardPaths(path.join(tmp, 'guard'));
  let handler = null;
  server = http.createServer((req, res) => handler(req, res));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  base = `http://127.0.0.1:${port}`;
  ({ handler } = createGuard({
    paths, port, codingRepo: '/repo', ghPath: fakeGh,
    runHost: (cmd, argv, opts) => {
      hostCalls.push({ cmd, argv, cwd: opts?.cwd });
      return hostRunner(cmd, argv.map((a) => (a === URL_ ? bare : a)), opts);
    },
  }));
  token = fs.readFileSync(paths.token, 'utf8').trim();
  const reg = await fetch(`${base}/boxes`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ session: 'coding-box-claude-9', workspace: clone, remotes: [URL_, '/etc', 'file:///x'] }),
  });
  boxToken = (await reg.json()).token;
});

after(() => {
  server?.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('box git through the guard (real git, end to end)', () => {
  test('push: new commits reach the remote and the tracking ref follows', async () => {
    const sha = commit(clone, 'b.txt', 'two\n');
    const r = await box(clone, 'git', 'push');
    assert.equal(r.status, 0, r.stderr);
    assert.equal(g(bare, 'rev-parse', 'refs/heads/main'), sha);
    assert.equal(g(clone, 'rev-parse', 'refs/remotes/origin/main'), sha);
  });

  test('push -u of a new branch, with -C', async () => {
    g(clone, 'checkout', '-q', '-b', 'feat/x');
    const sha = commit(clone, 'c.txt', 'three\n');
    const r = await box(tmp, 'git', '-C', 'work', 'push', '-u', 'origin', 'feat/x');
    assert.equal(r.status, 0, r.stderr);
    assert.equal(g(bare, 'rev-parse', 'refs/heads/feat/x'), sha);
    assert.equal(g(clone, 'rev-parse', '--abbrev-ref', 'feat/x@{u}'), 'origin/feat/x');
    g(clone, 'checkout', '-q', 'main');
  });

  test('fetch and pull bring in what someone else pushed', async () => {
    g(peer, 'pull', '-q', 'origin', 'main');
    const theirs = commit(peer, 'd.txt', 'four\n');
    g(peer, 'push', '-q', 'origin', 'HEAD:main');
    const f = await box(clone, 'git', 'fetch');
    assert.equal(f.status, 0, f.stderr);
    assert.equal(g(clone, 'rev-parse', 'refs/remotes/origin/main'), theirs);
    const p = await box(clone, 'git', 'pull', '--ff-only');
    assert.equal(p.status, 0, p.stderr);
    assert.equal(g(clone, 'rev-parse', 'HEAD'), theirs);
  });

  test('a non-fast-forward push is rejected by the remote, not forced', async () => {
    const theirs = commit(peer, 'e.txt', 'five\n');
    g(peer, 'push', '-q', 'origin', 'HEAD:main');
    commit(clone, 'f.txt', 'six\n');
    const r = await box(clone, 'git', 'push');
    assert.notEqual(r.status, 0);
    assert.equal(g(bare, 'rev-parse', 'refs/heads/main'), theirs);
  });

  test('force, delete and tag pushes are refused before anything is sent', async () => {
    for (const args of [['push', '-f'], ['push', '--force-with-lease'], ['push', 'origin', ':feat/x'], ['push', 'origin', '+main'], ['push', '--tags'], ['push', '--mirror']]) {
      const r = await box(clone, 'git', ...args);
      assert.equal(r.status, 2, `${args.join(' ')}: ${r.stderr}`);
      assert.match(r.stderr, /not available from the box/);
    }
    assert.equal(g(bare, 'rev-parse', '--verify', '--quiet', 'refs/heads/feat/x').length, 40);
  });

  test('ls-remote', async () => {
    const r = await box(clone, 'git', 'ls-remote', '--heads', 'origin');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /refs\/heads\/main/);
  });

  test('a remote that was not pinned at launch needs approval', async () => {
    g(clone, 'remote', 'add', 'sink', OTHER);
    const r = await box(clone, 'git', 'push', 'sink', 'main');
    assert.equal(r.status, 3, r.stderr);
    assert.match(r.stderr, /needs your approval: http:\/\/localhost:\d+\/approve\//);
    g(clone, 'remote', 'remove', 'sink');
  });

  test('a local path or file:// remote is refused outright', async () => {
    for (const url of [bare, `file://${bare}`, 'ext::sh -c touch% /tmp/x']) {
      g(clone, 'remote', 'add', 'local', url);
      const r = await box(clone, 'git', 'fetch', 'local');
      assert.notEqual(r.status, 0, url);
      assert.match(r.stderr, /not an https:\/\/, ssh:\/\/ or user@host:path url|must be a plain string/);
      g(clone, 'remote', 'remove', 'local');
    }
  });

  test('the daemon never ran git inside the agent repo', () => {
    for (const c of hostCalls) {
      assert.ok(!c.argv.includes(clone) && !(c.cwd || '').startsWith(clone), JSON.stringify(c));
      if (c.cmd === 'git') assert.deepEqual(c.argv.slice(0, 2), ['-c', 'core.hooksPath=/dev/null']);
    }
  });

  test('gh: reads run with the repo fixed; writes need approval', async () => {
    const r = await box(clone, 'gh', 'run', 'list', '--limit', '3');
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), 'repo=github.example/acme/widget args=run list --limit 3');
    const w = await box(clone, 'gh', 'pr', 'merge', '12');
    assert.equal(w.status, 3, w.stderr);
    const bad = await box(clone, 'gh', 'api', '-X', 'POST', 'repos/{owner}/{repo}/issues');
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /only GET/);
  });
});

describe('vcs rules (pure)', () => {
  test('parseRemoteUrl: https, ssh, scp-like only', () => {
    assert.equal(parseRemoteUrl('git@github.com:fwornle/coding.git').ownerRepo, 'fwornle/coding');
    assert.equal(parseRemoteUrl('ssh://git@bmw.ghe.com/a/b.git').host, 'bmw.ghe.com');
    assert.equal(parseRemoteUrl('https://github.com/a/b').ownerRepo, 'a/b');
    for (const bad of ['/Users/u/repo', 'file:///x', 'ext::sh -c x', 'http://github.com/a/b', 'git@-oProxyCommand=x:a/b', 'https://h/a/../b', '../sibling.git']) {
      assert.throws(() => parseRemoteUrl(bad), VcsError, bad);
    }
  });

  test('pins: first report is the baseline; later new urls are not added', () => {
    const { pins, added } = pinRemotes({}, '/w', ['u1']);
    assert.deepEqual(added, ['u1']);
    const second = pinRemotes(pins, '/w', ['u1', 'u2']);
    assert.deepEqual(second.pins['/w'], ['u1']);
    assert.deepEqual(second.unpinned, ['u2']);
  });

  test('relative submodule urls resolve against origin', () => {
    assert.deepEqual(normaliseRemotes(['git@github.com:fw/coding.git', '../mcp-constraint-monitor.git', '/local'], 'git@github.com:fw/coding.git'),
      ['git@github.com:fw/coding.git', 'git@github.com:fw/mcp-constraint-monitor.git']);
  });

  test('gh vocabulary', () => {
    const r = parseRemoteUrl('git@github.com:fw/coding.git');
    assert.deepEqual(ghPlan(['run', 'view', '1', '--log-failed'], r).env.GH_REPO, 'fw/coding');
    assert.equal(ghPlan(['run', 'rerun', '1', '--failed'], r).gated, false);
    assert.equal(ghPlan(['pr', 'create', '--title', 't', '--body', 'b'], r).rule, 'gh:pr create');
    assert.equal(ghPlan(['api', 'repos/{owner}/{repo}/actions/runs'], r).gated, false);
    for (const bad of [['repo', 'delete'], ['api', 'user'], ['api', 'repos/other/x'], ['run', 'list', '-R', 'x/y'], ['pr', 'create', '--body', '@/etc/passwd'], ['api', '-f', 'a=1', 'repos/{owner}/{repo}'], ['auth', 'token'], ['secret', 'list']]) {
      assert.throws(() => ghPlan(bad, r), VcsError, bad.join(' '));
    }
  });

  test('client parsing', () => {
    assert.deepEqual(splitGlobal(['-C', 'x', '-c', 'a=b', '--no-pager', 'push', 'origin']), { global: ['-C', 'x', '-c', 'a=b', '--no-pager'], verb: 'push', rest: ['origin'] });
    assert.deepEqual(parsePush(['-u', 'origin', 'a:b']).specs, ['a:b']);
    assert.deepEqual(inlineBodyFile(['pr', 'create', '--body-file', 'f'], () => 'BODY'), ['pr', 'create', '--body', 'BODY']);
    assert.deepEqual(inlineBodyFile(['run', 'view', '-F', 'x'], () => 'no'), ['run', 'view', '-F', 'x']);
  });
});
