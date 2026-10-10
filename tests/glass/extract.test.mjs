// tests/glass/extract.test.mjs
//
// glass G2 — the extractor (scripts/glass/extract.mjs) and its import scanner:
//   1. the scanner sees every edge kind and ignores comments / strings / regexes;
//   2. each verify rule fails a fixture tree for the right reason;
//   3. the real manifest extracts a closed, deterministic tree that builds (skipped
//      when the rapid-llm-proxy checkout is not there, e.g. coding's hosted CI).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { scanSource } from '../../scripts/glass/import-graph.mjs';
import { extract, defaultRoots, diffTrees, parseRemote, checkTargetRemote, ExtractError } from '../../scripts/glass/extract.mjs';

test('scanner: static, dynamic, require and createRequire edges; computed sites', () => {
  const src = [
    "import a from './a.mjs';",
    "export { b } from './b.mjs';",
    "import './side.mjs';",
    "const c = await import('./c.mjs');",
    "const d = require('./d.cjs');",
    "const e = createRequire(import.meta.url)('pkg-e');",
    'const f = await import(modUrl);',
    'const g = require(path.join(dir, "x.cjs"));',
  ].join('\n');
  const refs = scanSource(src);
  assert.deepEqual(refs.filter((r) => !r.computed).map((r) => r.spec),
    ['./a.mjs', './b.mjs', './side.mjs', './c.mjs', './d.cjs', 'pkg-e']);
  assert.deepEqual(refs.filter((r) => r.computed).map((r) => r.line), [7, 8]);
});

test('scanner: comments, strings and regex literals are not edges', () => {
  const src = [
    "// import x from './commented.mjs'",
    "/** @param {import('better-sqlite3').Database} db */",
    "const s = 'llm-proxy-export', t = 'x import y from \"z\"';",
    "const r = /import('re')/;",
    "import real from './real.mjs';",
  ].join('\n');
  assert.deepEqual(scanSource(src).map((r) => r.spec), ['./real.mjs']);
});

/** A one-source fixture repo: files + glass/manifest.yaml + glass/overlay (+ glass/targets/<t>). */
function fixture({ files, manifest, overlay = { 'package.json': '{"name":"glass","type":"module"}' }, targets = {} }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'glass-extract-fx-'));
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body);
  }
  for (const [rel, body] of Object.entries(overlay)) {
    fs.mkdirSync(path.join(root, 'glass', 'overlay', path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(root, 'glass', 'overlay', rel), body);
  }
  for (const [t, tree] of Object.entries(targets)) {
    for (const [rel, body] of Object.entries(tree)) {
      fs.mkdirSync(path.join(root, 'glass', 'targets', t, path.dirname(rel)), { recursive: true });
      fs.writeFileSync(path.join(root, 'glass', 'targets', t, rel), body);
    }
  }
  fs.writeFileSync(path.join(root, 'glass', 'manifest.yaml'), manifest);
  return root;
}

function run(root, target) {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'glass-extract-out-')), 'tree');
  const r = extract({ out, manifestFile: path.join(root, 'glass', 'manifest.yaml'), roots: { coding: root }, skipSmoke: true, target });
  return { ...r, out };
}

function failsWith(root, pattern, target) {
  assert.throws(() => run(root, target), (err) => {
    assert.ok(err instanceof ExtractError, err.stack);
    assert.ok(err.errors.some((e) => pattern.test(e)), err.message);
    return true;
  });
}

const select = (...files) => `sources: { coding: {} }\nselect:\n  - source: coding\n    files: [${files.join(', ')}]\noverlay: glass/overlay\n`;

test('verify: a closed fixture extracts with provenance', () => {
  const root = fixture({
    files: { 'lib/a.mjs': "import { b } from './b.mjs';\nexport const a = b;\n", 'lib/b.mjs': 'export const b = 1;\n' },
    manifest: select('lib/a.mjs', 'lib/b.mjs'),
  });
  const { provenance, report } = run(root);
  assert.deepEqual(Object.keys(provenance.files), ['lib/a.mjs', 'lib/b.mjs', 'package.json']);
  assert.equal(report.files, 4); // + EXTRACTED.json
});

test('verify: an import of an unlisted file names the file to add', () => {
  const root = fixture({
    files: { 'lib/a.mjs': "import { b } from './b.mjs';\n", 'lib/b.mjs': 'export const b = 1;\n' },
    manifest: select('lib/a.mjs'),
  });
  failsWith(root, /not closed: lib\/a\.mjs:1 imports \.\/b\.mjs → add lib\/b\.mjs/);
});

test('verify: an unlisted computed import fails; a listed one needs targets in the tree', () => {
  const files = { 'lib/a.mjs': 'export const load = (p) => import(p);\n' };
  failsWith(fixture({ files, manifest: select('lib/a.mjs') }), /computed import: lib\/a\.mjs has 1 non-literal/);
  const listed = `${select('lib/a.mjs')}computed:\n  - file: lib/a.mjs\n    sites: 1\n    targets: [lib/missing.mjs]\n`;
  failsWith(fixture({ files, manifest: listed }), /reaches lib\/missing\.mjs, which is not in the tree/);
  const unreached = `${select('lib/a.mjs')}computed:\n  - file: lib/a.mjs\n    sites: 1\n    unreached: never called\n`;
  assert.ok(run(fixture({ files, manifest: unreached })));
});

