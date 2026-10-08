#!/usr/bin/env node
// scripts/glass/extract.mjs — generate the glass tree from coding + rapid-llm-proxy.
//
//   node scripts/glass/extract.mjs --out <dir>              extract + verify into an empty dir
//   node scripts/glass/extract.mjs --check <glass checkout> extract to a temp dir, diff (exit 1 on drift)
//   node scripts/glass/extract.mjs --publish <glass checkout>
//        extract, then commit on a fresh branch from origin/main (in a temporary clone
//        of that checkout's origin — the checkout itself is untouched), push, open a PR
//   --node <path>   node binary for the build smoke (default: this one)
//
// Pipeline (glass/manifest.yaml drives every step): select → compile → rewrite →
// overlay → provenance → verify (closed imports, computed sites accounted for, no
// forbidden deps, builds: every module imports and the token DB round-trips with
// no node_modules). The glass repo is generated, never hand-edited.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire, isBuiltin } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { scanSource, stripComments, resolveRelative } from './import-graph.mjs';

const require = createRequire(import.meta.url);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEFAULT_MANIFEST = path.join(REPO, 'glass', 'manifest.yaml');
const PROVENANCE = 'EXTRACTED.json';
const JS_FILE = /\.(?:mjs|cjs|js)$/;

const say = (line) => process.stdout.write(`${line}\n`);

export class ExtractError extends Error {
  constructor(errors) {
    super(`glass extract failed:\n  - ${errors.join('\n  - ')}`);
    this.errors = errors;
  }
}

export function loadManifest(file = DEFAULT_MANIFEST) {
  const yaml = require('../../lib/features/vendor/js-yaml.cjs');
  const m = yaml.load(fs.readFileSync(file, 'utf8')) || {};
  return {
    select: m.select || [],
    compile: m.compile || [],
    rewrite: m.rewrite || [],
    computed: m.computed || [],
    optional: m.optional || [],
    forbidden: { packages: m.forbidden?.packages || [], spawn: m.forbidden?.spawn || [] },
    overlay: m.overlay || null,
    sources: Object.keys(m.sources || {}),
  };
}

/** The checkout each manifest source names: coding = this checkout, proxy = proxy-paths' proxyDir(). */
export function defaultRoots() {
  const { proxyDir } = require('../../lib/proxy/proxy-paths.cjs');
  return { coding: REPO, proxy: proxyDir() };
}

