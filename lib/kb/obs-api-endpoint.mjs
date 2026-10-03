/**
 * Which obs-api serves this installation — recorded by obs-api in its own data
 * home, read by whoever needs to reach it (`coding sync` → `/api/kb/reload`).
 *
 * The port alone (OBSERVATIONS_API_PORT, default 12436) names whichever obs-api
 * happens to listen there, not the one that owns this data home: a second
 * installation on one machine (a clean-room install, a simulated teammate) told
 * the FIRST one to reload after its own pull. The data home is the identity —
 * one obs-api per data home (D6) — so the record lives there.
 *
 *   <data home>/var/obs-api.json   { port, pid, startedAt }
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const dataHome = require('../paths/data-home.cjs');

const FILE = 'obs-api.json';

export function endpointFile(opts = {}) {
  return path.join(dataHome.varDir(opts), FILE);
}

/** Called by obs-api once it listens. Never throws. */
export function recordEndpoint({ port, pid = process.pid }, opts = {}) {
  try {
    const file = endpointFile(opts);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify({ port: Number(port), pid, startedAt: new Date().toISOString() })}\n`);
    return file;
  } catch {
    return null;
  }
}

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (err) { return err.code === 'EPERM'; }
}

/**
 * The port of this data home's obs-api: the record if its process is alive,
 * else OBSERVATIONS_API_PORT, else 12436.
 */
export function obsApiPort(opts = {}) {
  const env = opts.env || process.env;
  try {
    const rec = JSON.parse(fs.readFileSync(endpointFile(opts), 'utf8'));
    if (rec && Number(rec.port) > 0 && (!rec.pid || alive(rec.pid))) return String(rec.port);
  } catch { /* no record */ }
  return String(env.OBSERVATIONS_API_PORT || '12436');
}
