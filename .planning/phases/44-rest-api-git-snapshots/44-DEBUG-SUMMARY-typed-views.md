# Phase 44 — Typed Views Debug Summary

**Date:** 2026-06-04
**Trigger:** Two related bugs surfaced when Phase 44's typed views hit real migrated data. Migration ran cleanly (1327 entities with `legacyId.system='A'` in `.data/knowledge-graph/exports/general.json`: 874 Observation + 373 Digest + 80 Insight) but the consumers couldn't see them.
**Debug session:** `.planning/debug/resolved/phase44-typed-views.md`

## TL;DR

Two independent bugs, both producing "empty result" symptoms:

1. **Bug 1** — `/api/coding/observations` (and `digests` / `insights`) threw HTTP 500 with `.for is not iterable` because `observations-api-server.mjs` was iterating `_kmStore.graph.nodeEntries()`. The `graph` field on `GraphKMStore` is `private` (TS-enforced at `GraphKMStore.ts:137`); the canonical public API for class-filtered iteration is `store.findByOntologyClass(cls)`.

2. **Bug 2** — `/api/v1/entities` returned `data:[]` despite 2129 entities loaded into the store, because the Phase 42 / Phase 44 migration scripts stamp `validUntil: null` on every entity, and km-core's `isActive` short-circuit checked `entity.validUntil === undefined` only. `null` fell through to `new Date(null).getTime() > nowMs` which is `0 > now → false`, so every entity was treated as superseded and filtered out by D-34 active-only default.

Both bugs were fixed atomically with two minimal edits + one km-core rebuild + one obs-api kickstart. Both verifications pass; tests stay green.

---

## Bug 1 — `_kmStore.graph` is private

### Symptom

```
$ curl -s "http://localhost:12436/api/coding/observations?limit=3"
{"error":"Failed to query observations"}

# /tmp/obs-api.log:
[obs-api] /api/coding/observations error: .for is not iterable
```

### Investigation

The handler at `scripts/observations-api-server.mjs:1018-1026` used:

```js
async function collectByOntologyClass(cls) {
  const matches = [];
  for await (const [, attrs] of _kmStore.graph.nodeEntries()) {
    if (attrs.entityType === cls || attrs.ontologyClass === cls) {
      matches.push(attrs);
    }
  }
  return matches;
}
```

`GraphKMStore.ts:137` declares `private graph: MultiDirectedGraph<Entity, Relation>;`. In the compiled JS, the field exists but is not part of the documented public contract; downstream tooling and the typed contract (`GraphKMStore.d.ts`) deliberately hide it. The `.for is not iterable` error path indicates that whatever `_kmStore.graph.nodeEntries()` resolved to was not an async iterable.

The canonical API is documented in the same file: `store.findByOntologyClass(cls)` at `GraphKMStore.ts:556-570`. It performs exactly the Pitfall 3 two-field OR-check the comment block in obs-api referenced (`entity.entityType !== cls && entity.ontologyClass !== cls` excludes ONLY when BOTH mismatch), AND it respects D-34 active-only filtering.

### Fix

`scripts/observations-api-server.mjs:1018-1026` — replace the private-field iteration with the canonical helper:

```js
async function collectByOntologyClass(cls) {
  return _kmStore.findByOntologyClass(cls);
}
```

No change to caller call sites — they consume `Promise<Entity[]>` and the new return shape is identical.

---

## Bug 2 — `isActive` strict-equality undefined-check loses `null`

### Symptom

```
$ curl -s "http://localhost:12436/api/v1/entities?limit=3"
{"success":true,"data":[]}

# Even includeSuperseded=true (had it been passed through) would have helped — but the handler doesn't surface that option.
```

`/api/v1/entities` returned empty arrays even though the export file on disk (`general.json`) carried 2129 nodes including 802 working pre-Phase-42 'B'-system entities AND 1327 freshly-migrated 'A'-system entities.

### Investigation

Inspected `general.json` directly:

```text
Total nodes: 2129
By entityType: System=1, Project=11, ..., Observation=874, Digest=373, Insight=80
By legacyId.system: B=802, A=1327
validUntil: null=2129, undefined=0, set=0
```

**Every node had `validUntil: null`.** Cross-checked the source: `scripts/migrate-sqlite-to-kmcore.mjs` lines 204 / 234 / 263 explicitly stamps `validUntil: null` on Observation, Digest, and Insight entities at migration time. The Phase 42 'B'-system entities have the same pattern (`augment-team-field-42.2.mjs:154` even has a comment acknowledging this and bypasses with `includeSuperseded: true` as a workaround).

