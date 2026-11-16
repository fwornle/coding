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
 * an approval (rule `gh:<group> <verb>`). Anything else is ELEVATED: it runs
 * only after an approval too, never outright — another repo (`-R`/`--repo`,
 * `--hostname`; rule `gh:<group> <verb> @<host>/<owner>/<repo>`), a verb
 * outside the vocabulary (`gh:<group> <verb>`), or `gh api` beyond a GET of
 * this repo (`gh:api <METHOD> <endpoint>`). An elevated call runs in an empty
 * directory and may not name a host path, so an approval never hands out a
 * host file. Never, approved or not: the groups that print or change the
 * host's gh credentials and config or open host apps (GH_NEVER_GROUPS), and
 * host files — `@file` arguments, --body-file and --input are refused (the box
 * client inlines --body-file).
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

/**
 * Never for the box, approved or not: these print or change the host's gh
 * credentials and configuration (a token in the box is the box with your
 * login), or open apps on the host.
 */
export const GH_NEVER_GROUPS = new Set(['auth', 'config', 'extension', 'alias', 'ssh-key', 'gpg-key', 'codespace', 'browse']);
const GH_REFUSED_FLAGS = new Set(['-w', '--web', '--body-file', '--input', '-e', '--editor']);
const GH_TARGET_FLAGS = new Set(['-R', '--repo', '--hostname']);
const GH_API_BODY_FLAGS = new Set(['-f', '-F', '--field', '--raw-field']);
const GH_API_VALUE_FLAGS = ['-X', '--method', '-q', '--jq', '-H', '--header', '-t', '--template', '--cache', '-f', '-F', '--field', '--raw-field'];
const OWNER_REPO_RE = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const MAX_GH_ARGS = 40;
const MAX_GH_ARG = 64 * 1024;

const inGroup = (table, group, verb) => (table[group] || []).includes(verb);

/** `[HOST/]OWNER/REPO` as gh takes it for -R; host null when not given. */
export function parseRepoSpec(spec) {
  const parts = String(spec ?? '').replace(/\.git$/, '').split('/');
  const host = parts.length === 3 ? parts[0].toLowerCase() : null;
  const ownerRepo = parts.slice(-2).join('/');
  if (parts.length < 2 || parts.length > 3 || (host && !HOST_RE.test(host)) || !OWNER_REPO_RE.test(ownerRepo) || ownerRepo.split('/').some((p) => p === '.' || p === '..')) {
    throw new VcsError(`gh --repo '${spec}' is not [HOST/]OWNER/REPO`);
  }
  return { host, ownerRepo };
}

/** An argument that names a host path; an elevated call may not have one. */
const hostPath = (a) => /^(\/|~)/.test(a) || /(^|[/=])\.\.([/]|$)/.test(a) || /^[A-Za-z0-9_-]+=(\/|~)/.test(a);

/**
 * The gh argv and env for one call. `remote` is the parsed pinned remote.
 * Returns { gated, elevated, rule, argv, env }. `gated` calls need a grant
 * for `rule`; `elevated` ones also run in an empty directory.
 */
