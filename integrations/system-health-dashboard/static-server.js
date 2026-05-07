#!/usr/bin/env node
/**
 * Static-asset server for the system-health-dashboard SPA on port 3032.
 *
 * Phase 33 G2 fix (plan 33-10): the SPA's catch-all `app.get('*', sendFile(index.html))`
 * was hijacking `/api/health-verifier/status` (and every other /api/* path),
 * returning the React index.html with `Content-Type: text/html` instead of JSON.
 * This broke SPEC AC #5 (two-session-agreement, dashboard step) and AC #9
 * (dashboard endpoints preserved).
 *
 * Fix: reverse-proxy /api/* to the api-server on port 3033 BEFORE the SPA
 * fallback. The api-server already proxies the coordinator and applies SPEC R8
 * reshape — we just forward bytes.
 *
 * Per SPEC R6: api-server unreachable -> 503 with `{status: 'unknown'}`,
 * NEVER 'healthy'.
 */
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, 'dist');
const port = parseInt(process.env.HEALTH_DASHBOARD_PORT || '3032', 10);
const apiPort = parseInt(process.env.HEALTH_DASHBOARD_API_PORT || '3033', 10);
const apiHost = process.env.HEALTH_DASHBOARD_API_HOST || '127.0.0.1';

const app = express();

/**
 * Reverse-proxy /api/* to the api-server. MUST be mounted BEFORE
 * express.static and the SPA `*` catch-all -- Express matches in order.
 *
 * Streams request and response (works for POST bodies, large payloads).
 * On upstream error (ECONNREFUSED, timeout): respond 503 with SPEC R6
 * envelope `{ status: 'unknown' }` -- never 'healthy'.
 */
app.use('/api', (req, res) => {
  const upstreamPath = req.originalUrl; // includes /api prefix + query
  const upstream = http.request(
    {
      host: apiHost,
      port: apiPort,
      method: req.method,
      path: upstreamPath,
      headers: { ...req.headers, host: `${apiHost}:${apiPort}` }
    },
    (upRes) => {
      res.status(upRes.statusCode || 502);
      for (const [k, v] of Object.entries(upRes.headers)) {
        res.setHeader(k, v);
      }
      upRes.pipe(res);
    }
  );
  upstream.on('error', (err) => {
    process.stderr.write(
      `[static-server proxy] upstream ${apiHost}:${apiPort} unreachable: ${err.message}\n`
    );
    res
      .status(503)
      .type('application/json')
      .end(
        JSON.stringify({
          status: 'unknown',
          error: `api-server unreachable: ${err.code || err.message}`,
          hint: 'Is the dashboard api-server running on port 3033?'
        })
      );
  });
  // Stream the request body (works for GET -- empty stream -- and POST/PUT)
  req.pipe(upstream);
});

// SPA static assets
app.use(express.static(distDir));

// SPA client-side routing fallback (React Router) -- MUST be last
app.get('*', (_req, res) => res.sendFile(path.join(distDir, 'index.html')));

app.listen(port, () => {
  process.stdout.write(
    `Health dashboard frontend serving from ${distDir} on port ${port}\n`
  );
  process.stdout.write(`  /api/* reverse-proxy -> ${apiHost}:${apiPort}\n`);
});
