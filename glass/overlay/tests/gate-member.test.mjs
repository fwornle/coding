/**
 * glass's gate pseudonym is its own, so beside coding on one machine the two
 * add up. Both used memberId() — sha1(host:user) — and each read the team with
 * its own live counts in place of "its" file (teamPool skips `self`): coding's
 * published counts were skipped as glass's own, and the team showed nothing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { createGlassJobClasses } = await import('../lib/glass/job-classes.mjs');
const { TURN_JOB_CLASS_DDL, loadTaxonomy } = await import('../proxy/proxy-bridge/job-class.mjs');
const { memberId, writeMemberFile } = await import('../proxy/proxy-bridge/gate-pool.mjs');
const { initTokenDb } = await import('../proxy/dist/token-usage.js');

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('a team read adds coding\'s gate file on this machine instead of skipping it as glass\'s own', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'glass-gate-member-'));
  const pkg = path.join(home, 'team', 'job-classes');
  fs.mkdirSync(path.join(pkg, 'gate'), { recursive: true });
  fs.copyFileSync(path.join(PKG_ROOT, 'config', 'job-classes.yaml'), path.join(pkg, 'taxonomy.yaml'));
  const tax = loadTaxonomy(path.join(pkg, 'taxonomy.yaml'));
  const [cls] = tax.ids;

  // coding on this machine: the plain pseudonym, as `coding job-classes publish` writes it
  const coding = memberId();
  writeMemberFile(path.join(pkg, 'gate'), {
    member: coding,
    pools: [{ taxonomy: tax.tag, labeller: 'claude-sonnet-5', checker: 'claude-sonnet-5', classes: { [cls]: { labelled: 9, checked: 7, agree: 7 } }, confusions: [] }],
  });

  // glass's own token DB, as the daemon opens it (the summary reads token_usage too)
  const { db } = initTokenDb(path.join(home, 'data'));
  db.exec(TURN_JOB_CLASS_DDL);
  const jc = createGlassJobClasses({
    home, dataDir: path.join(home, 'data'), db, redact: (s) => s, pkgRoot: PKG_ROOT, githubHost: () => 'example.invalid',
    complete: async () => ({ content: cls }),
  });
  jc.store.update({ enabled: true, team: { url: 'https://example.invalid/team.git', dir: path.join(home, 'team') } });

  const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  const server = http.createServer(async (req, res) => {
    if (!(await jc.handle(req, res, { json, readJson: async () => ({}), writeAllowed: () => false }))) json(res, 404, {});
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const { port } = server.address();
    const body = await (await fetch(`http://127.0.0.1:${port}/api/job-classes/summary?scope=team&taxonomy=${encodeURIComponent(tax.tag)}`)).json();
    assert.ok(body.team, `a team view: ${JSON.stringify(body).slice(0, 300)}`);
    assert.notEqual(body.team.self, coding, 'glass must not claim coding\'s pseudonym');
    assert.equal(body.team.self, memberId({ install: 'glass' }));
    const row = body.team.members.find((m) => m.member === coding);
    assert.ok(row, 'coding\'s file is read as a member');
    const pool = body.team.pools.find((p) => p.members.includes(coding));
    assert.equal(pool?.classes?.[cls]?.checked, 7, 'and its checks are added');
  } finally {
    server.close();
    db.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});

/** A team repo (bare) holding the shipped taxonomy as its package, and glass joined to a clone of it. */
async function joinedTeam() {
  const { execFileSync } = await import('node:child_process');
  const sh = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'glass-team-sync-'));
  const bare = path.join(home, 'team.git');
  sh(home, 'init', '-q', '--bare', '-b', 'main', bare);
  const seed = path.join(home, 'seed');
  sh(home, 'clone', '-q', bare, seed);
  fs.mkdirSync(path.join(seed, 'job-classes'), { recursive: true });
  fs.copyFileSync(path.join(PKG_ROOT, 'config', 'job-classes.yaml'), path.join(seed, 'job-classes', 'taxonomy.yaml'));
  sh(seed, 'add', '.');
  sh(seed, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'package');
  sh(seed, 'push', '-q', 'origin', 'HEAD');
  const dir = path.join(home, 'job-classes', 'team');
  sh(home, 'clone', '-q', bare, dir);
  const tax = loadTaxonomy(path.join(dir, 'job-classes', 'taxonomy.yaml'));
  const { db } = initTokenDb(path.join(home, 'data'));
  db.exec(TURN_JOB_CLASS_DDL);
  const label = (key, cls) => db.prepare(`INSERT INTO turn_job_class (conversation_key, turn_index, taxonomy, job_class, student_model, teacher_class, teacher_model, labelled_at)
    VALUES (?, 0, ?, ?, 'claude-sonnet-5', ?, 'claude-sonnet-5', ?)`).run(key, tax.tag, cls, cls, new Date().toISOString());
  const jc = createGlassJobClasses({
    home, dataDir: path.join(home, 'data'), db, redact: (s) => s, pkgRoot: PKG_ROOT, githubHost: () => 'example.invalid',
    complete: async () => ({ content: [...tax.ids][0] }),
  });
  // an https URL passes the join check; pulls go to the clone's own origin (the bare repo)
  jc.store.update({ enabled: true, team: { url: 'https://example.invalid/team.git', dir } });
  const pushed = () => JSON.parse(sh(home, '--git-dir', bare, 'show', `main:job-classes/gate/${jc.member}.json`));
  const done = () => { db.close(); fs.rmSync(home, { recursive: true, force: true }); };
  return { home, bare, dir, tax, db, label, jc, pushed, done };
}