function gitInfo(dir) {
  try {
    const sha = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const status = execFileSync('git', ['-C', dir, 'status', '--porcelain'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return { sha, dirty: status.trim() !== '' };
  } catch {
    return { sha: null, dirty: null };
  }
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const posix = (p) => p.split(path.sep).join('/');

/** Every file under dir (relative, posix, sorted), skipping .git. */
export function listTree(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === '.git') continue;
      const abs = path.join(d, e.name);
      if (e.isDirectory()) walk(abs);
      else out.push(posix(path.relative(dir, abs)));
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return out.sort();
}

function copyInto(out, rel, srcAbs) {
  const dest = path.join(out, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(srcAbs, dest);
}

function select(manifest, roots, out) {
  const errors = [];
  const placed = new Set();
  for (const group of manifest.select) {
    const root = roots[group.source];
    if (!root) { errors.push(`select: unknown source "${group.source}"`); continue; }
    for (const f of group.files || []) {
      const src = path.join(root, f);
      const rel = posix(path.join(group.to || '', f));
      if (!fs.existsSync(src)) { errors.push(`select: ${group.source}:${f} does not exist`); continue; }
      if (placed.has(rel)) { errors.push(`select: ${rel} listed twice`); continue; }
      placed.add(rel);
      copyInto(out, rel, src);
    }
  }
  if (errors.length) throw new ExtractError(errors);
}

const COMPILE_OVERRIDES = new Set(['rootDir', 'outDir', 'declaration', 'declarationMap', 'sourceMap',
  'inlineSourceMap', 'composite', 'incremental', 'tsBuildInfoFile', 'noEmit']);

/** compilerOptions → tsc CLI flags (the proxy's own settings, minus outputs we fix). */
function tscFlags(compilerOptions) {
  const flags = [];
  for (const [k, v] of Object.entries(compilerOptions || {})) {
    if (COMPILE_OVERRIDES.has(k)) continue;
    if (Array.isArray(v)) flags.push(`--${k}`, v.join(','));
    else flags.push(`--${k}`, String(v));
  }
  return flags;
}

function compile(manifest, roots, out) {
  for (const step of manifest.compile) {
    const root = roots[step.source];
    const tsc = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc');
    if (!fs.existsSync(tsc)) throw new ExtractError([`compile: ${tsc} missing — run npm install in ${root}`]);
    const tsconfig = JSON.parse(fs.readFileSync(path.join(root, 'tsconfig.json'), 'utf8'));
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glass-tsc-'));
    try {
      const args = [tsc, ...tscFlags(tsconfig.compilerOptions),
        '--rootDir', path.join(root, step.rootDir), '--outDir', tmp,
        '--declaration', 'false', '--sourceMap', 'false', ...step.files];
      const r = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8' });
      if (r.status !== 0) throw new ExtractError([`compile: tsc failed in ${root}:\n${r.stdout}${r.stderr}`]);
      const want = step.files.map((f) => posix(path.relative(step.rootDir, f)).replace(/\.ts$/, '.js')).sort();
      const got = listTree(tmp);
      if (JSON.stringify(want) !== JSON.stringify(got)) {
        throw new ExtractError([`compile: tsc emitted [${got.join(', ')}], expected [${want.join(', ')}]`]);
      }
      for (const f of got) copyInto(out, posix(path.join(step.to, f)), path.join(tmp, f));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
}

function rewrite(manifest, out) {
  const errors = [];
  for (const rule of manifest.rewrite) {
    const file = path.join(out, rule.file);
    if (!fs.existsSync(file)) { errors.push(`rewrite: ${rule.file} is not in the tree`); continue; }
    const src = fs.readFileSync(file, 'utf8');
    const count = src.split(rule.find).length - 1;
    if (count !== rule.count) {
      errors.push(`rewrite: ${rule.file}: "${rule.find}" found ${count}×, expected ${rule.count}× — the upstream line changed`);
      continue;
    }
    fs.writeFileSync(file, src.split(rule.find).join(rule.replace));
  }
  if (errors.length) throw new ExtractError(errors);
}

function overlay(manifest, out, manifestDir) {
  if (!manifest.overlay) return;
  const dir = path.resolve(manifestDir, '..', manifest.overlay);
  const errors = [];
  for (const rel of listTree(dir)) {
    if (fs.existsSync(path.join(out, rel))) {
      errors.push(`overlay: ${rel} would shadow a selected file — no parallel copies`);
      continue;
    }
    copyInto(out, rel, path.join(dir, rel));
  }
  if (errors.length) throw new ExtractError(errors);
}

function provenance(out, roots, manifestFile) {
  const sources = {};
  for (const [name, root] of Object.entries(roots)) sources[name] = gitInfo(root);
  const files = {};
  for (const rel of listTree(out)) files[rel] = sha256(fs.readFileSync(path.join(out, rel)));
  const doc = {
    generator: 'coding/scripts/glass/extract.mjs',
    sources,
    manifest: sha256(fs.readFileSync(manifestFile)),
    files,
  };
  fs.writeFileSync(path.join(out, PROVENANCE), JSON.stringify(doc, null, 2) + '\n');
  return doc;
}

const CHILD_PROCESS = new Set(['child_process', 'node:child_process']);

/**
 * Check the generated tree: imports closed, computed sites accounted for, no
 * forbidden packages or shells. Returns {errors, report}; never throws.
 */
export function verify(out, manifest) {
  const errors = [];
  const files = listTree(out);
  const inTree = new Set(files);
  const pkgPath = path.join(out, 'package.json');
  const pkg = fs.existsSync(pkgPath) ? JSON.parse(fs.readFileSync(pkgPath, 'utf8')) : {};
  const declared = new Set();
  for (const k of ['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies']) {
    for (const name of Object.keys(pkg[k] || {})) {
      declared.add(name);
      if (manifest.forbidden.packages.includes(name)) errors.push(`forbidden: package.json ${k} has ${name}`);
    }
  }
  const optional = new Map(manifest.optional.map((o) => [`${o.file}\0${o.package}`, o]));
  const usedOptional = new Set();
  const computedSeen = new Map();
  const childProcess = [];
  const spawnRe = manifest.forbidden.spawn.length
    ? new RegExp(String.raw`\b(?:spawn|spawnSync|exec|execSync|execFile|execFileSync)\s*\(\s*(['"\x60])(?:${manifest.forbidden.spawn.join('|')})(?=[\s'"\x60])`, 'g')
    : null;
  let lines = 0;

  for (const rel of files) {
    if (rel.endsWith('.sh')) errors.push(`forbidden: shell script ${rel}`);
    if (!JS_FILE.test(rel)) continue;
    const abs = path.join(out, rel);
    const src = fs.readFileSync(abs, 'utf8');
    lines += src.split('\n').length;
    for (const ref of scanSource(src)) {
      const at = `${rel}:${ref.line}`;
      if (ref.computed) { computedSeen.set(rel, (computedSeen.get(rel) || 0) + 1); continue; }
      const { spec } = ref;
      if (spec.startsWith('.')) {
        const target = resolveRelative(abs, spec);
        const targetRel = target && posix(path.relative(out, target));
        if (!target || targetRel.startsWith('../')) {
          const want = posix(path.relative(out, path.resolve(path.dirname(abs), spec)));
          errors.push(`not closed: ${at} imports ${spec} → add ${want} to the manifest`);
        }
        continue;
      }
      if (CHILD_PROCESS.has(spec)) { childProcess.push(at); continue; }
      if (isBuiltin(spec)) continue;
      const name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
      const key = `${rel}\0${name}`;
      if (optional.has(key)) { usedOptional.add(key); continue; }
      if (manifest.forbidden.packages.includes(name)) errors.push(`forbidden: ${at} imports ${name}`);
      else if (!declared.has(name)) errors.push(`not closed: ${at} imports package ${name}, which package.json does not declare`);
    }
    if (spawnRe) {
      const code = stripComments(src);
      for (const m of code.matchAll(spawnRe)) errors.push(`forbidden: ${rel} spawns a shell/tmux/python: ${m[0]}`);
    }
  }

  for (const [key, o] of optional) {
    if (!usedOptional.has(key)) errors.push(`stale manifest: optional ${o.file} → ${o.package} is no longer imported there`);
  }
  const computedListed = new Map(manifest.computed.map((c) => [c.file, c]));
  for (const [rel, n] of computedSeen) {
    const c = computedListed.get(rel);
    if (!c) errors.push(`computed import: ${rel} has ${n} non-literal import()/require() site(s) not listed under computed:`);
    else if (c.sites !== n) errors.push(`computed import: ${rel} has ${n} site(s), the manifest lists ${c.sites}`);
  }
  for (const c of manifest.computed) {
    if (!computedSeen.has(c.file)) errors.push(`stale manifest: computed ${c.file} has no non-literal site any more`);
    if (!c.targets && !c.unreached) errors.push(`computed import: ${c.file} needs targets: or unreached:`);
    for (const t of c.targets || []) if (!inTree.has(t)) errors.push(`computed import: ${c.file} reaches ${t}, which is not in the tree`);
  }

  return { errors, report: { files: files.length, jsLines: lines, childProcess } };
}

// Runs inside the copied tree: import every module, then round-trip the token DB
// through the proxy writer (node:sqlite) and coding's adapter writer.
const SMOKE = String.raw`
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const pkg = process.env.GLASS_SMOKE_PKG;
const at = (rel) => pathToFileURL(path.join(pkg, rel)).href;
const emit = (o) => process.stdout.write(JSON.stringify(o) + '\n');
const failed = [];
for (const rel of JSON.parse(process.env.GLASS_SMOKE_FILES)) {
  try { await import(at(rel)); } catch (e) { failed.push(rel + ': ' + e.message); }
}
if (failed.length) { emit({ ok: false, failed }); process.exit(1); }
const dataDir = process.env.LLM_PROXY_DATA_DIR;
const tu = await import(at('proxy/dist/token-usage.js'));
const td = await import(at('lib/lsl/token/token-db.mjs'));
const now = new Date().toISOString();
const handle = tu.initTokenDb(dataDir);
tu.logCall(handle, { timestamp: now, provider: 'anthropic', model: 'smoke', process: 'smoke', subscription: '',
  input_tokens: 10, output_tokens: 5, total_tokens: 15, latency_ms: 1, prompt_preview: '', tokens_estimated: 0 });
const db = td.openTokenDb(tu.resolveTokenDbPath(dataDir));
const inserted = td.insertTokenRowDeduped(db, { user_hash: td.ADAPTER_USER_HASH_CLAUDE, timestamp: now, provider: 'anthropic',
  model: 'smoke', process: 'smoke', subscription: '', input_tokens: 7, output_tokens: 3, total_tokens: 10, latency_ms: 0,
  prompt_preview: '', tokens_estimated: 0, tool_call_id: 'smoke-1' });
const s = tu.getSummary(handle, { hours: 1, scope: 'both' });
const ok = inserted === true && s.total_calls === 2 && s.total_tokens === 25;
emit({ ok, imported: JSON.parse(process.env.GLASS_SMOKE_FILES).length, node: process.version,
  inserted, total_calls: s.total_calls, total_tokens: s.total_tokens });
process.exit(ok ? 0 : 1);
`;

/** npm, as a command this platform can spawn. */
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';

/**
 * Copy the tree somewhere with no node_modules above it, install the declared
 * runtime dependencies the way `npm i -g` would (no scripts, no dev deps), then
 * run SMOKE there and the bin entry points with --version.
 * @returns {{ok: boolean, result: object|null, output: string}}
 */
export function smoke(out, { node = process.execPath } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glass-smoke-'));
  try {
    const pkg = path.join(tmp, 'glass');
    fs.cpSync(out, pkg, { recursive: true });
    for (const d of ['home', 'data']) fs.mkdirSync(path.join(tmp, d));
    const manifest = JSON.parse(fs.readFileSync(path.join(pkg, 'package.json'), 'utf8'));
    if (Object.keys(manifest.dependencies || {}).length) {
      const i = spawnSync(NPM, ['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--no-package-lock'], {
        cwd: pkg, encoding: 'utf8', timeout: 300_000, shell: process.platform === 'win32',
      });
      if (i.status !== 0) return { ok: false, result: null, output: `npm install failed:\n${i.stdout || ''}${i.stderr || ''}` };
    }
    const env = {
      PATH: process.env.PATH,
      HOME: path.join(tmp, 'home'),
      USERPROFILE: path.join(tmp, 'home'),
      CODING_SQLITE_BACKEND: 'node',
      LLM_PROXY_DATA_DIR: path.join(tmp, 'data'),
      CODING_DATA_HOME: path.join(tmp, 'data'),
      HEALTH_COORDINATOR_URL: 'off',
      NODE_NO_WARNINGS: '1',
    };
    // Entry points run when imported — they are exercised with --version instead.
    const files = listTree(pkg).filter((f) => JS_FILE.test(f) && !f.startsWith('bin/') && !f.startsWith('tests/') && !f.startsWith('node_modules/'));
    const r = spawnSync(node, ['--input-type=module', '-e', SMOKE], {
      cwd: tmp, encoding: 'utf8', timeout: 60_000,
      env: { ...env, GLASS_SMOKE_PKG: pkg, GLASS_SMOKE_FILES: JSON.stringify(files) },
    });
    let output = `${r.stdout || ''}${r.stderr || ''}`;
    const last = (r.stdout || '').trim().split('\n').pop();
    let result = null;
    try { result = JSON.parse(last); } catch { /* not JSON */ }
    let ok = r.status === 0 && result?.ok === true;
    for (const bin of Object.values(manifest.bin || {})) {
      const b = spawnSync(node, [path.join(pkg, bin), '--version'], { cwd: tmp, encoding: 'utf8', timeout: 30_000, env });
      if (b.status !== 0) { ok = false; output += `\n${bin} --version failed:\n${b.stdout || ''}${b.stderr || ''}`; }
      else if (result) (result.bins ||= {})[bin] = b.stdout.trim();
    }
    return { ok, result, output };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Generate the glass tree into `out` (must be empty or absent).
 * @returns {{provenance: object, report: object}}
 * @throws {ExtractError} on any failed step
 */
export function extract({ out, manifestFile = DEFAULT_MANIFEST, roots = defaultRoots(), smokeNode, skipSmoke = false } = {}) {
  if (fs.existsSync(out) && fs.readdirSync(out).length) throw new ExtractError([`--out ${out} is not empty`]);
  fs.mkdirSync(out, { recursive: true });
  const manifest = loadManifest(manifestFile);
  for (const s of manifest.sources) if (!roots[s]) throw new ExtractError([`no root for source "${s}"`]);
  select(manifest, roots, out);
  compile(manifest, roots, out);
  rewrite(manifest, out);
  overlay(manifest, out, path.dirname(manifestFile));
  const prov = provenance(out, roots, manifestFile);
  const { errors, report } = verify(out, manifest);
  if (errors.length) throw new ExtractError(errors);
  if (!skipSmoke) {
    const s = smoke(out, { node: smokeNode });
    if (!s.ok) throw new ExtractError([`build smoke failed:\n${s.output}`]);
    report.smoke = s.result;
  }
  return { provenance: prov, report };
}

/**
 * Differences between two trees (relative paths), ignoring .git. A git checkout as
 * `b` contributes only its tracked files — its node_modules and other ignored or
 * untracked files are not drift.
 */
export function diffTrees(a, b) {
  const fa = new Set(listTree(a));
  const fb = new Set(fs.existsSync(path.join(b, '.git'))
    ? git(b, ['ls-files']).split('\n').filter(Boolean)
    : listTree(b));
  const added = [...fa].filter((f) => !fb.has(f));
  const removed = [...fb].filter((f) => !fa.has(f));
  const changed = [...fa].filter((f) => fb.has(f)
    && !fs.readFileSync(path.join(a, f)).equals(fs.readFileSync(path.join(b, f))));
  return { added, removed, changed, equal: !added.length && !removed.length && !changed.length };
}

function git(dir, args) {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();
}

/** {host, repo} of a remote URL: scp-style `<user>@host:owner/repo.git` or a URL. */
export function parseRemote(url) {
  const m = /^(?:[a-z+]+:\/\/)?(?:[^@/]+@)?([^/:]+)(?::\d+)?[/:](.+?)(?:\.git)?\/?$/.exec(url.trim());
  return m ? { host: m[1], repo: m[2] } : null;
}

/**
 * Commit the tree on a fresh branch from origin/main and open a PR — in a temporary
 * clone of the glass remote, so the user's own glass checkout is never touched.
 * @param {string} target a glass checkout (its origin is used) or a remote URL
 */
function publish(target, tree, prov) {
  for (const [name, s] of Object.entries(prov.sources)) {
    if (!s.sha || s.dirty) throw new ExtractError([`publish: source ${name} is ${s.sha ? 'dirty' : 'not a git checkout'} — commit first`]);
  }
  const remote = fs.existsSync(target) ? git(target, ['remote', 'get-url', 'origin']) : target;
  const short = (s) => s.slice(0, 7);
  const subject = `extracted from coding@${short(prov.sources.coding.sha)}, rapid-llm-proxy@${short(prov.sources.proxy.sha)}`;
  const branch = `extract/${short(prov.sources.coding.sha)}-${short(prov.sources.proxy.sha)}`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glass-publish-'));
  try {
    const dir = path.join(tmp, 'glass');
    execFileSync('git', ['clone', '--quiet', '--branch', 'main', remote, dir], { encoding: 'utf8' });
    git(dir, ['checkout', '--quiet', '-b', branch]);
    for (const rel of listTree(dir)) fs.rmSync(path.join(dir, rel));
    for (const rel of listTree(tree)) copyInto(dir, rel, path.join(tree, rel));
    git(dir, ['add', '-A']);
    if (!git(dir, ['status', '--porcelain'])) return { branch, pr: null, unchanged: true };
    git(dir, ['commit', '--quiet', '-m', subject, '-m', 'Generated by coding/scripts/glass/extract.mjs from glass/manifest.yaml — do not edit by hand.']);
    git(dir, ['push', '--quiet', '-u', 'origin', branch]);
    const gh = parseRemote(remote);
    if (!gh) throw new ExtractError([`publish: cannot parse remote ${remote}`]);
    const pr = execFileSync('gh', ['pr', 'create', '--repo', `${gh.host}/${gh.repo}`, '--base', 'main', '--head', branch, '--title', subject,
      '--body', `Generated tree. Provenance and per-file checksums: \`${PROVENANCE}\`.`], {
      cwd: dir, encoding: 'utf8', env: { ...process.env, GH_HOST: gh.host },
    }).trim();
    return { branch, pr, unchanged: false };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (['--out', '--check', '--publish', '--node', '--manifest'].includes(k)) a[k.slice(2)] = argv[++i];
    else throw new Error(`unknown argument ${k}`);
  }
  return a;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifestFile = args.manifest ? path.resolve(args.manifest) : DEFAULT_MANIFEST;
  if ([args.out, args.check, args.publish].filter(Boolean).length !== 1) {
    process.stderr.write('usage: extract.mjs --out <dir> | --check <glass checkout> | --publish <glass checkout> [--node <bin>]\n');
    process.exit(2);
  }
  const tmp = args.out ? null : fs.mkdtempSync(path.join(os.tmpdir(), 'glass-extract-'));
  const out = args.out ? path.resolve(args.out) : path.join(tmp, 'tree');
  try {
    const { provenance: prov, report } = extract({ out, manifestFile, smokeNode: args.node });
    for (const [name, s] of Object.entries(prov.sources)) say(`source ${name}: ${s.sha}${s.dirty ? ' (dirty)' : ''}`);
    say(`tree: ${report.files} files, ${report.jsLines} JS lines — imports closed, no forbidden deps`);
    say(`smoke: ${JSON.stringify(report.smoke)}`);
    if (report.childProcess.length) say(`child_process (reported, allowed): ${report.childProcess.join(', ')}`);
    if (args.check) {
      const d = diffTrees(out, path.resolve(args.check));
      if (d.equal) {
        say('no drift');
      } else {
        say(`DRIFT: +${d.added.length} -${d.removed.length} ~${d.changed.length}`);
        for (const f of d.added) say(`  + ${f}`);
        for (const f of d.removed) say(`  - ${f}`);
        for (const f of d.changed) say(`  ~ ${f}`);
        process.exitCode = 1;
      }
    }
    if (args.publish) {
      const r = publish(path.resolve(args.publish), out, prov);
      say(r.unchanged ? `no changes against origin/main (${r.branch})` : `published ${r.branch}: ${r.pr}`);
    }
  } catch (err) {
    process.stderr.write(`${err instanceof ExtractError ? err.message : err.stack}\n`);
    process.exitCode = 1;
  } finally {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
