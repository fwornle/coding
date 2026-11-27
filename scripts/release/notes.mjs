#!/usr/bin/env node
/**
 * Release notes from the conventional commits since the previous release.
 *
 *   node scripts/release/notes.mjs [--version x.y.z] [--since <ref>] [--repo .]
 *
 * "Previous release" = the highest `v<x.y.z>` tag at or above the release line's
 * start (FIRST_RELEASE) that is older than this version. The v7.x tags are
 * milestones, not releases, so the FIRST release counts from the newest tag
 * there is (the last milestone) and says so.
 *
 * Merge commits are skipped (--no-merges): the branch commits they bring in are
 * what carry the conventional subjects, and listing both would name each
 * change twice. Subjects that are not conventional commits are left out.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { compareVersions, VERSION_RE } = require('../../lib/install/layout.cjs');

export const FIRST_RELEASE = '8.0.0';
const SECTIONS = [
  ['feat', 'Features'],
  ['fix', 'Fixes'],
  ['perf', 'Performance'],
];
// A first release spans months of work; listing every fix there buries the features.
const MAX_LISTED = 60;

const git = (repo, args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', maxBuffer: 1 << 28 }).trim();

export function previousRelease(repo, version) {
  const tags = git(repo, ['tag', '--list', 'v*'])
    .split('\n')
    .map((t) => t.slice(1))
    .filter((v) => VERSION_RE.test(v) && compareVersions(v, FIRST_RELEASE) >= 0 && compareVersions(v, version) < 0)
    .sort(compareVersions);
  return tags.length ? `v${tags.at(-1)}` : null;
}

const CC = /^(?<type>[a-z]+)(?:\((?<scope>[^)]+)\))?(?<bang>!)?:\s*(?<subject>.+)$/;

export function parseCommits(lines) {
  const out = [];
  for (const line of lines) {
    const [sha, subject, body = ''] = line.split('\x1f');
    if (!subject) continue;
    const m = CC.exec(subject);
    if (!m) continue;
    const breaking = !!m.groups.bang || /^BREAKING[ -]CHANGE:/m.test(body);
    out.push({ sha, type: m.groups.type, scope: m.groups.scope ?? null, subject: m.groups.subject, breaking });
  }
  return out;
}

/** Conventional commits reachable from HEAD but not from `since`, merges unfolded. */
function commitsSince(repo, since) {
  const range = since ? [`${since}..HEAD`] : ['HEAD'];
  const raw = git(repo, ['log', '--no-merges', '--format=%h%x1f%s%x1f%b%x1e', ...range]);
  return parseCommits(raw.split('\x1e').map((s) => s.trim()).filter(Boolean));
}

export function renderNotes({ version, since, sinceIsMilestone, commits }) {
  const line = (c) => `- ${c.scope ? `**${c.scope}:** ` : ''}${c.subject} (${c.sha})`;
  const parts = [`## coding ${version}`, ''];
  if (!since) parts.push('First release.', '');
  else if (sinceIsMilestone) parts.push(`First release of the ${version.split('.')[0]}.x line. Changes since the ${since} milestone.`, '');
  else parts.push(`Changes since ${since}.`, '');

  const breaking = commits.filter((c) => c.breaking);
  if (breaking.length) parts.push('### Breaking changes', '', ...breaking.map(line), '');

  for (const [type, title] of SECTIONS) {
    const list = commits.filter((c) => c.type === type);
    if (!list.length) continue;
    parts.push(`### ${title}`, '');
    if (list.length > MAX_LISTED) {
      parts.push(...list.slice(0, MAX_LISTED).map(line), `- …and ${list.length - MAX_LISTED} more`, '');
    } else parts.push(...list.map(line), '');
  }
  parts.push(
    '### Install',
    '',
    'Download `coding-' + version + '.tar.gz`, check it against the `.sha256` file, unpack it and run `./install.sh`.',
    'Service images: `ghcr.io/fwornle/coding-services:' + version + '` (linux/amd64, linux/arm64).',
    '',
  );
  return parts.join('\n');
}

/**
 * The highest-numbered `v*` milestone tag merged into HEAD (other than this
 * version's own tag). By version, not by `git describe`: describe measures
 * distance through merge history and picked v7.3 over v7.6 for 8.0.0.
 * Milestone tags are loose (`v7.6`), so they are compared as number lists.
 */
export function lastMilestone(repo, version) {
  const nums = (t) => t.slice(1).split(/[.-]/).map((x) => (/^\d+$/.test(x) ? Number(x) : -1));
  const cmp = (a, b) => {
    const x = nums(a);
    const y = nums(b);
    for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
    return 0;
  };
  const tags = git(repo, ['tag', '--merged', 'HEAD', '--list', 'v*'])
    .split('\n')
    .filter((t) => /^v\d+(\.\d+)*$/.test(t) && t !== `v${version}`)
    .sort(cmp);
  return tags.at(-1) ?? null;
}

export function buildNotes({ repo, version, since } = {}) {
  repo = path.resolve(repo ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..'));
  version ??= JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8')).version;
  let sinceIsMilestone = false;
  if (!since) {
    since = previousRelease(repo, version);
    if (!since) {
      since = lastMilestone(repo, version);
      sinceIsMilestone = !!since;
    }
  }
  return renderNotes({ version, since, sinceIsMilestone, commits: commitsSince(repo, since) });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const opt = (n) => {
    const i = args.indexOf(`--${n}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  process.stdout.write(buildNotes({ repo: opt('repo'), version: opt('version'), since: opt('since') }));
}
