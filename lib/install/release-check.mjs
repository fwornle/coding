/**
 * Is a newer coding release out? (.planning/coding-releases.md P5)
 *
 * The health coordinator runs check() every CHECK_MS and on request; the result
 * lands in ~/.coding/release-check.json, which is all the status line reads
 * (it renders on every prompt and must never touch the network). The dashboard
 * asks the coordinator, which serves the same state.
 *
 * Display only, so it FAILS OPEN: no network, a GitHub hiccup or a broken
 * install record become an `error` in the state and no badge — never a throw,
 * never a retry storm (one attempt per interval; curl's own retries inside it).
 *
 * A dev checkout is never checked: releases do not apply to it.
 * CODING_UPDATE_CHECK=off switches the check off.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

import { latestRelease, releaseBase, runAsync } from './update.mjs';

const require = createRequire(import.meta.url);
const layout = require('./layout.cjs');

export const CHECK_MS = 6 * 3_600_000;

export const stateFile = (opts = {}) => path.join(layout.codingDir(opts), 'release-check.json');

/** The last check's result, or null. Never throws (the status line calls it). */
export function readState(opts = {}) {
  try {
    return JSON.parse(fs.readFileSync(stateFile(opts), 'utf8'));
  } catch {
    return null;
  }
}

function writeState(state, opts) {
  const file = stateFile(opts);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`);
    fs.renameSync(tmp, file);
  } catch {
    /* display state; a read-only home just means no badge */
  }
}

/**
 * One check. Returns (and persists) {
 *   enabled, channel, current, latest, available, checkedAt, error, notesUrl
 * } where `available` is the newer version or null.
 */
export async function check({ opts = {}, env = process.env, exec = runAsync, now = Date.now } = {}) {
  const base = { checkedAt: new Date(now()).toISOString(), enabled: env.CODING_UPDATE_CHECK !== 'off' };
  let state;
  let rec = null;
  try {
    rec = layout.readInstall(opts);
  } catch (e) {
    state = { ...base, channel: null, current: null, latest: null, available: null, error: e.message };
  }
  if (!state && !base.enabled) {
    state = { ...base, channel: rec.channel, current: rec.version, latest: null, available: null, error: null };
  } else if (!state && rec.channel !== 'release') {
    state = { ...base, channel: rec.channel, current: rec.version, latest: null, available: null, error: null };
  } else if (!state) {
    try {
      const rel = await latestRelease({ exec, env });
      const newer = !rec.version || layout.compareVersions(rel.version, rec.version) > 0;
      state = {
        ...base,
        channel: 'release',
        current: rec.version,
        latest: rel.version,
        available: newer ? rel.version : null,
        notesUrl: `${releaseBase(env)}/download/v${rel.version}/coding-${rel.version}-notes.md`,
        pageUrl: `${releaseBase(env)}/tag/v${rel.version}`,
        error: null,
      };
    } catch (e) {
      // Keep the last good answer: one failed check must not hide a known update.
      const prev = readState(opts);
      state = {
        ...base,
        channel: 'release',
        current: rec.version,
        latest: prev?.current === rec.version ? prev.latest ?? null : null,
        available: prev?.current === rec.version ? prev.available ?? null : null,
        notesUrl: prev?.current === rec.version ? prev.notesUrl : undefined,
        pageUrl: prev?.current === rec.version ? prev.pageUrl : undefined,
        error: e.message,
      };
    }
  }
  writeState(state, opts);
  return state;
}

/** The release notes of `state.available` (markdown), or null. Fails open. */
export async function notes(state, { exec = runAsync } = {}) {
  if (!state?.available || !state.notesUrl) return null;
  const r = await exec('curl', ['-fsSL', '--retry', '2', state.notesUrl]);
  return r.ok ? r.stdout : null;
}

/**
 * The coordinator's watch: check now-ish and every CHECK_MS. Returns
 * { refresh(force), state(), stop() }.
 */
export function createReleaseWatch({ opts = {}, env = process.env, exec = runAsync, firstDelayMs = 60_000, log = () => {} } = {}) {
  let pending = null;
  let last = readState(opts);
  const refresh = async ({ force = false } = {}) => {
    const due = !last?.checkedAt || Date.now() - Date.parse(last.checkedAt) >= CHECK_MS;
    if (!pending && (force || due)) {
      const before = last?.available ?? null;
      pending = check({ opts, env, exec })
        .then((s) => {
          last = s;
          if (s.available && s.available !== before) log(`release: coding ${s.available} is available (this is ${s.current})`);
          if (s.error) log(`release: check failed: ${s.error}`);
        })
        .finally(() => {
          pending = null;
        });
    }
    await pending;
    return last;
  };
  const first = setTimeout(() => refresh(), firstDelayMs);
  const timer = setInterval(() => refresh(), CHECK_MS);
  first.unref?.();
  timer.unref?.();
  return {
    refresh,
    state: () => last,
    stop: () => {
      clearTimeout(first);
      clearInterval(timer);
    },
  };
}

// ── running `coding update` for the dashboard / status line ──────────────────
//
// Detached, with its output in ~/.coding/update.log: the update restarts the
// coordinator that started it, so it must outlive that process, and its status
// must survive the restart — hence a pid file and an exit marker in the log
// rather than in-memory state.

export const updateLog = (opts = {}) => path.join(layout.codingDir(opts), 'update.log');
const updatePid = (opts = {}) => path.join(layout.codingDir(opts), 'update.pid');
const EXIT_RE = /^UPDATE_EXIT=(\d+)$/m;
const LOG_TAIL = 8192;

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

/** { running, exit, log } of the last update started this way. */
export function updateStatus(opts = {}) {
  let pid = null;
  try {
    pid = Number(fs.readFileSync(updatePid(opts), 'utf8').trim()) || null;
  } catch {
    /* none started */
  }
  let log = '';
  try {
    const buf = fs.readFileSync(updateLog(opts));
    log = buf.subarray(Math.max(0, buf.length - LOG_TAIL)).toString('utf8');
  } catch {
    /* none */
  }
  const m = EXIT_RE.exec(log);
  const running = !!pid && !m && alive(pid);
  return { running, exit: m ? Number(m[1]) : null, log: log.replace(EXIT_RE, '').trimEnd() };
}

/**
 * Start `coding update` (the code of `codeRoot`, i.e. `current`). One at a
 * time, and only when the last check found something newer.
 */
export async function startUpdate({ codeRoot, opts = {}, env = process.env, spawnImpl } = {}) {
  if (updateStatus(opts).running) return { ok: true, running: true, already: true };
  const st = readState(opts);
  if (st?.channel === 'dev') return { ok: false, error: 'this is a development checkout — update it with git (coding update --pull)' };
  if (!st?.available) return { ok: false, error: st?.current ? `coding ${st.current} is the latest release` : 'no newer release known — check first' };
  const { spawn } = await import('node:child_process');
  fs.mkdirSync(layout.codingDir(opts), { recursive: true });
  const fd = fs.openSync(updateLog(opts), 'w', 0o600);
  try {
    // The exit marker is written by the shell after node exits, so a crash or a
    // kill still leaves a status the next coordinator can read.
    const script = `"${process.execPath}" "${path.join(codeRoot, 'scripts', 'update.mjs')}"; echo "UPDATE_EXIT=$?"`;
    const child = (spawnImpl ?? spawn)('bash', ['-c', script], { detached: true, stdio: ['ignore', fd, fd], env, cwd: codeRoot });
    fs.writeFileSync(updatePid(opts), `${child.pid}\n`);
    child.unref?.();
    return { ok: true, running: true, target: st.available };
  } finally {
    fs.closeSync(fd);
  }
}