test('verify: a forbidden package fails in package.json and at an unlisted site; a listed optional site passes', () => {
  const forbidden = 'forbidden:\n  packages: [better-sqlite3]\n';
  failsWith(fixture({
    files: { 'lib/a.mjs': 'export {};\n' },
    manifest: select('lib/a.mjs') + forbidden,
    overlay: { 'package.json': '{"name":"glass","dependencies":{"better-sqlite3":"^12"}}' },
  }), /forbidden: package\.json dependencies has better-sqlite3/);

  const files = { 'lib/a.cjs': "try { require('better-sqlite3'); } catch {}\n" };
  failsWith(fixture({ files, manifest: select('lib/a.cjs') + forbidden }), /forbidden: lib\/a\.cjs:1 imports better-sqlite3/);
  const optional = `${select('lib/a.cjs') + forbidden}optional:\n  - file: lib/a.cjs\n    package: better-sqlite3\n    reason: guarded\n`;
  assert.ok(run(fixture({ files, manifest: optional })));
  failsWith(fixture({ files: { 'lib/a.cjs': 'module.exports = 1;\n' }, manifest: optional }),
    /stale manifest: optional lib\/a\.cjs → better-sqlite3/);
});

test('verify: an undeclared package and a spawned shell fail', () => {
  failsWith(fixture({ files: { 'lib/a.mjs': "import x from 'left-pad';\n" }, manifest: select('lib/a.mjs') }),
    /imports package left-pad, which package.json does not declare/);
  failsWith(fixture({
    files: { 'lib/a.mjs': "import { spawnSync } from 'node:child_process';\nspawnSync('bash', ['-c', 'true']);\n" },
    manifest: `${select('lib/a.mjs')}forbidden:\n  spawn: [bash]\n`,
  }), /forbidden: lib\/a\.mjs spawns a shell/);
});

test('rewrite: a find string matched the wrong number of times fails', () => {
  const root = fixture({
    files: { 'lib/a.mjs': "export const port = '12435';\n" },
    manifest: `${select('lib/a.mjs')}rewrite:\n  - file: lib/a.mjs\n    find: "'12435'"\n    replace: "'12445'"\n    count: 2\n`,
  });
  failsWith(root, /found 1×, expected 2× — the upstream line changed/);
});

test('overlay: a file that would shadow a selected file fails', () => {
  const root = fixture({
    files: { 'lib/a.mjs': 'export {};\n' },
    manifest: select('lib/a.mjs'),
    overlay: { 'package.json': '{}', 'lib/a.mjs': 'export const parallel = 1;\n' },
  });
  failsWith(root, /overlay: lib\/a\.mjs would shadow a selected file/);
});

// ── targets: one source, a BMW tree and a public tree ──────────────────────────

const targets = (pub) => `targets:\n  bmw:\n    remote: bmw.example/org/glass\n  public:\n    remote: github.com/someone/glass\n    overlay: glass/targets/public\n${pub}`;

test('targets: --target is required, and must be one the manifest names', () => {
  const root = fixture({ files: { 'lib/a.mjs': 'export {};\n' }, manifest: select('lib/a.mjs') + targets('') });
  failsWith(root, /--target is required: bmw \| public/);
  failsWith(root, /unknown target "staging": bmw \| public/, 'staging');
  const { provenance } = run(root, 'bmw');
  assert.equal(provenance.target, 'bmw');
});

test('targets: the target overlay adds files and its rewrites run after both overlays', () => {
  const root = fixture({
    files: { 'lib/a.mjs': 'export {};\n' },
    manifest: select('lib/a.mjs') + targets('    rewrite:\n      - file: README.md\n        find: "ORG/glass"\n        replace: "someone/glass"\n        count: 1\n'),
    overlay: { 'package.json': '{}', 'README.md': 'see ORG/glass\n' },
    targets: { public: { LICENSE: 'MIT\n' } },
  });
  const { out } = run(root, 'public');
  assert.equal(fs.readFileSync(path.join(out, 'README.md'), 'utf8'), 'see someone/glass\n', 'a rewrite edits an overlay file');
  assert.equal(fs.readFileSync(path.join(out, 'LICENSE'), 'utf8'), 'MIT\n');
  assert.equal(fs.existsSync(path.join(run(root, 'bmw').out, 'LICENSE')), false, 'the bmw tree has no public-only file');
});

test('targets: a target file that the neutral overlay also has is a parallel copy and fails', () => {
  failsWith(fixture({
    files: { 'lib/a.mjs': 'export {};\n' },
    manifest: select('lib/a.mjs') + targets(''),
    overlay: { 'package.json': '{}', 'README.md': 'x\n' },
    targets: { public: { 'README.md': 'y\n' } },
  }), /overlay: README\.md would shadow a selected file/, 'public');
});