test('the daemon\'s team sync publishes as glass and pushes — only after a publish by hand', async () => {
  const t = await joinedTeam();
  try {
    const [cls] = t.tax.ids;
    t.label('a', cls);
    assert.deepEqual(await t.jc.autoSync(), { skipped: 'not published yet' }, 'the first publish is the opt-in');
    const first = await t.jc.handle(
      { method: 'POST', url: '/api/job-classes/team/publish' },
      { }, { json: (_res, status, body) => { t.firstPublish = { status, body }; }, readJson: async () => ({ push: true }), writeAllowed: () => true },
    );
    assert.ok(first);
    assert.equal(t.firstPublish.status, 200, JSON.stringify(t.firstPublish.body));
    assert.equal(t.pushed().source, 'glass');
    assert.equal(t.pushed().pools[0].classes[cls].labelled, 1);
    t.label('b', cls);
    const r = await t.jc.autoSync();
    assert.equal(r.error, undefined, r.error);
    assert.equal(r.published.pushed, true);
    assert.equal(t.pushed().pools[0].classes[cls].labelled, 2, 'the new label went out on its own');
  } finally {
    t.done();
  }
});

test('PUT /api/job-classes/gate-exclude: stored locally, applied to the team view, refused from anyone but glass', async () => {
  const t = await joinedTeam();
  try {
    const [cls] = t.tax.ids;
    const coding = memberId();
    writeMemberFile(path.join(t.dir, 'job-classes', 'gate'), {
      member: coding, source: 'coding',
      pools: [{ taxonomy: t.tax.tag, labeller: 'claude-sonnet-5', checker: 'claude-sonnet-5', classes: { [cls]: { labelled: 9, checked: 7, agree: 7 } }, confusions: [] }],
    });
    const call = async (method, url, body, allowed = true) => {
      let out;
      await t.jc.handle({ method, url }, {}, { json: (_r, status, b) => { out = { status, body: b }; }, readJson: async () => body, writeAllowed: () => allowed });
      return out;
    };
    assert.equal((await call('PUT', '/api/job-classes/gate-exclude', { team: t.tax.name, exclude: [coding] }, false)).status, 403);
    const ok = await call('PUT', '/api/job-classes/gate-exclude', { team: t.tax.name, exclude: [coding] });
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.body.exclude, [coding]);
    assert.ok(fs.existsSync(path.join(t.home, 'job-classes', 'gate-exclude.json')), 'kept in GLASS_HOME, not in the team repo');

    const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    const server = http.createServer(async (req, res) => {
      if (!(await t.jc.handle(req, res, { json, readJson: async () => ({}), writeAllowed: () => false }))) json(res, 404, {});
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    try {
      const { port } = server.address();
      const body = await (await fetch(`http://127.0.0.1:${port}/api/job-classes/summary?scope=team&taxonomy=${encodeURIComponent(t.tax.tag)}`)).json();
      const row = body.team.members.find((m) => m.member === coding);
      assert.equal(row.excluded, true);
      assert.equal(row.source, 'coding');
      assert.equal(row.thisMachine, true, 'coding on this machine');
      assert.equal(body.team.name, t.tax.name);
      assert.ok(!body.team.pools.some((p) => p.members.includes(coding)), 'not added');
    } finally {
      server.close();
    }
  } finally {
    t.done();
  }
});
