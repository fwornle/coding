/**
 * `git push|fetch|pull|ls-remote` and `gh` for an agent in the box.
 *
 * The box has no credentials and its network reaches only the LLM proxy and
 * the guard (docker/agent-box/gate/). So the host guard daemon does the
 * network part on the box's behalf — and NEVER runs git inside the agent's
 * repo: that repo's .git/config and hooks are agent-writable, and git executes
 * what they name (core.fsmonitor, core.sshCommand, credential.helper, hooks…).
 * Instead the daemon keeps its own bare mirror per remote and the two sides
 * swap git BUNDLES (pure data) over HTTP:
 *
 *   push   box bundles its new commits → daemon unbundles into the mirror and
 *          pushes <sha>:refs/heads/<branch> to the PINNED url. Never forced,
 *          never a delete.
 *   fetch  daemon fetches the pinned url into the mirror and returns a bundle
 *          of what the box lacks plus the ref list; the box applies it.
 *
 * Remotes are pinned per workspace: the launcher reports the repo's remotes at
 * box registration (host-side, before the agent runs); the first report is the
 * baseline, any later new url needs an approval (rule `vcs:remote <url>`). Only
 * https://, ssh:// and scp-like user@host:path urls are accepted — never a
 * local path, file:// or ext:: (those would read/write host directories or run
 * a command).
 *
 * `gh` runs a fixed vocabulary with GH_REPO fixed to the pinned remote: reads
 * freely, `run rerun` freely, writes (pr create/merge/comment, …) only after
 * an approval (rule `gh:<group> <verb>`). No host files: `@file` arguments,
 * --body-file and --input are refused (the box client inlines --body-file).
 *
 * Everything here is pure; the daemon supplies the runners.
 */

export class VcsError extends Error {}

const HOST_RE = /^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,252})$/;
const PATH_RE = /^[A-Za-z0-9._~/-]+$/;
const REF_RE = /^(?!-)(?!.*\.\.)(?!.*\/\/)(?!.*\.lock$)[A-Za-z0-9._/-]{1,250}$/;
const SHA_RE = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

/** Parse a remote url we are willing to use from the host, or throw. */
export function parseRemoteUrl(url) {
  if (typeof url !== 'string' || url.length > 500 || /\s/.test(url)) throw new VcsError('remote url must be a plain string');
  let host;
  let rest;
  let m;
  if ((m = /^https:\/\/(?:[^@/]+@)?([^/:]+)(?::\d{1,5})?\/(.+)$/.exec(url))) [, host, rest] = m;
  else if ((m = /^ssh:\/\/(?:[A-Za-z0-9._-]+@)?([^/:]+)(?::\d{1,5})?\/(.+)$/.exec(url))) [, host, rest] = m;
  else if ((m = /^[A-Za-z0-9._-]+@([^/:]+):(?!\/)(.+)$/.exec(url))) [, host, rest] = m;
  else throw new VcsError(`remote '${url}' is not an https://, ssh:// or user@host:path url (local paths and other transports are refused)`);
  if (!HOST_RE.test(host)) throw new VcsError(`bad host in remote '${url}'`);
  if (!PATH_RE.test(rest) || rest.split('/').some((s) => s === '..' || s === '.')) throw new VcsError(`bad path in remote '${url}'`);
  const parts = rest.replace(/\.git$/, '').replace(/\/$/, '').split('/');
  const ownerRepo = parts.length >= 2 ? parts.slice(-2).join('/') : null;
  return { url, host: host.toLowerCase(), ownerRepo };
}

export function validRef(name) {
  return typeof name === 'string' && REF_RE.test(name);
}

export function validSha(sha) {
  return typeof sha === 'string' && SHA_RE.test(sha);
}

/**
 * Resolve the remote urls a launcher reported: relative submodule urls
 * (`../x.git`) against the superproject's origin; invalid ones dropped.
 */
export function normaliseRemotes(urls, originUrl = null) {
  const out = new Set();
  for (const raw of urls || []) {
    let url = String(raw || '').trim();
    if (!url) continue;
    if (/^\.\.?\//.test(url) && originUrl) {
      const base = originUrl.replace(/\.git$/, '').split('/');
      let rel = url;
      while (rel.startsWith('../')) { base.pop(); rel = rel.slice(3); }
      if (rel.startsWith('./')) rel = rel.slice(2);
      url = `${base.join('/')}/${rel}`;
    }
    try { out.add(parseRemoteUrl(url).url); } catch { /* not pinnable */ }
  }
  return [...out];
}

/**
 * Pin update at box registration. First report for a workspace = baseline;
 * later, unknown urls are NOT added (they need `vcs:remote <url>` approval).
 */
export function pinRemotes(pins, workspace, reported) {
  if (!pins[workspace]) return { pins: { ...pins, [workspace]: [...reported] }, added: [...reported], unpinned: [] };
  const known = new Set(pins[workspace]);
  return { pins, added: [], unpinned: reported.filter((u) => !known.has(u)) };
}

export const GIT_OPS = ['push', 'fetch', 'ls-remote'];