test('targets: the deny scan fails on a corporate string, the allowlist lets one through', () => {
  const files = { 'lib/a.mjs': '// call acme-corp.internal for help\nexport const names = "Acme|Globex";\n' };
  const deny = (allow) => targets(`    deny: ['acme']\n${allow}`);
  failsWith(fixture({ files, manifest: select('lib/a.mjs') + deny('') }), /deny: lib\/a\.mjs:1 matches \/acme\/i/, 'public');
  failsWith(fixture({ files, manifest: select('lib/a.mjs') + deny('    allow:\n      - file: lib/a.mjs\n        pattern: \'Acme\\|Globex\'\n') }), /deny: lib\/a\.mjs:1 /, 'public');
  assert.doesNotThrow(() => run(fixture({ files: { 'lib/a.mjs': 'export const names = "Acme|Globex";\n' }, manifest: select('lib/a.mjs') + deny('    allow:\n      - file: lib/a.mjs\n        pattern: \'Acme\\|Globex\'\n') }), 'public'));
  assert.doesNotThrow(() => run(fixture({ files, manifest: select('lib/a.mjs') + deny('') }), 'bmw'), 'the bmw target has no deny list');
});

test('targets: a tree is published only to its own target\'s repository', () => {
  const t = { name: 'public', remote: 'github.com/someone/glass' };
  assert.doesNotThrow(() => checkTargetRemote('git@github.com:someone/glass.git', t));
  assert.doesNotThrow(() => checkTargetRemote('https://github.com/someone/glass', t));
  assert.throws(() => checkTargetRemote('https://bmw.example/org/glass.git', t), /target public publishes to github\.com\/someone\/glass, not bmw\.example\/org\/glass/);
});

test('publish: remote URLs parse to gh host + repo, whatever the SSH user', () => {
  assert.deepEqual(parseRemote('bmw@bmw.ghe.com:AIMAAD/glass.git'), { host: 'bmw.ghe.com', repo: 'AIMAAD/glass' });
  assert.deepEqual(parseRemote('git@github.com:fwornle/coding.git'), { host: 'github.com', repo: 'fwornle/coding' });
  assert.deepEqual(parseRemote('https://bmw.ghe.com/AIMAAD/glass'), { host: 'bmw.ghe.com', repo: 'AIMAAD/glass' });
  assert.deepEqual(parseRemote('ssh://git@host:22/o/r.git'), { host: 'host', repo: 'o/r' });
});

test('build: a bundle step without the source\'s node_modules fails by name', () => {
  failsWith(fixture({
    files: { 'lib/a.mjs': 'export const a = 1;\n', 'ui-src/vite.config.ts': '' },
    manifest: `${select('lib/a.mjs')}build:\n  - source: coding\n    dir: ui-src\n    config: vite.config.ts\n    to: ui\n`,
  }), /build: coding:ui-src has no node_modules\/vite/);
});

test('real manifest: closed, builds with no node_modules, deterministic', (t) => {
  const roots = defaultRoots();
  if (!fs.existsSync(path.join(roots.proxy, 'proxy-bridge', 'measurement.mjs'))) {
    t.skip(`no rapid-llm-proxy checkout at ${roots.proxy}`);
    return;
  }
  if (!fs.existsSync(path.join(roots.coding, 'integrations', 'system-health-dashboard', 'node_modules', 'vite'))) {
    t.skip('dashboard dependencies not installed (the UI build needs them)');
    return;
  }
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'glass-extract-real-'));
  const first = extract({ out: path.join(base, 'a'), roots, target: 'bmw' });
  assert.ok(first.provenance.files['ui/index.html'], 'the UI bundle is in the tree');
  assert.ok(Object.keys(first.provenance.files).some((f) => /^ui\/assets\/index-.*\.js$/.test(f)));
  assert.ok(!Object.keys(first.report.smoke.failed || {}).length);
  assert.equal(first.report.smoke.ok, true);
  assert.equal(first.report.smoke.total_calls, 2);
  extract({ out: path.join(base, 'b'), roots, skipSmoke: true, target: 'bmw' });
  assert.equal(diffTrees(path.join(base, 'a'), path.join(base, 'b')).equal, true);
  for (const f of Object.keys(first.provenance.files)) assert.ok(!f.endsWith('.sh'), f);
});

test('real manifest, public target: passes its deny scan and differs from bmw only where it should', (t) => {
  const roots = defaultRoots();
  if (!fs.existsSync(path.join(roots.proxy, 'proxy-bridge', 'measurement.mjs'))
    || !fs.existsSync(path.join(roots.coding, 'integrations', 'system-health-dashboard', 'node_modules', 'vite'))) {
    t.skip('needs the rapid-llm-proxy checkout and the dashboard dependencies');
    return;
  }
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'glass-extract-pub-'));
  const pub = extract({ out: path.join(base, 'pub'), roots, skipSmoke: true, target: 'public' });
  assert.equal(pub.provenance.target, 'public');
  const update = fs.readFileSync(path.join(base, 'pub', 'lib', 'glass', 'update.mjs'), 'utf8');
  assert.match(update, /RELEASE_REPO = 'github\.com\/fwornle\/glass'/);
  assert.ok(fs.existsSync(path.join(base, 'pub', 'LICENSE')));
});