export function ghPlan(args, remote) {
  if (!Array.isArray(args) || !args.length || args.length > MAX_GH_ARGS) throw new VcsError(`gh needs 1..${MAX_GH_ARGS} arguments`);
  for (const a of args) if (typeof a !== 'string' || a.length > MAX_GH_ARG) throw new VcsError('gh arguments must be strings');
  if (!remote.ownerRepo) throw new VcsError(`cannot tell owner/repo from '${remote.url}'`);
  // -R/--repo/--hostname choose the repo: taken out of argv, into GH_REPO/GH_HOST.
  let spec = null;
  let hostname = null;
  const argv = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const [flag, ...inline] = a.split('=');
    if (GH_TARGET_FLAGS.has(flag)) {
      const value = inline.length ? inline.join('=') : args[++i];
      if (value === undefined) throw new VcsError(`gh ${flag} needs a value`);
      if (flag === '--hostname') {
        if (!HOST_RE.test(value)) throw new VcsError(`gh --hostname '${value}' is not a host name`);
        hostname = value.toLowerCase();
      } else spec = parseRepoSpec(value);
      continue;
    }
    if (GH_REFUSED_FLAGS.has(flag)) throw new VcsError(`gh ${flag} is not available from the box (no host files, no browser, no editor)`);
    if (a.startsWith('@') || /=@/.test(a)) throw new VcsError('gh @file arguments would read host files — pass the content instead');
    argv.push(a);
  }
  const host = spec?.host ?? hostname ?? remote.host;
  const ownerRepo = spec?.ownerRepo ?? remote.ownerRepo;
  const away = host !== remote.host || ownerRepo.toLowerCase() !== remote.ownerRepo.toLowerCase();
  const target = `${host}/${ownerRepo}`;
  const at = away ? ` @${target}` : '';
  const env = { GH_REPO: host === 'github.com' ? ownerRepo : target, GH_HOST: host, GH_PROMPT_DISABLED: '1', NO_COLOR: '1', GH_NO_UPDATE_NOTIFIER: '1' };
  const [group, verb] = argv;
  if (!group) throw new VcsError('gh needs a command');
  if (GH_NEVER_GROUPS.has(group)) {
    throw new VcsError(`gh ${group} is never available from the box, approved or not (it would hand the box your gh login or act on host apps) — run it in a host shell`);
  }

  if (group === 'api') {
    const rest = argv.slice(1);
    let method = 'GET';
    let body = false;
    for (let i = 0; i < rest.length; i++) {
      const flag = rest[i].split('=')[0];
      if (GH_API_BODY_FLAGS.has(flag)) body = true;
      if (flag === '-X' || flag === '--method') method = String(rest[i].includes('=') ? rest[i].split('=')[1] : rest[i + 1]).toUpperCase();
    }
    if (!/^[A-Z]{3,7}$/.test(method)) throw new VcsError(`gh api: bad method '${method}'`);
    // -f/-F turn a GET into a POST unless a method is named.
    if (body && !rest.some((a) => /^(-X|--method)(=|$)/.test(a))) method = 'POST';
    const endpoint = rest.find((a, i) => !a.startsWith('-') && !GH_API_VALUE_FLAGS.includes(rest[i - 1]));
    if (!endpoint) throw new VcsError('gh api needs an endpoint');
    const repoPath = endpoint.replace(/^\//, '').split('?')[0];
    if (/\.\./.test(repoPath) || /\s/.test(repoPath)) throw new VcsError(`gh api: bad endpoint '${endpoint}'`);
    const ownRepo = !away && (repoPath.startsWith('repos/{owner}/{repo}') || repoPath.toLowerCase().startsWith(`repos/${remote.ownerRepo.toLowerCase()}`));
    if (ownRepo && method === 'GET' && !body) return { gated: false, elevated: false, rule: null, argv, env };
    return { gated: true, elevated: true, rule: `gh:api ${method} ${repoPath}${at}`, argv, env };
  }
  if (inGroup(GH_READ, group, verb) || inGroup(GH_FREE, group, verb)) {
    return { gated: away, elevated: away, rule: away ? `gh:${group} ${verb}${at}` : null, argv, env };
  }
  if (inGroup(GH_GATED, group, verb)) return { gated: true, elevated: away, rule: `gh:${group} ${verb}${at}`, argv, env };
  // Outside the vocabulary: elevated, and kept off host files.
  const named = argv.find(hostPath);
  if (named) throw new VcsError(`gh ${group} ${verb ?? ''}: '${named}' names a host path — an approved gh call runs in an empty directory and may not read or write host files`);
  return { gated: true, elevated: true, rule: `gh:${group}${verb && !verb.startsWith('-') ? ` ${verb}` : ''}${at}`, argv, env };
}