`GraphKMStore.ts:539-542` (`isActive`):

```ts
private isActive(entity: Entity, nowMs: number): boolean {
  if (entity.validUntil === undefined) return true;
  return new Date(entity.validUntil).getTime() > nowMs;
}
```

`null === undefined` is `false`, so the short-circuit doesn't fire. `new Date(null).getTime()` is `0`, which is `<= nowMs`, so the entity is "expired" and filtered out by both `findByOntologyClass` and `iterate` whenever the default `includeSuperseded: false` is in effect.

This is a longstanding regression. The Phase 42 migration introduced it; Phase 42.2 worked around it locally; Phase 44 inherited the data and finally tripped over it when the typed views started reading the store at runtime instead of in one-shot migration helpers.

### Fix

`lib/km-core/src/store/GraphKMStore.ts:539-542` — one-line widening of the BC short-circuit:

```ts
private isActive(entity: Entity, nowMs: number): boolean {
  if (entity.validUntil === undefined || entity.validUntil === null) return true;
  return new Date(entity.validUntil).getTime() > nowMs;
}
```

Updated JSDoc to document the JSON-roundtrip rationale (`null` is the inevitable shape after JSON round-trip of an optional field; treating it as equivalent to `undefined` matches caller intent AND OKM legacy behavior).

The fix is type-safe: `Entity.validUntil` is declared `validUntil?: string;` (optional, not nullable) at `lib/km-core/src/types/entity.ts:139`, but JSON deserialization produces `null` for explicit null literals — the implementation must tolerate both even if the type declaration doesn't.

### Why this is the right fix location

Three candidate fix locations were considered:

1. **Migration script side** — change `validUntil: null` → `undefined`. **Rejected**: would require re-running migration over 1327+802 already-persisted entities, and any future caller that JSON-roundtrips an unstamped entity hits the same trap.

2. **Handler side** — pass `includeSuperseded: true` through every read path. **Rejected**: defeats the D-34 default and forces every downstream caller to remember the workaround (Phase 42.2 already did this once and shipped a comment apologizing for it).

3. **km-core `isActive` side** — treat `null` as equivalent to `undefined` (this fix). **Accepted**: `null` is the natural JSON serialization of an absent timestamp, and "no expiry stamped" is the same semantic in both encodings.

No existing km-core test depends on `null` being treated as superseded — verified via `grep -n "validUntil.*null" tests/`. All 34 graph-store unit tests pass post-fix.

---

## Verification

After fixes (km-core rebuilt, obs-api kickstarted):

```text
$ curl -s "http://localhost:12436/api/v1/entities?limit=5000" | jq '.data | length'
2129

$ curl -s "http://localhost:12436/api/v1/entities?limit=3" | jq '.success'
true

$ curl -s "http://localhost:12436/api/coding/observations?limit=1" | jq '{total, returned:(.data|length)}'
{ "total": 874, "returned": 1 }

$ curl -s "http://localhost:12436/api/coding/digests?limit=1" | jq '{total, returned:(.data|length)}'
{ "total": 373, "returned": 1 }

$ curl -s "http://localhost:12436/api/coding/insights?limit=1" | jq '{total, returned:(.data|length)}'
{ "total": 80, "returned": 1 }
```

All four targeted endpoints return non-empty data with the expected legacy SQLite totals exactly (874 / 373 / 80). The /api/v1 surface returns the full 2129-entity superset.

km-core unit tests: `34 passed (34)` — no regression.

---

## Files Changed

- `lib/km-core/src/store/GraphKMStore.ts` — `isActive` widens BC short-circuit to accept `null` alongside `undefined`; JSDoc explains JSON-roundtrip rationale.
- `lib/km-core/dist/store/GraphKMStore.{js,d.ts,js.map,d.ts.map}` — regenerated via `npm run build` (mandatory submodule rebuild step per project CLAUDE.md).
- `scripts/observations-api-server.mjs` — `collectByOntologyClass` switched from private `_kmStore.graph.nodeEntries()` to public `_kmStore.findByOntologyClass(cls)`.

No data was modified. Both fixes are forward-compatible with existing on-disk state (no migration / backfill required).

## Follow-ups (not blockers)

- The `/api/v1/entities` handler does not forward `includeSuperseded` from the query string. With the `isActive` fix in place this is no longer a regression, but a future planner may want to expose it for explicit history retrieval.
- The migration scripts (`migrate-sqlite-to-kmcore.mjs`, `augment-team-field-42.2.mjs`) still emit `validUntil: null`. They no longer break anything, but a Plan 11 close-out could land a one-shot in-place normalization (`null → undefined`) for tidiness.
