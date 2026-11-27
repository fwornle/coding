/**
 * `/api/cluster` and `/api/routing` — the on-prem cluster for coding's dashboard (the Cluster tab).
 *
 *   GET /api/cluster          every node's gateway, models, GPUs, CPU, RAM and jobs (lib/glass/cluster.mjs)
 *   GET /api/cluster?peek=1   { configured } only — polls nothing
 *   GET /api/routing?hours=N&limit=M   the router's decisions from coding's token database (lib/glass/routing.mjs)
 *
 * The same two modules glass's daemon serves these routes with, so both dashboards show one
 * cluster the same way. They are mounted on the observations API because it runs on the HOST:
 * the nodes are on the corporate network (the dashboard's container is not the place to reach
 * them from) and the token database is a host file.
 *
 * The cluster is configured where glass keeps it — `~/.glass/cluster.json` and its two key
 * files (GLASS_HOME moves the directory) — so one machine has one node list and one set of
 * keys for both. Read-only: nothing here writes, and neither key ever leaves this process.
 */

import os from 'node:os';
import path from 'node:path';
import { createCluster } from '../../glass/overlay/lib/glass/cluster.mjs';
import { routingHistory } from '../../glass/overlay/lib/glass/routing.mjs';
import { tokenUsageDb } from '../paths/index.mjs';
import { openDb } from '../proxy/proxy-paths.cjs';

export const clusterHome = (env = process.env) => env.GLASS_HOME || path.join(os.homedir(), '.glass');

/**
 * @param {import('express').Express} app
 * @param {object} [o]
 * @param {string} [o.home]           where cluster.json and the keys live
 * @param {Function} [o.fetch]        reaches the nodes; Node's own fetch goes direct (no proxy env)
 * @param {() => string} [o.dbPath]   the token database
 * @param {object} [o.cluster]        an existing createCluster() (tests)
 * @param {() => boolean} [o.enabled] the `cluster` feature, asked per request (apply tier
 *   `live`): off answers `{ configured: false, disabled: true }` and polls no node
 */
export function registerClusterRoutes(app, { home = clusterHome(), fetch = globalThis.fetch, dbPath = () => tokenUsageDb(), cluster, log = () => {}, enabled = () => true } = {}) {
  const c = cluster ?? createCluster({ home, fetch, log });
  const OFF = { configured: false, available: false, disabled: true, reason: "the 'cluster' feature is off" };

  app.get('/api/cluster', async (req, res) => {
    if (!enabled()) return res.json(OFF);
    try {
      res.json(req.query.peek ? c.peek() : await c.read());
    } catch (err) {
      res.status(500).json({ error: String(err?.message || err) });
    }
  });

  app.get('/api/routing', (req, res) => {
    if (!enabled()) return res.json(OFF);
    const h = Number(req.query.hours);
    const limit = Number(req.query.limit) || 500;
    const hours = Number.isFinite(h) && h >= 0 ? Math.min(h, 24 * 366) : 24;
    let db = null;
    try {
      db = openDb(dbPath(), { readonly: true, fileMustExist: true });
    } catch {
      return res.json(routingHistory(null, { hours, limit })); // no database yet: available: false
    }
    try {
      res.json(routingHistory(db, { hours, limit }));
    } catch (err) {
      res.status(500).json({ error: String(err?.message || err) });
    } finally {
      try { db.close(); } catch { /* already closed */ }
    }
  });

  return c;
}
