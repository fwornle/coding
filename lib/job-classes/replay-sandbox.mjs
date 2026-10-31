/**
 * The sandbox a past turn is replayed in (.planning/shared-job-classes.md, P4 build).
 *
 * The threat is not kgbench's. kgbench hides an answer key; a replay must hide
 * THE FUTURE — everything that happened after the turn — while reproducing what
 * the turn saw. Each control below is one the spike found by a replay that leaked:
 *
 *  - NOT A GIT WORKTREE. A worktree shares the live repo's objects and refs, so
 *    `git log main` shows commits made after the turn. The tree is a standalone
 *    repo holding ONE commit, fetched at depth 1, plus the captured dirty patch and
 *    untracked files (turn-capture.mjs). Submodules the same way, from their own
 *    live checkouts.
 *  - THE CONVERSATION AS TEXT, NOT A RESUMED SESSION. The proxy's turn record
 *    holds the conversation before the turn in one neutral shape for every agent
 *    (rapid-llm-proxy proxy-bridge/turn-record.mjs). renderPrompt() hands it to a
 *    FRESH session of the agent as context, then the person's message. Less exact
 *    than resuming the agent's own session (tool results become text), but the
 *    same for every agent and identical for every arm, which is what a comparison
 *    needs; the A/A floor measures what it costs. A fresh session also writes
 *    into no agent's session store and runs under the agent's own login, so a
 *    replay needs no credential of its own.
 *  - REWRITE PATHS, DO NOT STRIP INPUTS. The conversation and the repo's rule
 *    files are the turn's inputs ("remove the answer key, never the answers").
 *    Every spelling of the live repo path in the rendered conversation — absolute,
 *    `~/…`, redacted — becomes the sandbox path.
 *  - AN OS SANDBOX UNDER THE TOOL RULES. `sandbox-exec` denies reads of the live
 *    repos, the data home and the agents' session stores, and all network but the
 *    proxy. A permission pattern matched at a word boundary only; this held where
 *    it failed.
 *  - A PRE-RUN "NO FUTURE" CHECK that refuses to run, the way kgbench refuses a
 *    leaked tree: one commit, no later than the turn; no live path left in the
 *    prompt.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

/** Under /tmp, not os.tmpdir(): no CLAUDE.md or AGENTS.md ancestor (experiment-restore.mjs CELL_SANDBOX_ROOT). */
export const SANDBOX_ROOT = (() => {
  const configured = process.env.CODING_REPLAY_SANDBOX_ROOT;
  const base = configured || path.join(fs.existsSync('/tmp') ? '/tmp' : os.tmpdir(), 'coding-job-class-replays');
  fs.mkdirSync(base, { recursive: true });
  return fs.realpathSync(base);
})();

/** A commit may be stamped a little after the prompt that preceded it only by clock skew; anything later is the future. */
const COMMIT_SLACK_MS = 60 * 1000;
const GIT_TIMEOUT_MS = 120_000;

function git(args, cwd, { input, allowFail = false } = {}) {
  const r = spawnSync('git', args, { cwd, input, encoding: 'utf8', timeout: GIT_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 });
  if (!allowFail && (r.error || r.status !== 0)) {
    throw new Error(`git ${args.slice(0, 3).join(' ')} failed in ${cwd}: ${(r.stderr || r.error?.message || '').trim().slice(0, 300)}`);
  }
  return r;
}

/**
 * One commit of `liveRepo`, alone, at `dir`. Depth 1 and no tags, so no other
 * commit — earlier or later — is in the object store. `-c` options reach the
 * local upload-pack, which must allow a want by SHA.
 */
function fetchOneCommit(liveRepo, sha, dir, branch) {
  fs.mkdirSync(dir, { recursive: true });
  git(['init', '-q', '-b', branch || 'main'], dir);
  git(['-c', 'protocol.file.allow=always', '-c', 'uploadpack.allowAnySHA1InWant=true',
    'fetch', '-q', '--depth=1', '--no-tags', `file://${liveRepo}`, sha], dir);
  git(['checkout', '-q', '-B', branch || 'main', 'FETCH_HEAD'], dir);
  // FETCH_HEAD names the live repo's path; nothing in the tree should.
  fs.rmSync(path.join(dir, '.git', 'FETCH_HEAD'), { force: true });
}

