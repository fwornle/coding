// lib/glass/client.mjs — the wrapper's side of the daemon: health, lazy start,
// sessions. Never throws to the caller for a daemon that is down — `glass <agent>`
// must be able to fall back to running the agent unmeasured.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { glassPaths } from './home.mjs';

const BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'glass.mjs');

async function call(port, method, route, body, timeoutMs = 3000) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}${route}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    return { ok: false, status: 0, data: null, error: err };
  }
}

/** The daemon's /health, or null when nothing glass answers on the port. */
export async function health(port) {
  const r = await call(port, 'GET', '/health', null, 1500);
  return r.ok && r.data?.ok && r.data.glass ? r.data : null;
}

/**
 * A healthy daemon on `port` — started detached when none answers.
 * @returns {Promise<object|null>} its health, or null when it could not be started
 */
export async function ensureDaemon({ home, port, env, waitMs = 8000 }) {
  const up = await health(port);
  if (up) return up;
  const p = glassPaths(home);
  fs.mkdirSync(p.logs, { recursive: true });
  const logFd = fs.openSync(path.join(p.logs, 'daemon.log'), 'a');
  const child = spawn(process.execPath, [BIN, 'daemon'], {
    detached: true, stdio: ['ignore', logFd, logFd], env: { ...env, GLASS_HOME: home, GLASS_PORT: String(port) },
    windowsHide: true,
  });
  let exited = false;
  child.on('exit', () => { exited = true; });
  child.unref();
  fs.closeSync(logFd);
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline && !exited) {
    await new Promise((r) => setTimeout(r, 150));
    const h = await health(port);
    if (h) return h;
  }
  return null;
}

export async function openSession(port, body) {
  const r = await call(port, 'POST', '/sessions', body);
  return r.ok ? r.data : null;
}

export async function closeSession(port, token) {
  const r = await call(port, 'DELETE', `/sessions/${encodeURIComponent(token)}`, null, 30_000);
  return r.ok ? r.data : null;
}

export async function listSessions(port) {
  const r = await call(port, 'GET', '/sessions');
  return r.ok ? r.data.sessions : null;
}

export async function recentRows(port, limit = 5) {
  const r = await call(port, 'GET', `/api/token-usage/recent?limit=${limit}&scope=both`);
  return r.ok ? r.data.data : null;
}

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (err) { return err.code === 'EPERM'; } };

/**
 * Ask the daemon to stop. With `waitMs`, also wait until its process has exited:
 * until then it holds the token DB and its log open, which Windows will not delete.
 * @returns {Promise<boolean>} whether a daemon answered
 */
export async function stopDaemon(port, { waitMs = 0 } = {}) {
  const pid = waitMs ? (await health(port))?.pid : null;
  const r = await call(port, 'POST', '/stop');
  const deadline = Date.now() + waitMs;
  while (r.ok && pid && alive(pid) && Date.now() < deadline) await new Promise((res) => setTimeout(res, 100));
  return r.ok;
}

/**
 * Status-line facts of a live session (the newest one without `taskId`).
 * @returns {Promise<{ state: 'ok'|'none'|'down', data: object|null }>}
 */
export async function statusline(port, taskId) {
  const q = taskId ? `?task_id=${encodeURIComponent(taskId)}` : '';
  const r = await call(port, 'GET', `/api/statusline${q}`, null, 1500);
  if (r.ok) return { state: 'ok', data: r.data };
  return { state: r.status === 404 ? 'none' : 'down', data: null };
}

export async function contextTurns(port, taskId) {
  const r = await call(port, 'GET', `/api/context-turns?task_id=${encodeURIComponent(taskId)}`);
  return r.ok ? r.data.contextTurns || [] : [];
}
