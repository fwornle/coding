#!/usr/bin/env node
/**
 * Build the release tarball: coding-<version>.tar.gz + .sha256.
 *
 *   node scripts/release/build-tarball.mjs [--out dist] [--repo .] [--version x.y.z]
 *
 * WHAT GOES IN. Every file tracked at HEAD (`git archive`, so nothing untracked,
 * ignored or machine-local can leak in) minus EXCLUDE below, plus every
 * submodule VENDORED at the SHA the superproject pins — an install needs
 * neither git nor network access to GitHub for the code. The tree unpacks as
 * `coding-<version>/`, and `release.json` is written into it last: that file is
 * what lib/install/layout.cjs treats as "this folder is a complete release",
 * and what install.sh treats as "submodules are vendored, do not fetch them".
 *
 * WHY AN EXCLUSION LIST AND NOT A MANIFEST. glass ships ~12% of the code, so it
 * names what it takes. coding ships nearly all of itself; naming every file
 * would be a list that is stale on the next commit. What is left out is the
 * developer-only material, and each entry says why.
 *
 * Dependencies are NOT bundled: node_modules carries native builds
 * (better-sqlite3, classic-level, onnxruntime) that differ per OS and arch, so a
 * single tarball cannot hold them. The installer runs the npm installs.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { VERSION_RE, MARKER } = require('../../lib/install/layout.cjs');

/** [pathspec, why] — superproject paths left out of a release. */
export const EXCLUDE = [
  ['.planning', 'planning notes and session logs of the development'],
  ['tests', 'test suites; a release is verified before it is published, not by the user'],
  ['test', 'older test fixtures'],
  ['test-results', 'Playwright output that was committed by accident'],
  ['glass', 'the glass extraction sources; glass has its own releases'],
  ['.spec-workflow', 'spec drafts'],
  ['.specstory', 'session history belongs to the learning repo, not the tools'],
  ['docs-content', 'the docs site source; the site is published separately (deploy-docs)'],
  ['docs/images', 'rendered diagrams and screenshots for the docs site'],
  ['docs/presentation', 'slide decks'],
  ['docs/api', 'generated API reference for the docs site'],
  ['.data/kb-ab-sampler', 'experiment fixtures'],
  ['.data/ontologies-experiment', 'experiment ontologies; the shipped ones are in .data/ontologies'],
];

const git = (cwd, args, opts = {}) =>
  execFileSync('git', args, { cwd, maxBuffer: 1 << 30, ...opts });

/** Submodules as the superproject pins them (gitlinks at HEAD), not as .gitmodules lists them. */
export function pinnedSubmodules(repo) {
  return git(repo, ['ls-tree', '-r', 'HEAD'], { encoding: 'utf8' })
    .split('\n')
    .filter((l) => l.startsWith('160000 commit '))
    .map((l) => {
      const [meta, p] = l.split('\t');
      return { path: p, sha: meta.split(' ')[2] };
    })
    .filter((s) => !EXCLUDE.some(([x]) => s.path === x || s.path.startsWith(`${x}/`)));
}

function extract(archiveCwd, treeish, dest, pathspecs = []) {
  fs.mkdirSync(dest, { recursive: true });
  const tar = git(archiveCwd, ['archive', '--format=tar', treeish, '--', ...pathspecs]);
  execFileSync('tar', ['-xf', '-', '-C', dest], { input: tar, maxBuffer: 1 << 30 });
}

export function buildTarball({ repo, out, version } = {}) {
  repo = path.resolve(repo ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..'));
  out = path.resolve(out ?? path.join(repo, 'dist'));
  version ??= JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8')).version;
  if (!VERSION_RE.test(version)) throw new Error(`not a release version: ${version}`);

  const commit = git(repo, ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const name = `coding-${version}`;
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-release-'));
  const root = path.join(stage, name);
  try {
    extract(repo, 'HEAD', root, ['.', ...EXCLUDE.map(([p]) => `:(exclude)${p}`)]);

    const submodules = {};
    for (const s of pinnedSubmodules(repo)) {
      const dir = path.join(repo, s.path);
      try {
        git(dir, ['cat-file', '-e', `${s.sha}^{commit}`]);
      } catch {
        throw new Error(`${s.path}: pinned commit ${s.sha} is not available locally — run git submodule update --init`);
      }
      fs.rmSync(path.join(root, s.path), { recursive: true, force: true });
      extract(dir, s.sha, path.join(root, s.path));
      submodules[s.path] = s.sha;
    }

    // Written LAST: its presence is what makes the folder a complete release.
    const marker = {
      version,
      commit,
      source: 'https://github.com/fwornle/coding',
      builtAt: new Date().toISOString(),
      submodules,
    };
    fs.writeFileSync(path.join(root, MARKER), `${JSON.stringify(marker, null, 2)}\n`);

    fs.mkdirSync(out, { recursive: true });
    const tarball = path.join(out, `${name}.tar.gz`);
    execFileSync('tar', ['-czf', tarball, '-C', stage, name]);
    const sha256 = createHash('sha256').update(fs.readFileSync(tarball)).digest('hex');
    fs.writeFileSync(`${tarball}.sha256`, `${sha256}  ${name}.tar.gz\n`);
    return { tarball, sha256, bytes: fs.statSync(tarball).size, marker };
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const opt = (n) => {
    const i = args.indexOf(`--${n}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  try {
    const r = buildTarball({ repo: opt('repo'), out: opt('out'), version: opt('version') });
    process.stdout.write(
      `${r.tarball}\n  ${(r.bytes / 1e6).toFixed(1)} MB  sha256 ${r.sha256}\n` +
        `  commit ${r.marker.commit.slice(0, 12)}, ${Object.keys(r.marker.submodules).length} submodule(s) vendored\n`,
    );
  } catch (err) {
    process.stderr.write(`build-tarball: ${err.message}\n`);
    process.exit(1);
  }
}
