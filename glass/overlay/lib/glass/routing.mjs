// lib/glass/routing.mjs — the routing history: what the offload router decided, call by call.
//
//   GET /api/routing?hours=N&limit=M   (served by ui-api.mjs)
//
// Every call the offload router (proxy-bridge/offload.mjs) looked at is a row in
// token_usage with its decision in the routing columns: route_key `fg-chat/<agent>`,
// the band and who chose it, `offloaded_from` when the endpoint answered, and the
// attempt trail (routing-trail.mjs) when it did not — why the call stayed with the
// agent's provider, or how the endpoint failed before the call fell back. Rows that
// coding's proxy offloaded (where its figures are included) carry the same columns.
//
// Read-only. Nothing here knows any endpoint: the rows name where each call went.

/** host[:port] of what a row records as `upstream` (a URL or a bare host:port). */
export function hostPortOf(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  try { return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `http://${s}`).host; } catch { return ''; }
}

function parseTrail(raw) {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const t = JSON.parse(raw);
    return t && typeof t === 'object' ? t : null;
  } catch { return null; }
}

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/**
 * One token_usage row as a routing decision.
 *
 *   offloaded  the endpoint answered (offloaded_from names the agent's own provider)
 *   failed     the endpoint was tried and failed; the agent's provider answered
 *   kept       the router looked and left the call where it was (reason says why)
 *   routed     a routing row with nothing unusual (a fallback chain of coding's proxy)
 */
export function routingRowOf(r) {
  const trail = parseTrail(r.attempt_trail);
  const attempts = Array.isArray(trail?.attempts) ? trail.attempts.map((a) => ({
    provider: String(a?.provider || ''), model: String(a?.model || ''), error: String(a?.error || ''),
    ms: Number.isFinite(a?.ms) ? a.ms : null,
  })) : [];
  const skipped = Array.isArray(trail?.skipped) ? trail.skipped.map((s) => ({
    provider: String(s?.provider || ''), reason: String(s?.reason || ''), kind: String(s?.kind || ''),
  })) : [];
  const from = String(r.offloaded_from || '');
  const reason = String(trail?.offloadSkipped || '');
  let outcome = 'routed';
  if (from) outcome = 'offloaded';
  else if (attempts.length) outcome = 'failed';
  else if (reason) outcome = 'kept';
  const upstream = hostPortOf(r.upstream);
  return {
    ts: String(r.timestamp || ''),
    agent: String(r.agent || ''),
    taskId: String(r.task_id || ''),
    routeKey: String(r.route_key || ''),
    band: String(r.route_band || ''),
    bandSource: String(r.band_source || ''),
    provider: String(r.provider || ''),
    model: String(r.model || ''),
    upstream,
    host: upstream ? upstream.replace(/:\d+$/, '').replace(/^\[|\]$/g, '') : '',
    outcome,
    from,
    reason,
    classifier: String(trail?.classifier || ''),
    attempts,
    skipped,
    latencyMs: r.latency_ms == null ? null : num(r.latency_ms),
    tokens: { input: num(r.input_tokens), output: num(r.output_tokens), cacheRead: num(r.cache_read_tokens), cacheWrite: num(r.cache_write_tokens) },
  };
}

const WANTED = ['route_key', 'route_band', 'band_source', 'offloaded_from', 'attempt_trail', 'upstream', 'cache_read_tokens', 'cache_write_tokens', 'latency_ms', 'agent', 'task_id'];

/**
 * The routing decisions of the last `hours` (0 = all time), newest first, at most
 * `limit`. A DB from before the routing columns has no decisions to show
 * (`available: false`), which the page says rather than showing an empty list.
 */
export function routingHistory(db, { hours = 24, limit = 500, now = Date.now() } = {}) {
  const empty = { hours, available: false, truncated: false, counts: { offloaded: 0, failed: 0, kept: 0, routed: 0 }, rows: [] };
  if (!db) return empty;
  let have;
  try {
    have = new Set(db.prepare(`SELECT name FROM pragma_table_info('token_usage') WHERE name IN (${WANTED.map(() => '?').join(',')})`).all(...WANTED).map((c) => c.name));
  } catch { return empty; }
  if (!have.has('route_key') || !have.has('offloaded_from') || !have.has('attempt_trail')) return empty;
  const col = (c, fallback = "''") => (have.has(c) ? c : `${fallback} AS ${c}`);
  const since = hours > 0 ? new Date(now - hours * 3_600_000).toISOString() : '';
  const cap = Math.max(1, Math.min(Number(limit) || 500, 5000));
  const rows = db.prepare(`
    SELECT timestamp, ${col('agent')}, ${col('task_id')}, provider, model, ${col('upstream')},
           route_key, ${col('route_band')}, ${col('band_source')}, offloaded_from, attempt_trail,
           input_tokens, output_tokens, ${col('cache_read_tokens', '0')}, ${col('cache_write_tokens', '0')},
           ${col('latency_ms', 'NULL')}
    FROM token_usage
    WHERE timestamp >= ?
      AND (route_key LIKE 'fg-chat/%' OR COALESCE(offloaded_from, '') <> '' OR COALESCE(attempt_trail, '') <> '')
    ORDER BY timestamp DESC LIMIT ?
  `).all(since, cap + 1);
  const truncated = rows.length > cap;
  const mapped = rows.slice(0, cap).map(routingRowOf);
  const counts = { offloaded: 0, failed: 0, kept: 0, routed: 0 };
  for (const r of mapped) counts[r.outcome] += 1;
  return { hours, available: true, truncated, counts, rows: mapped };
}
