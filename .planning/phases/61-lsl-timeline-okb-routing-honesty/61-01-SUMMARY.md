---
phase: 61-lsl-timeline-okb-routing-honesty
plan: 01
subsystem: obs-api (LSL sessions endpoint)
tags: [lsl-timeline, obs-api, provenance, honesty-badge]
requires:
  - "obs-api GET /api/coding/lsl/sessions handler (Phase 55 Plan 06)"
  - "km-core GraphKMStore.putEntity (skipOntologyCheck bulk-import path)"
provides:
  - "lsl/sessions envelope field: data.total (full pre-slice M) + data.limit"
  - "lsl/sessions per-session field: source ('online' | 'batch')"
  - "any-manual->batch derivation rule (D-09) server-side"
affects:
  - "Wave 2 frontend plan (useLslSessions.ts N-of-M badge + bi-source tick coloring)"
tech-stack:
  added: []
  patterns:
    - "additive REST envelope fields (no new endpoint, reuse existing directory walk)"
    - "provenance bucket via attrs.metadata?.source ?? attrs.source (Pitfall 3)"
    - "process.stderr.write logging idiom (no console.log — CLAUDE.md no-console-log)"
key-files:
  created:
    - ".planning/phases/61-lsl-timeline-okb-routing-honesty/61-01-SUMMARY.md"
  modified:
    - "scripts/observations-api-server.mjs"
    - "tests/integration/obs-api.coding-lsl-sessions.test.js"
decisions:
  - "D-02: total = sessions.length BEFORE the slice (already-computed M, surfaced not recomputed)"
  - "D-07: source read from attrs.metadata?.source ?? attrs.source (covers both attr locations)"
  - "D-09: any matched entity metadata.source==='manual' -> session source 'batch'; else 'online' (order-independent)"
  - "non-finite startMs/endMs fallback defaults source: 'online'"
metrics:
  duration: ~12 min
  completed: 2026-06-20
  tasks: 2
  files: 2
---

# Phase 61 Plan 01: LSL Timeline Backend Honesty Fields Summary

Added the two additive obs-api fields the LSL timeline strip needs: `total` (the true pre-slice session count M for the "N of M" honesty badge) and a per-session `source` discriminator ('online' | 'batch') derived server-side from km-core entity `metadata.source` via the any-manual→batch rule (D-09).

## What Was Built

### Task 1 — Handler (`scripts/observations-api-server.mjs`, commit `caa986150`)

Four additive edits to the `/api/coding/lsl/sessions` handler (no new endpoint, no second query):

1. **allEnts scan push** — captures `source: (attrs.metadata && attrs.metadata.source) ?? attrs.source` alongside the existing `{id, type, hidden, createdMs}`, covering both attribute locations (Pitfall 3).
2. **`aggregateForRange`** — returns a third field `source: matches.some((m) => m.source === 'manual') ? 'batch' : 'online'` (D-09 any-manual→batch, else online; order-independent, empty window → online).
3. **Destructure + per-session push** — `const { entityIds, totalCount, source }`, non-finite branch defaults `source: 'online'`, and `source` added to each pushed session object.
4. **Envelope** — `res.json({ success: true, data: { sessions: sliced, total: sessions.length, limit } })`. `total` is `sessions.length` BEFORE the slice (the already-computed M); `limit` echoes the applied cap.

`LSL_MAX_LIMIT` left at 500 (the client cap-raise to 500 is the Wave-2 frontend change). No `console.log` introduced — file's `process.stderr.write` idiom preserved.

### Task 2 — Integration test (`tests/integration/obs-api.coding-lsl-sessions.test.js`, commit `337691f14`)

- **total / N<M test**: `?limit=2` against 4 seeded sessions asserts `sessions.length===2`, `total===4`, `limit===2`.
- **source shape**: existing shape loop now asserts `['online','batch']` contains `s.source`.
- **any-batch→batch rule**: `beforeAll` seeds two km-core entities via `kmStore.putEntity(..., { skipOntologyCheck: true })` — a `metadata.source:'manual'` entity with `createdAt` inside the `2026-06-09 16-17` window (→ that session `source==='batch'`) and an `metadata.source:'auto'` entity inside the `2026-06-08 09-10` window (→ `source==='online'`). Test asserts both. `createdAt` built via `new Date('YYYY-MM-DDTHH:MM:SS').toISOString()` to match the handler's local→UTC parse (host-TZ-independent).
- Header comment wire-shape updated to document `source` + `total`/`limit`.

## Verification

- `node --check scripts/observations-api-server.mjs` → pass (NODE_CHECK_PASS).
- `npx jest tests/integration/obs-api.coding-lsl-sessions.test.js` → **11 passed, 11 total** (9 original + 2 new; source-shape folded into the first test).
- No `console.log`/`console.error`/`console.warn` introduced in the handler region.

### Test-runner note (environment, not a code deviation)

The worktree checkout lacks `dist/` (gitignored build artifacts) and `node_modules`, so the obs-api import chain (`../../dist/embedding/embedding-service.js`) cannot resolve in the worktree directly. To run the test against the worktree's edits, a **temporary** `dist` symlink to the main repo's built `dist/` was created, the suite was run green, and the symlink was **removed** before commit (it is gitignored and was never staged). The plan's canonical verify command (`cd /Users/Q284340/Agentic/coding && npx jest ...`) runs in the main repo where `dist/` is built — no symlink needed there post-merge.

## Deviations from Plan

None — plan executed exactly as written. All four handler edit sites and all three test additions landed at the planned locations with the pinned D-09 rule verbatim.

## Known Stubs

None. Both fields are wired to real data (`total` from the existing directory walk; `source` from km-core entity `metadata.source`).

## Self-Check: PASSED

- FOUND: scripts/observations-api-server.mjs (modified, node --check passes)
- FOUND: tests/integration/obs-api.coding-lsl-sessions.test.js (11/11 green)
- FOUND: commit caa986150 (Task 1)
- FOUND: commit 337691f14 (Task 2)
