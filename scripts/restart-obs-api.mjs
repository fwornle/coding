#!/usr/bin/env node

/**
 * Restart the observations-api server cleanly under PSM supervision.
 *
 * Mirrors the SERVICE_CONFIGS.observationsApi.startFn block in
 * start-services-robust.js (detached spawn, .data/observations-api.log,
 * OBSERVATIONS_API_PORT env) and follows it with the same registerWithPSM
 * call so the freshly-started instance is supervised for the rest of the
 * session.
 *
 * Use cases:
 *  - obs-api died and PSM lost the entry (common after manual SIGTERM or
 *    a crash on shutdown — the libc++abi mutex bug). Re-bringing it up
 *    via the orchestrator would also restart every other service; this
 *    script targets just the one.
 *  - Picking up a code change in the retrieval / consolidation paths
 *    without a full coding-services bounce.
 *
 * The script is idempotent: any existing obs-api instance is gracefully
 * stopped (SIGTERM with a 6s grace, then SIGKILL) before the new one is
 * spawned, and registerService for type=global overwrites the registry
 * entry by name — no stale-PID buildup.
 *
 * Defaults: port 12436, log .data/observations-api.log. Override the port
 * with OBSERVATIONS_API_PORT=...
 */

import { spawn, execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';
import ProcessStateManager from './process-state-manager.js';

const __filename = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(__filename);
const CODING_DIR = path.resolve(SCRIPT_DIR, '..');

const PORT = parseInt(process.env.OBSERVATIONS_API_PORT || '12436', 10);
const SERVICE_NAME = 'observations-api';
const SCRIPT_REL = 'scripts/observations-api-server.mjs';
const ENTRY = path.join(CODING_DIR, SCRIPT_REL);
const LOG_FILE = path.join(CODING_DIR, '.data', 'observations-api.log');

const HEALTH_DEADLINE_MS = 15_000;
const STOP_GRACE_MS = 6_000;

function info(msg) { process.stdout.write(`[restart-obs-api] ${msg}\n`); }
function warn(msg) { process.stderr.write(`[restart-obs-api] ${msg}\n`); }

function pidsForObsApi() {
  // Match only `node …observations-api-server.mjs` so we don't match shells
  // whose argv contains the string (the pgrep-vs-pgrep-f pitfall).
  try {
    const out = execSync(
      `pgrep -f 'node.*observations-api-server\\.mjs' || true`,
      { encoding: 'utf8' }
    );
    return out.split(/\s+/).map((s) => parseInt(s, 10)).filter(Number.isFinite);
  } catch {
    return [];
  }
}

function isAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function sleep(ms) { await new Promise((r) => setTimeout(r, ms)); }

async function probeHealth() {
  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: '127.0.0.1', port: PORT,
        path: '/api/consolidation/status', method: 'GET', timeout: 1000,
      },
      (res) => { res.resume(); resolve(res.statusCode === 200); }
    );
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
    req.end();
  });
}

async function stopExisting() {
  const pids = pidsForObsApi();
  if (pids.length === 0) {
    info('no existing obs-api process');
    return;
  }
  info(`stopping existing obs-api: pid(s) ${pids.join(', ')}`);
  for (const p of pids) { try { process.kill(p, 'SIGTERM'); } catch { /* */ } }

  const deadline = Date.now() + STOP_GRACE_MS;
  while (Date.now() < deadline) {
    if (pids.every((p) => !isAlive(p))) break;
    await sleep(250);
  }

  const stragglers = pids.filter(isAlive);
  for (const p of stragglers) {
    warn(`SIGKILL pid ${p} after ${STOP_GRACE_MS / 1000}s grace`);
    try { process.kill(p, 'SIGKILL'); } catch { /* */ }
  }
}

async function spawnAndRegister() {
  if (!fs.existsSync(ENTRY)) throw new Error(`entry not found: ${ENTRY}`);
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });

  const logFd = fs.openSync(LOG_FILE, 'a');
  const child = spawn('node', [ENTRY], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    cwd: CODING_DIR,
    env: { ...process.env, OBSERVATIONS_API_PORT: String(PORT) },
  });
  fs.closeSync(logFd);
  child.unref();

  // Poll the health endpoint until it answers or we hit the deadline.
  const start = Date.now();
  let healthy = false;
  while (Date.now() - start < HEALTH_DEADLINE_MS) {
    await sleep(500);
    if (!isAlive(child.pid)) {
      throw new Error(`obs-api process died during startup (pid=${child.pid}); see ${LOG_FILE}`);
    }
    if (await probeHealth()) { healthy = true; break; }
  }
  if (!healthy) {
    throw new Error(`obs-api did not become healthy within ${HEALTH_DEADLINE_MS / 1000}s (pid=${child.pid})`);
  }

  const psm = new ProcessStateManager({ codingRoot: CODING_DIR });
  await psm.registerService({
    name: SERVICE_NAME,
    pid: child.pid,
    type: 'global',
    script: SCRIPT_REL,
  });

  info(`healthy on :${PORT} pid=${child.pid}, registered with PSM (took ${Date.now() - start}ms)`);
}

(async () => {
  try {
    await stopExisting();
    // Brief pause so the OS releases the port binding between SIGKILL and respawn.
    await sleep(500);
    await spawnAndRegister();
  } catch (err) {
    warn(err.message);
    process.exit(1);
  }
})();
