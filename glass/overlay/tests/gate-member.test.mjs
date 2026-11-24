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