/** The commit that was HEAD on `branch` at `atIso` — for a turn with no capture (parity gap: no dirty state). */
export function commitAt(liveRepo, branch, atIso) {
  const r = git(['rev-list', '-1', `--before=${atIso}`, branch || 'HEAD'], liveRepo, { allowFail: true });
  return r.status === 0 ? r.stdout.trim() || null : null;
}

/**
 * Build the turn's repo at `dir`: one commit, then the captured dirty state.
 *
 * @param {object} o
 * @param {object} o.capture  turn-capture meta + dir, or null (uncaptured: HEAD's commit at the prompt's time)
 * @param {string} o.liveRepo the checkout the turn ran in
 * @param {string} o.at       when the person sent the prompt (ISO)
 * @param {string} o.dir
 * @param {boolean} [o.submodules=true]
 * @returns {{sha: string, branch: string, gaps: string[]}}
 */
export function buildTree({ capture, liveRepo, at, dir, submodules = true }) {
  const gaps = [];
  if (!liveRepo) throw new Error('the turn\'s checkout is unknown');
  const branch = capture?.meta.branch || 'main';
  let sha = capture?.meta.sha;
  if (!sha) {
    sha = commitAt(liveRepo, 'HEAD', at);
    if (!sha) throw new Error(`no commit before ${at} in ${liveRepo}`);
    gaps.push('no capture: today\'s branch at the prompt\'s time, without the working tree\'s uncommitted state');
  }
  fetchOneCommit(liveRepo, sha, dir, branch);

  if (capture) {
    const patch = path.join(capture.dir, 'dirty.patch');
    if (fs.existsSync(patch) && fs.statSync(patch).size) git(['apply', '--binary', '--whitespace=nowarn', patch], dir);
    const ut = path.join(capture.dir, 'untracked');
    if (fs.existsSync(ut)) fs.cpSync(ut, dir, { recursive: true });
  }

  if (submodules) {
    const subs = capture?.meta.submodules || [];
    for (const s of subs) {
      if (!s.sha) continue;
      const live = path.join(liveRepo, s.path);
      const target = path.join(dir, s.path);
      try {
        fs.rmSync(target, { recursive: true, force: true });
        fetchOneCommit(live, s.sha, target, 'main');
        if (s.patch) git(['apply', '--binary', '--whitespace=nowarn', path.join(capture.dir, 'submodules', s.patch)], target);
      } catch (err) {
        gaps.push(`submodule ${s.path}: ${err.message.split('\n')[0]}`);
      }
    }
    if (!capture) gaps.push('no capture: submodules left empty');
  } else gaps.push('submodules not restored');
  gaps.push('git-ignored files (e.g. .data/) are not in the tree');
  return { sha, branch, gaps };
}

/** Every spelling of a live path that a conversation may carry. */
export function pathSpellings(livePath, home = os.homedir()) {
  const out = new Set([livePath]);
  if (livePath.startsWith(`${home}/`)) {
    const rest = livePath.slice(home.length);
    out.add(`~${rest}`);
    // The redactor replaces the user name in a home path (LSL, observations, injected digests).
    out.add(`${path.dirname(home)}/<USER_ID_REDACTED>${rest}`);
  }
  return [...out].sort((a, b) => b.length - a.length);
}

/** Characters of one rendered conversation item; the proxy already capped each at 4,000. */
const RENDER_ITEM_CHARS = 4_000;

/**
 * The prompt a replay arm is given: the conversation before the turn as context,
 * then the person's message — from the proxy's turn record, the same for every
 * agent and every arm. Live paths become the sandbox path.
 *
 * @param {object} record  turns/<conversation>-t<turn>.json
 * @returns {string}
 */
export function renderPrompt(record, { liveRepo, sandboxPath }) {
  const label = (it) => (it.role === 'tool' ? 'tool result' : it.name ? `${it.role} tool call` : it.role);
  const lines = (record.history || []).map((it) => `[${label(it)}]\n${String(it.text || '').slice(0, RENDER_ITEM_CHARS)}`);
  let text = lines.length
    ? [
      'This conversation continues in a fresh session. Its earlier part is below as context only: tool results in it may be out of date, and the files in the current directory are as they were when the person sent the message at the end.',
      ...(record.historyOmitted ? [`(${record.historyOmitted} earlier items are not shown.)`] : []),
      '',
      '<earlier-conversation>',
      lines.join('\n\n'),
      '</earlier-conversation>',
      '',
      'The person\'s message, which is what to answer now:',
      '',
      record.prompt,
    ].join('\n')
    : record.prompt;
  if (liveRepo && sandboxPath) for (const s of pathSpellings(liveRepo)) text = text.split(s).join(sandboxPath);
  return text;
}

