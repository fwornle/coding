// tests/integration/cross-system-parity.mjs
//
// Phase 44 Wave 0 — RED test stub.
// Asserts cross-system /api/v1 shape parity across the three systems:
//   A = coding host-side obs-api on :12436 (scripts/observations-api-server.mjs)
//   B = mcp-server-semantic-analysis SSE/REST on :3848
//   C = OKM on :3002
//
// EXPECTED FAILURE MODE (RED today):
//   * Plans 44-07 (A mount), 44-08 (B mount), and 44-09 (C cutover) all
//     ship the `/api/v1/*` surface. Today NONE of A/B/C exposes /api/v1/.
//   * `fetch http://localhost:12436/api/v1/entities?limit=1` returns HTTP 404
//     (express default 404 handler) — assertion `res.ok === true` fails with
//     a message naming the missing service.
//   * If a service is entirely down (e.g. dev box without docker up), `fetch`
//     throws `fetch failed` / ECONNREFUSED — we catch it and emit a clear
//     diagnostic naming WHICH service was unreachable, instead of letting the
//     raw network error escape.
//
// GOES GREEN after: Plans 44-07 + 44-08 + 44-09 land /api/v1 on all three.
//
// Runner: node:test (built-in). Run via:
//   node --test tests/integration/cross-system-parity.mjs
// Chosen over Jest for this file because Jest is configured for *.test.js
// (CommonJS-flavoured ESM via experimental-vm-modules) and this script needs
// to talk to live network services with the bare Node fetch (no node-fetch
// dependency present in package.json — verified 2026-06-03).

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';

const SERVICES = [
  { name: 'A', url: 'http://localhost:12436/api/v1' },
  { name: 'B', url: 'http://localhost:3848/api/v1' },
  { name: 'C', url: 'http://localhost:3002/api/v1' },
];

const ENDPOINTS = ['/entities?limit=1', '/stats', '/ontology/classes'];

// Volatile-field regex: keys whose values change every request or per-system.
// Replaced with placeholder '<normalized>' before deep-diff.
const VOLATILE_KEY_RE = /timestamp|createdAt|updatedAt|validFrom|validUntil|commit_sha|runId/i;
// Pure-id keys (not "entityId" — we want to keep that as a SHAPE marker; we
// only strip top-level "id" / nested object "id" fields whose value is a
// system-minted UUID/string that won't match across systems).
const ID_KEY_RE = /^id$/i;

function normalize(value) {
  if (Array.isArray(value)) {
    // For arrays we normalize each element BUT we do NOT compare array length
    // across systems (each system has different data). The caller is
    // responsible for comparing only top-level shape, not array contents.
    return value.map(normalize);
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (VOLATILE_KEY_RE.test(k) || ID_KEY_RE.test(k)) {
        out[k] = '<normalized>';
      } else {
        out[k] = normalize(v);
      }
    }
    return out;
  }
  return value;
}

// Returns the SHAPE skeleton of a value — top-level keys only, recursing one
// level for nested objects. Used so that data-array length / nested array
// contents do NOT cause false-positive shape mismatches across A/B/C (they
// have different datasets — only the shape is portable).
function shapeOf(value) {
  if (Array.isArray(value)) {
    // For arrays: descend into the FIRST element only and report shape.
    // Empty array is reported as `<empty-array>`.
    if (value.length === 0) return '<empty-array>';
    return ['<array>', shapeOf(value[0])];
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value).sort()) {
      out[k] = shapeOf(value[k]);
    }
    return out;
  }
  return typeof value; // 'string' | 'number' | 'boolean' | ...
}

async function fetchOrFail(service, endpoint) {
  const url = service.url + endpoint;
  let res;
  try {
    res = await fetch(url, { headers: { Accept: 'application/json' } });
  } catch (err) {
    // Honest fail mode — name WHICH service is unreachable.
    process.stderr.write(`[cross-system-parity] service ${service.name} (${url}) unreachable: ${err.message}\n`);
    throw new Error(`Service ${service.name} at ${url} unreachable: ${err.message}`);
  }
  if (!res.ok) {
    throw new Error(`Service ${service.name} ${endpoint} returned HTTP ${res.status} — /api/v1 not mounted (expected RED until Plans 07/08/09)`);
  }
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('json')) {
    // Some default Express 404 / static-server responses come back as HTML even
    // with res.ok=true on a misrouted path. Surface a typed diagnostic instead
    // of letting `JSON.parse` blow up with `Unexpected token '<'`.
    throw new Error(
      `Service ${service.name} ${endpoint} returned non-JSON content-type '${ct}' — /api/v1 not mounted (expected RED until Plans 07/08/09)`
    );
  }
  const body = await res.json();
  return body;
}

describe('cross-system /api/v1 parity (Phase 44 Wave 0 RED)', () => {
  before(() => {
    process.stderr.write(`[cross-system-parity] driving ${SERVICES.length} services: ${SERVICES.map(s => `${s.name}@${s.url}`).join(', ')}\n`);
  });

  // Smoke: each service must respond 200 on /entities?limit=1.
  for (const service of SERVICES) {
    test(`smoke: ${service.name} /entities?limit=1 returns 200`, async () => {
      const body = await fetchOrFail(service, '/entities?limit=1');
      assert.ok(body, `${service.name} returned an empty response body`);
    });
  }

  // Cross-system shape parity per endpoint.
  for (const endpoint of ENDPOINTS) {
    test(`${endpoint} returns same shape on A, B, C`, async () => {
      const responses = await Promise.all(
        SERVICES.map((s) => fetchOrFail(s, endpoint).then((body) => ({ name: s.name, body })))
      );
      const shapes = responses.map(({ name, body }) => ({
        name,
        shape: shapeOf(normalize(body)),
      }));
      const [a, b, c] = shapes;
      assert.deepStrictEqual(
        a.shape,
        b.shape,
        `${endpoint} shape mismatch between A and B`
      );
      assert.deepStrictEqual(
        b.shape,
        c.shape,
        `${endpoint} shape mismatch between B and C`
      );
    });
  }
});