/** Validate a /vcs git request body; returns the normalised op. */
export function gitRequest(body) {
  const { op } = body;
  if (!GIT_OPS.includes(op)) throw new VcsError(`git op must be one of: ${GIT_OPS.join(', ')}`);
  const remote = parseRemoteUrl(body.url);
  if (op === 'push') {
    if (!validSha(body.sha)) throw new VcsError('push needs the commit sha');
    if (!validRef(body.branch)) throw new VcsError(`bad branch name '${body.branch}'`);
    if (body.bundle !== undefined && body.bundle !== null && typeof body.bundle !== 'string') throw new VcsError('bundle must be base64');
    return { op, remote, sha: body.sha, branch: body.branch, bundle: body.bundle || null };
  }
  if (op === 'fetch') {
    const have = Array.isArray(body.have) ? body.have.filter(validSha).slice(0, 5000) : [];
    return { op, remote, have };
  }
  const patterns = Array.isArray(body.patterns) ? body.patterns : [];
  for (const p of patterns) if (!validRef(p)) throw new VcsError(`bad ref pattern '${p}'`);
  return { op, remote, patterns, heads: Boolean(body.heads), tags: Boolean(body.tags) };
}

/** Parse `for-each-ref --format='%(objectname) %(refname)'` output. */
export function parseRefs(text) {
  return String(text || '').split('\n').map((l) => l.trim().split(' ')).filter(([s, r]) => validSha(s) && r).map(([sha, ref]) => ({ sha, ref }));
}

// ── gh ──────────────────────────────────────────────────────────────────────

export const GH_READ = {
  run: ['list', 'view'],
  pr: ['list', 'view', 'checks', 'diff', 'status'],
  issue: ['list', 'view', 'status'],
  workflow: ['list', 'view'],
  repo: ['view'],
  release: ['list', 'view'],
};
/** Writes cheap and harmless enough to run without asking. */
export const GH_FREE = { run: ['rerun'] };
/** Writes that need an approval (rule `gh:<group> <verb>`). */
export const GH_GATED = {
  pr: ['create', 'merge', 'comment', 'close', 'reopen', 'edit', 'ready', 'review'],
  issue: ['create', 'comment', 'close', 'reopen', 'edit'],
  run: ['cancel'],
  workflow: ['run'],
};

const GH_REFUSED_FLAGS = new Set(['-R', '--repo', '--hostname', '-w', '--web', '--body-file', '--input', '-e', '--editor']);
const GH_API_WRITE_FLAGS = new Set(['-f', '-F', '--field', '--raw-field', '--input']);
const MAX_GH_ARGS = 40;
const MAX_GH_ARG = 64 * 1024;

const inGroup = (table, group, verb) => (table[group] || []).includes(verb);

/**
 * The gh argv and env for one call. `remote` is the parsed pinned remote.
 * Returns { gated, rule, argv, env }.
 */
export function ghPlan(args, remote) {
  if (!Array.isArray(args) || !args.length || args.length > MAX_GH_ARGS) throw new VcsError(`gh needs 1..${MAX_GH_ARGS} arguments`);
  for (const a of args) if (typeof a !== 'string' || a.length > MAX_GH_ARG) throw new VcsError('gh arguments must be strings');
  if (!remote.ownerRepo) throw new VcsError(`cannot tell owner/repo from '${remote.url}'`);
  for (const a of args) {
    const flag = a.split('=')[0];
    if (GH_REFUSED_FLAGS.has(flag)) throw new VcsError(`gh ${flag} is not available from the box (the repo is fixed to ${remote.ownerRepo}; no host files, no browser)`);
    if (a.startsWith('@') || /=@/.test(a)) throw new VcsError('gh @file arguments would read host files — pass the content instead');
  }
  const env = { GH_REPO: remote.host === 'github.com' ? remote.ownerRepo : `${remote.host}/${remote.ownerRepo}`, GH_HOST: remote.host, GH_PROMPT_DISABLED: '1', NO_COLOR: '1', GH_NO_UPDATE_NOTIFIER: '1' };
  const [group, verb] = args;

  if (group === 'api') {
    const rest = args.slice(1);
    for (let i = 0; i < rest.length; i++) {
      const flag = rest[i].split('=')[0];
      if (GH_API_WRITE_FLAGS.has(flag)) throw new VcsError(`gh api ${flag} sends a request body — only GET is available from the box`);
      if (flag === '-X' || flag === '--method') {
        const value = rest[i].includes('=') ? rest[i].split('=')[1] : rest[i + 1];
        if (String(value).toUpperCase() !== 'GET') throw new VcsError('gh api: only GET is available from the box');
      }
    }
    const endpoint = rest.find((a, i) => !a.startsWith('-') && !['-X', '--method', '-q', '--jq', '-H', '--header', '-t', '--template', '--cache'].includes(rest[i - 1]));
    const repoPath = endpoint && endpoint.replace(/^\//, '').split('?')[0];
    const ok = repoPath && (repoPath.startsWith('repos/{owner}/{repo}') || repoPath.toLowerCase().startsWith(`repos/${remote.ownerRepo.toLowerCase()}`));
    if (!ok || /\.\./.test(repoPath)) throw new VcsError(`gh api: only endpoints of this repo (repos/{owner}/{repo}/…) are available from the box`);
    return { gated: false, rule: null, argv: args, env };
  }
  if (inGroup(GH_READ, group, verb) || inGroup(GH_FREE, group, verb)) return { gated: false, rule: null, argv: args, env };
  if (inGroup(GH_GATED, group, verb)) return { gated: true, rule: `gh:${group} ${verb}`, argv: args, env };
  const offered = [...Object.entries(GH_READ), ...Object.entries(GH_FREE), ...Object.entries(GH_GATED)]
    .map(([g, vs]) => `${g} ${vs.join('|')}`).join('; ');
  throw new VcsError(`gh ${group} ${verb ?? ''} is not available from the box (offered: ${offered}; api GET)`);
}