/**
 * Refuse to run when the sandbox can see past the turn.
 *
 * @returns {string[]} violations; empty means clean
 */
export function futureLeaks({ tree, turnAt, promptText, liveRepo, submoduleDirs = [] }) {
  const v = [];
  const at = Date.parse(turnAt);
  for (const dir of [tree, ...submoduleDirs]) {
    if (!fs.existsSync(path.join(dir, '.git'))) continue;
    const all = git(['rev-list', '--all'], dir, { allowFail: true }).stdout.trim().split('\n').filter(Boolean);
    if (all.length !== 1) v.push(`${path.relative(tree, dir) || '.'}: ${all.length} commits reachable, expected 1`);
    const ts = Number(git(['log', '-1', '--format=%ct'], dir, { allowFail: true }).stdout.trim()) * 1000;
    if (ts && ts > at + COMMIT_SLACK_MS) v.push(`${path.relative(tree, dir) || '.'}: HEAD committed ${new Date(ts).toISOString()}, after the turn`);
    const remotes = git(['remote'], dir, { allowFail: true }).stdout.trim();
    if (remotes) v.push(`${path.relative(tree, dir) || '.'}: has remotes (${remotes})`);
  }
  for (const s of pathSpellings(liveRepo)) if (promptText.includes(s)) { v.push(`the prompt still names ${s}`); break; }
  return v;
}

/**
 * What the replay may read, write and reach (macOS sandbox-exec SBPL).
 *
 * Reads denied: every live repo (~/Agentic), the data home (~/.coding, which holds
 * the turn records and the token DB), legacy history (~/.specstory) and the
 * agents' session stores — each holds the turn's own conversation through to its
 * end, which is the future. The agents' config dirs stay readable and writable:
 * each runs under its own login. Network: the proxy port on loopback, nothing
 * else, so a `curl` to a live service cannot read today's state and no web tool
 * can run.
 *
 * Not covered: opencode keeps its sessions in a database beside its auth, so its
 * history stays readable to a tool that goes looking (a recorded gap).
 */
export const SESSION_STORES = ['.claude/projects', '.copilot/session-state', '.pi/agent/sessions'];
const AGENT_STATE = ['.claude', '.claude.json', '.claude.json.backup', '.copilot', '.pi', '.config/opencode', '.local/share/opencode', '.local/state/opencode', '.cache', 'Library/Caches'];

export function sandboxProfile({ sandboxDir, home = os.homedir(), proxyPort = 12435, denyRead = [] }) {
  const q = (p) => JSON.stringify(p);
  const sub = (rels) => rels.map((r) => `(subpath ${q(path.join(home, r))})`).join(' ');
  const stores = sub(SESSION_STORES);
  const reads = [path.join(home, 'Agentic'), path.join(home, '.coding'), path.join(home, '.specstory'), ...denyRead];
  return [
    '(version 1)',
    '(allow default)',
    '(deny file-write*)',
    `(allow file-write* (subpath ${q(sandboxDir)}) (subpath "/private/tmp") (subpath "/private/var/folders") (literal "/dev/null") (literal "/dev/tty") (regex #"^/dev/fd/") ${sub(AGENT_STATE)})`,
    // Last, so nothing above re-opens them: a later rule wins.
    `(deny file-read* file-write* ${reads.map((p) => `(subpath ${q(p)})`).join(' ')} ${stores})`,
    '(deny network-outbound)',
    `(allow network-outbound (remote ip "localhost:${proxyPort}") (remote unix-socket))`,
    '',
  ].join('\n');
}

/**
 * The tree's content as one hash: HEAD, the tracked diff and every untracked file.
 * Two arms of one turn must start from the same digest, or their comparison is of
 * two different inputs.
 */
export function treeDigest(dir) {
  const h = crypto.createHash('sha256');
  h.update(git(['rev-parse', 'HEAD'], dir).stdout);
  h.update(git(['diff', 'HEAD', '--binary'], dir).stdout);
  const untracked = git(['ls-files', '--others', '--exclude-standard', '-z'], dir).stdout.split('\0').filter(Boolean).sort();
  for (const rel of untracked) {
    h.update(rel);
    try { h.update(fs.readFileSync(path.join(dir, rel))); } catch { h.update('unreadable'); }
  }
  return h.digest('hex');
}
