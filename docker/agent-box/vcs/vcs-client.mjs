#!/usr/bin/env node
/**
 * `git push|fetch|pull|ls-remote` and `gh` inside the agent box.
 *
 * The box has no credentials and no route to the internet, so the host guard
 * does the network part (lib/guard/vcs.mjs, POST /vcs). This client does the
 * local part with the real git (/usr/bin/git): it bundles new commits for a
 * push, applies the bundle a fetch returns, updates remote-tracking refs, and
 * runs the merge/rebase of a pull. The /usr/local/bin/git shim sends only those
 * four verbs here; everything else goes straight to /usr/bin/git.
 *
 * Refused on purpose (say so, never silently): force pushes, deletes, --mirror,
 * --all, tag pushes. Those stay a host-shell action.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const GIT = process.env.CODING_BOX_REAL_GIT || '/usr/bin/git';
const GUARD = (process.env.CODING_GUARD_URL || '').replace(/\/$/, '');

export class UsageError extends Error {}

function say(msg) { process.stderr.write(`${msg}\n`); }

export function git(args, { cwd, input, allowFail = false, stdio } = {}) {
  const res = spawnSync(GIT, args, { cwd, input, encoding: input instanceof Buffer ? undefined : 'utf8', stdio, maxBuffer: 1024 * 1024 * 1024 });
  if (!allowFail && res.status !== 0) {
    throw new Error(`git ${args.join(' ')}: ${String(res.stderr || '').trim() || `exit ${res.status}`}`);
  }
  return res;
}
const out = (args, opts) => String(git(args, opts).stdout || '').trim();
const tryOut = (args, opts) => {
  const r = git(args, { ...opts, allowFail: true });
  return r.status === 0 ? String(r.stdout || '').trim() : '';
};

async function guard(body) {
  if (!GUARD || !process.env.CODING_GUARD_BOX_TOKEN) {
    throw new Error('the host guard is not reachable from this box (no CODING_GUARD_URL / box token) — push and fetch from a host shell');
  }
  const res = await fetch(`${GUARD}/vcs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-coding-box-token': process.env.CODING_GUARD_BOX_TOKEN },
    body: JSON.stringify({ ...body, session: process.env.CODING_GUARD_SESSION, agent: process.env.CODING_AGENT || null }),
    signal: AbortSignal.timeout(20 * 60_000),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 403 && data.request) {
    const e = new Error(`${data.error}\n(approve it in the browser, then run the command again)`);
    e.exitCode = 3;
    throw e;
  }
  if (res.status !== 200) throw new Error(`host guard: ${data.error || res.status}`);
  return data;
}

/** Split leading global options (`-C dir`, `-c k=v`, …) from the verb. */
export function splitGlobal(argv) {
  const global = [];
  let i = 0;
  while (i < argv.length) {
    const a = argv[i];
    if (a === '-C' || a === '-c' || a === '--git-dir' || a === '--work-tree' || a === '--namespace') { global.push(a, argv[i + 1]); i += 2; continue; }
    if (a.startsWith('-')) { global.push(a); i++; continue; }
    break;
  }
  return { global, verb: argv[i], rest: argv.slice(i + 1) };
}

/** cwd after -C options (relative ones compose, as in git). */
export function cwdOf(global, start = process.cwd()) {
  let cwd = start;
  for (let i = 0; i < global.length; i++) if (global[i] === '-C') cwd = path.resolve(cwd, global[i + 1]);
  return cwd;
}

// ── push ────────────────────────────────────────────────────────────────────

const PUSH_REFUSED = ['-f', '--force', '--force-with-lease', '--force-if-includes', '-d', '--delete', '--mirror', '--all', '--tags', '--follow-tags', '--prune'];

