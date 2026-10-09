// lib/glass/home.mjs — where glass keeps things, and the environment its daemon
// runs with.
//
// Everything glass writes lives under one directory (GLASS_HOME, default
// ~/.glass): the token DB and captures (data/), the interception CA (ca/), the
// daemon log (logs/) and the daemon lock (daemon.json). `glass uninstall`
// removes that directory and nothing else exists outside it.
//
// The extracted modules read coding's env names (CODING_*, LLM_PROXY_*; glass
// decision 7) — the daemon sets them for its own process, before any of those
// modules is imported, because some read them at import time.
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DEFAULT_PORT = 12445;

export function glassHome(env = process.env) {
  return env.GLASS_HOME || path.join(os.homedir(), '.glass');
}

export function glassPort(env = process.env) {
  const n = Number(env.GLASS_PORT);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_PORT;
}

export function glassPaths(home) {
  return {
    home,
    data: path.join(home, 'data'),
    ca: path.join(home, 'ca'),
    logs: path.join(home, 'logs'),
    run: path.join(home, 'run'),
    lock: path.join(home, 'daemon.json'),
    config: path.join(home, 'config.json'),
  };
}

/** The env the extracted measurement modules read, for a daemon rooted at `home`. */
export function daemonEnv(home) {
  const p = glassPaths(home);
  return {
    LLM_PROXY_DATA_DIR: p.data,
    CODING_DATA_HOME: p.data,
    CODING_REPO: PKG_ROOT,
    CODING_SQLITE_BACKEND: 'node',
    LLM_PROXY_REDACTION_CONFIG: path.join(PKG_ROOT, 'config', 'redaction', 'redaction-patterns.json'),
    HEALTH_COORDINATOR_URL: 'off',
    // model-limits caches its window table under CODING_REPO/.logs by default —
    // the installed package here.
    CODING_MODEL_LIMITS_CACHE: path.join(p.logs, 'model-context-limits.json'),
  };
}