export function parsePush(args) {
  const o = { upstream: false, quiet: false, verify: true, dryRun: false, positional: [] };
  for (const a of args) {
    if (PUSH_REFUSED.includes(a.split('=')[0])) throw new UsageError(`git push ${a} is not available from the box — run it from a host shell`);
    if (a === '-u' || a === '--set-upstream') o.upstream = true;
    else if (a === '-q' || a === '--quiet') o.quiet = true;
    else if (a === '--no-verify') o.verify = false;
    else if (a === '-n' || a === '--dry-run') o.dryRun = true;
    else if (a === '-v' || a === '--verbose' || a === '--progress' || a === '--no-progress') { /* fine */ }
    else if (a.startsWith('-')) throw new UsageError(`git push ${a} is not supported from the box`);
    else o.positional.push(a);
  }
  const [remote, ...specs] = o.positional;
  for (const s of specs) {
    if (s.startsWith('+')) throw new UsageError(`'${s}' is a forced push — not available from the box`);
    if (s.startsWith(':')) throw new UsageError(`'${s}' deletes a remote branch — not available from the box`);
    if (/^refs\/tags\//.test(s) || s === 'tag') throw new UsageError('pushing tags is not available from the box — run it from a host shell');
  }
  return { ...o, remote: remote || null, specs };
}

function isExecutable(file) {
  try { fs.accessSync(file, fs.constants.X_OK); return fs.statSync(file).isFile(); } catch { return false; }
}

function currentBranch(cwd) {
  const b = tryOut(['symbolic-ref', '--quiet', '--short', 'HEAD'], { cwd });
  if (!b) throw new UsageError('HEAD is detached — name the branch to push (git push origin <branch>)');
  return b;
}

function defaultRemote(cwd, branch) {
  return tryOut(['config', '--get', `branch.${branch}.pushRemote`], { cwd })
    || tryOut(['config', '--get', 'remote.pushDefault'], { cwd })
    || tryOut(['config', '--get', `branch.${branch}.remote`], { cwd })
    || 'origin';
}

function remoteUrl(cwd, remote, push = false) {
  const url = tryOut(['remote', 'get-url', ...(push ? ['--push'] : []), remote], { cwd });
  if (!url) throw new UsageError(`'${remote}' is not a remote of this repository`);
  return url;
}

async function push(cwd, args) {
  const o = parsePush(args);
  const here = o.specs.length ? null : currentBranch(cwd);
  const remote = o.remote || defaultRemote(cwd, here);
  const url = remoteUrl(cwd, remote, true);
  const specs = o.specs.length ? o.specs : [here];
  let code = 0;
  for (const spec of specs) {
    const [src, dstGiven] = spec.split(':');
    const sha = out(['rev-parse', '--verify', `${src}^{commit}`], { cwd });
    let dst = dstGiven;
    if (!dst) {
      const merge = tryOut(['config', '--get', `branch.${src}.merge`], { cwd });
      const upRemote = tryOut(['config', '--get', `branch.${src}.remote`], { cwd });
      dst = merge && upRemote === remote ? merge.replace(/^refs\/heads\//, '') : src.replace(/^refs\/heads\//, '');
    }
    dst = dst.replace(/^refs\/heads\//, '');
    const tracking = `refs/remotes/${remote}/${dst}`;
    const old = tryOut(['rev-parse', '--verify', '--quiet', tracking], { cwd });
    if (old === sha) {
      if (!o.quiet) say('Everything up-to-date');
      if (o.upstream) git(['branch', `--set-upstream-to=${remote}/${dst}`, src], { cwd, allowFail: true });
      continue;
    }
    if (o.verify) {
      const hooksPath = tryOut(['config', '--get', 'core.hooksPath'], { cwd });
      const hookFile = hooksPath
        ? path.resolve(out(['rev-parse', '--show-toplevel'], { cwd }), hooksPath, 'pre-push')
        : path.resolve(cwd, out(['rev-parse', '--git-path', 'hooks/pre-push'], { cwd }));
      if (isExecutable(hookFile)) {
        const hook = spawnSync(hookFile, [remote, url], {
          cwd, input: `refs/heads/${src} ${sha} refs/heads/${dst} ${old || '0'.repeat(40)}\n`, stdio: ['pipe', 'inherit', 'inherit'],
        });
        if (hook.status !== 0) { say('error: the pre-push hook refused this push'); return 1; }
      }
    }
    if (o.dryRun) { say(`To ${url}\n   ${old ? old.slice(0, 7) : '[new]'}..${sha.slice(0, 7)}  ${src} -> ${dst} (dry run)`); continue; }

    let res = await guard({ tool: 'git', op: 'push', url, sha, branch: dst, bundle: bundleFor(cwd, sha, remote) });
    if (res.retryFull) res = await guard({ tool: 'git', op: 'push', url, sha, branch: dst, bundle: bundleFor(cwd, sha, null) });
    if (res.code !== 0) {
      process.stderr.write(res.stderr || '');
      code = res.code;
      continue;
    }
    git(['update-ref', tracking, sha], { cwd });
    if (o.upstream) git(['branch', `--set-upstream-to=${remote}/${dst}`, src], { cwd, allowFail: true });
    if (!o.quiet) say(`To ${url}\n   ${old ? `${old.slice(0, 7)}..${sha.slice(0, 7)}` : '* [new branch]     '}  ${src} -> ${dst}`);
  }
  return code;
}

/** Base64 bundle of `sha` minus what `remote`'s tracking refs already have; null if nothing new. */
export function bundleFor(cwd, sha, remote) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'box-push-'));
  const ref = `refs/coding-box/push-${process.pid}`;
  try {
    git(['update-ref', ref, sha], { cwd });
    const file = path.join(tmp, 'push.bundle');
    const r = git(['bundle', 'create', '-q', file, ref, ...(remote ? ['--not', `--remotes=${remote}`] : [])], { cwd, allowFail: true });
    if (r.status !== 0 || !fs.existsSync(file)) return null; // nothing new: the remote has every object
    return fs.readFileSync(file).toString('base64');
  } finally {
    git(['update-ref', '-d', ref], { cwd, allowFail: true });
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ── fetch / pull ────────────────────────────────────────────────────────────

export function parseFetch(args) {
  const o = { all: false, prune: false, quiet: false, positional: [] };
  for (const a of args) {
    if (a === '--all') o.all = true;
    else if (a === '-p' || a === '--prune') o.prune = true;
    else if (a === '-q' || a === '--quiet') o.quiet = true;
    else if (['-v', '--verbose', '--tags', '-t', '--no-tags', '--progress', '--no-progress', '--recurse-submodules=no', '--no-recurse-submodules'].includes(a)) { /* tags always come */ }
    else if (a.startsWith('-')) throw new UsageError(`git fetch ${a} is not supported from the box`);
    else o.positional.push(a);
  }
  const [remote, ...specs] = o.positional;
  return { ...o, remote: remote || null, specs };
}

async function fetchRemote(cwd, remote, { prune = false, quiet = false, specs = [] } = {}) {
  const url = remoteUrl(cwd, remote);
  const have = out(['for-each-ref', '--format=%(objectname)', `refs/remotes/${remote}`, 'refs/tags'], { cwd }).split('\n').filter(Boolean);
  const res = await guard({ tool: 'git', op: 'fetch', url, have: [...new Set(have)] });
  if (res.code !== 0) { process.stderr.write(res.stderr || ''); return res.code; }
  if (res.bundle) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'box-fetch-'));
    try {
      const file = path.join(tmp, 'fetch.bundle');
      fs.writeFileSync(file, Buffer.from(res.bundle, 'base64'));
      git(['bundle', 'unbundle', file], { cwd });
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
  const seen = new Set();
  const fetchHead = [];
  for (const { sha, ref } of res.refs) {
    if (ref.startsWith('refs/heads/')) {
      const branch = ref.slice('refs/heads/'.length);
      const tracking = `refs/remotes/${remote}/${branch}`;
      seen.add(tracking);
      const old = tryOut(['rev-parse', '--verify', '--quiet', tracking], { cwd });
      if (old !== sha) {
        git(['update-ref', tracking, sha], { cwd });
        if (!quiet) say(`   ${old ? `${old.slice(0, 7)}..${sha.slice(0, 7)}` : '* [new branch]     '}  ${branch} -> ${remote}/${branch}`);
      }
      const wanted = specs.length ? specs.includes(branch) : false;
      fetchHead.push(`${sha}\t${wanted ? '' : 'not-for-merge'}\tbranch '${branch}' of ${url}`);
    } else if (ref.startsWith('refs/tags/')) {
      if (!tryOut(['rev-parse', '--verify', '--quiet', ref], { cwd })) git(['update-ref', ref, sha], { cwd, allowFail: true });
    }
  }
  if (prune) {
    for (const tracking of out(['for-each-ref', '--format=%(refname)', `refs/remotes/${remote}`], { cwd }).split('\n').filter(Boolean)) {
      if (!seen.has(tracking) && !tracking.endsWith('/HEAD')) {
        git(['update-ref', '-d', tracking], { cwd });
        if (!quiet) say(` - [deleted]  ${tracking.replace('refs/remotes/', '')}`);
      }
    }
  }
  const gitDir = out(['rev-parse', '--absolute-git-dir'], { cwd });
  fs.writeFileSync(path.join(gitDir, 'FETCH_HEAD'), `${fetchHead.sort((a, b) => a.includes('not-for-merge') - b.includes('not-for-merge')).join('\n')}\n`);
  if (!quiet && res.stderr) process.stderr.write(res.stderr);
  return 0;
}

async function fetchCmd(cwd, args) {
  const o = parseFetch(args);
  const remotes = o.all ? out(['remote'], { cwd }).split('\n').filter(Boolean) : [o.remote || defaultRemote(cwd, tryOut(['symbolic-ref', '--quiet', '--short', 'HEAD'], { cwd }) || 'HEAD')];
  let code = 0;
  for (const r of remotes) code = (await fetchRemote(cwd, r, { prune: o.prune, quiet: o.quiet, specs: o.specs })) || code;
  return code;
}

export function parsePull(args) {
  const o = { rebase: null, ffOnly: false, quiet: false, noEdit: false, positional: [] };
  for (const a of args) {
    if (a === '--rebase' || a === '-r' || a === '--rebase=true') o.rebase = true;
    else if (a === '--no-rebase' || a === '--rebase=false') o.rebase = false;
    else if (a === '--ff-only') o.ffOnly = true;
    else if (a === '--no-edit') o.noEdit = true;
    else if (a === '-q' || a === '--quiet') o.quiet = true;
    else if (['--ff', '-v', '--verbose', '--no-recurse-submodules', '--autostash'].includes(a)) { /* default behaviour */ }
    else if (a.startsWith('-')) throw new UsageError(`git pull ${a} is not supported from the box — git fetch, then merge or rebase`);
    else o.positional.push(a);
  }
  const [remote, branch] = o.positional;
  return { ...o, remote: remote || null, branch: branch || null };
}

async function pull(cwd, args) {
  const o = parsePull(args);
  const here = currentBranch(cwd);
  const remote = o.remote || tryOut(['config', '--get', `branch.${here}.remote`], { cwd }) || 'origin';
  const branch = o.branch || (tryOut(['config', '--get', `branch.${here}.merge`], { cwd }) || '').replace(/^refs\/heads\//, '') || null;
  if (!branch) throw new UsageError(`no upstream for '${here}' — git pull <remote> <branch>`);
  const code = await fetchRemote(cwd, remote, { quiet: o.quiet, specs: [branch] });
  if (code) return code;
  const target = `refs/remotes/${remote}/${branch}`;
  const rebase = o.rebase ?? (tryOut(['config', '--get', `branch.${here}.rebase`], { cwd }) || tryOut(['config', '--get', 'pull.rebase'], { cwd })) === 'true';
  const ffOnly = o.ffOnly || tryOut(['config', '--get', 'pull.ff'], { cwd }) === 'only';
  const argv = rebase ? ['rebase', target] : ['merge', ...(ffOnly ? ['--ff-only'] : []), ...(o.noEdit ? ['--no-edit'] : []), target];
  return git(argv, { cwd, allowFail: true, stdio: 'inherit' }).status ?? 1;
}

async function lsRemote(cwd, args) {
  const flags = args.filter((a) => a.startsWith('-'));
  for (const f of flags) if (!['--heads', '-h', '--tags', '-t', '-q', '--quiet', '--refs'].includes(f)) throw new UsageError(`git ls-remote ${f} is not supported from the box`);
  const [remote, ...patterns] = args.filter((a) => !a.startsWith('-'));
  const url = remoteUrl(cwd, remote || 'origin');
  const res = await guard({ tool: 'git', op: 'ls-remote', url, heads: flags.some((f) => f === '--heads' || f === '-h'), tags: flags.some((f) => f === '--tags' || f === '-t'), patterns });
  process.stdout.write(res.stdout || '');
  process.stderr.write(res.stderr || '');
  return res.code;
}

// ── gh ──────────────────────────────────────────────────────────────────────

/** --body-file / -F (pr & issue writes) read a file the host must not: inline it. */
export function inlineBodyFile(args, read = (f) => fs.readFileSync(f === '-' ? 0 : f, 'utf8')) {
  const [group] = args;
  if (group !== 'pr' && group !== 'issue') return args;
  const outArgs = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--body-file' || a === '-F') { outArgs.push('--body', read(args[++i])); continue; }
    if (a.startsWith('--body-file=')) { outArgs.push('--body', read(a.slice('--body-file='.length))); continue; }
    outArgs.push(a);
  }
  return outArgs;
}

async function gh(args) {
  if (!args.length || args[0] === '--help' || args[0] === 'help') {
    say('gh in the agent box runs on the host through the guard, for this repository only:\n  reads: run list|view, pr list|view|checks|diff|status, issue list|view, workflow list|view, repo view, release list|view, api <GET repos/{owner}/{repo}/…>\n  free:  run rerun\n  asks for your approval: pr create|merge|comment|…, issue create|comment|…, run cancel, workflow run');
    return 0;
  }
  const cwd = process.cwd();
  const remote = tryOut(['config', '--get', 'remote.origin.url'], { cwd }) || out(['remote', 'get-url', out(['remote'], { cwd }).split('\n')[0]], { cwd });
  const res = await guard({ tool: 'gh', args: inlineBodyFile(args), url: remote });
  process.stdout.write(res.stdout || '');
  process.stderr.write(res.stderr || '');
  return res.code;
}

// ── main ────────────────────────────────────────────────────────────────────

export async function main(argv) {
  const [tool, ...rest] = argv;
  try {
    if (tool === 'gh') return await gh(rest);
    const { global, verb, rest: args } = splitGlobal(rest);
    const cwd = cwdOf(global);
    if (verb === 'push') return await push(cwd, args);
    if (verb === 'fetch') return await fetchCmd(cwd, args);
    if (verb === 'pull') return await pull(cwd, args);
    if (verb === 'ls-remote') return await lsRemote(cwd, args);
    return spawnSync(GIT, rest, { stdio: 'inherit' }).status ?? 1;
  } catch (err) {
    say(`${tool === 'gh' ? 'gh' : 'git'} (agent box): ${err.message}`);
    return err.exitCode ?? (err instanceof UsageError ? 2 : 1);
  }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(new URL(import.meta.url).pathname)) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
