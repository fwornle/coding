---
phase: 44-rest-api-git-snapshots
plan: 09-amend
subsystem: km-core + C (OKM)
type: execute
tags: [cross-repo, rule-1-fix, fixture-relock, operator-decision-ratified, byte-equal-10-of-10]
status: complete — 10/10 byte-equal; OKM PR #5 updated; awaiting operator merge
requires:
  - 44-09-SUMMARY.md      # the three documented drifts + operator decision options
provides:
  - "km-core /api/v1/export: edge source/target propagated to wire (Drift #2 fix)"
  - "km-core /api/v1/graph/connectivity: populated components[] via BFS (Drift #3 fix)"
  - "OKM Phase 43 D-G5.1 fixture set re-recorded with bare relations (Option A ratified)"
  - "OKM PR https://bmw.ghe.com/adpnext-apps/operational-knowledge-management/pull/5 — 10/10 byte-equal"
affects:
  - lib/km-core/src/api/handlers/query.ts
  - lib/km-core/tests/integration/api-router.test.ts
  - _work/rapid-automations/integrations/operational-knowledge-management/vendor/fwornle-km-core-0.1.0.tgz
  - _work/rapid-automations/integrations/operational-knowledge-management/package-lock.json
  - _work/rapid-automations/integrations/operational-knowledge-management/tests/fixtures/pre-migration/api-entities.json
  - _work/rapid-automations/integrations/operational-knowledge-management/tests/fixtures/pre-migration/api-relations.json
  - _work/rapid-automations/integrations/operational-knowledge-management/tests/fixtures/pre-migration/api-export.json
  - _work/rapid-automations/integrations/operational-knowledge-management/tests/fixtures/pre-migration/api-graph-connectivity.json
decisions:
  - "Drift #1 → Option A ratified: bare IDs are the canonical /api/v1 contract; fixtures re-recorded; no composite-prefix projection added to km-core (would have introduced OKM-specific knowledge per the original SUMMARY's framing)"
  - "Drift #2 fix: pass `from: e.source as EntityId, to: e.target as EntityId` into relationToWire so the wire envelope carries populated source/target (graphology export() puts these at top level, not inside attributes)"
  - "Drift #3 fix: extend the existing per-component BFS to accumulate nodeIds and produce {index, isMainComponent, nodeIds, size} records; isMainComponent flags the maximum-size component (encounter-order ties break first-wins)"
  - "Composite vs bare in /export and /graph/connectivity wire shape: the recorded fixtures carry composite IDs (`evidence:f1f00001-...`) because km-core walks graphology directly via graph.export() / graph.forEachNode(), and OKM's GraphStore stores composite node keys. km-core does NOT strip — that would introduce OKM-specific convention into the framework-agnostic package. The contracts.ts schema uses `z.string()` (composite-tolerant), so this is wire-shape valid; only the /relations endpoint emits bare (via findRelations which strips). This is consistent with the original 44-09-SUMMARY Drift #1 analysis."
metrics:
  duration: ~50min
  completed_date: 2026-06-04T05:47:49Z
  tasks_completed: 10
  tasks_total: 10
  km_core_commits: 3
  okm_commits: 1
  outer_repo_commits: 1
  contract_test_pass_ratio: "10/10 byte-equal + 10/10 schema-parse"
  km_core_test_count_before: 285
  km_core_test_count_after: 287
key-files:
  created:
    - .planning/phases/44-rest-api-git-snapshots/44-09-AMEND-SUMMARY.md
  modified:
    - lib/km-core/src/api/handlers/query.ts
    - lib/km-core/tests/integration/api-router.test.ts
    - _work/rapid-automations/integrations/operational-knowledge-management/vendor/fwornle-km-core-0.1.0.tgz
    - _work/rapid-automations/integrations/operational-knowledge-management/package-lock.json
    - _work/rapid-automations/integrations/operational-knowledge-management/tests/fixtures/pre-migration/api-entities.json
    - _work/rapid-automations/integrations/operational-knowledge-management/tests/fixtures/pre-migration/api-relations.json
    - _work/rapid-automations/integrations/operational-knowledge-management/tests/fixtures/pre-migration/api-export.json
    - _work/rapid-automations/integrations/operational-knowledge-management/tests/fixtures/pre-migration/api-graph-connectivity.json
---

# Phase 44 Plan 09 (Amendment): Drifts #2 + #3 Fixed, Fixtures Re-recorded Summary

Mechanical follow-up to Plan 09's halt-before-commit checkpoint. The
three drifts the original SUMMARY surfaced for operator review have all
been resolved:

  - **Drift #1** (architectural / operator decision): **Option A
    ratified.** Bare IDs are the canonical /api/v1 contract; the three
    affected fixtures were re-recorded against the post-cutover
    km-core router.
  - **Drift #2** (Rule-1 bug in km-core): fixed in 2 lines per the
    original SUMMARY's recipe.
  - **Drift #3** (Rule-1 incomplete in km-core): fixed by extending the
    per-component BFS to accumulate nodeIds.

10/10 byte-equal achieved. OKM PR #5 updated.

## One-liner

km-core `query.ts` /export propagates edge endpoints + /graph/connectivity
emits populated per-component records; OKM PR #5 re-records 3 fixtures with
bare-relation source/target; 10/10 byte-equal vs Phase 43 D-G5.1 lock.

## km-core changes

### Commit 1 — `a6d0323` (drift #2)
`fix(44-09-amend): export handler propagates edge source/target to wire`

`lib/km-core/src/api/handlers/query.ts` — `/export` handler:

```ts
const wireEdges = exported.edges.map((e) => {
  // 44-09 Drift #2 fix: graphology's export() puts source/target at the
  // TOP LEVEL of each edge object — NOT inside e.attributes.
  const w = relationToWire({
    ...e.attributes,
    from: e.source as EntityId,
    to: e.target as EntityId,
    key: e.key,
  });
  // ... unchanged wrapping into {key, source, target, attributes, undirected?}
});
```

Added `import type { EntityId } from '../../ids/branded.js';` so the
cast is type-honest (matches the existing pattern in
`handlers/entities.ts` and `handlers/relations.ts`).

The outer envelope still wraps `relationToWire`'s output into the
graphology-edge wire shape `{key, source, target, attributes,
undirected?}` per `ExportEndpointResponse` — the wrapping was correct
before, only the input to relationToWire was missing endpoints.

### Commit 2 — `5896ee8` (drift #3)
`feat(44-09-amend): graph-connectivity emits per-component nodeIds via BFS`

`lib/km-core/src/api/handlers/query.ts` — `/graph/connectivity`
handler. Replaced the size-only counter (`componentSizes: number[]`)
with a record accumulator:

```ts
const componentRecords: Array<{
  index: number;
  isMainComponent: boolean;
  nodeIds: string[];
  size: number;
}> = [];

// ... BFS pushes each visited node into `nodeIds`, then per-component
//     record carries {index: encounter-order, isMainComponent: false,
//     nodeIds, size: nodeIds.length}.

// Flag the maximum-size component (first-wins on size ties).
if (componentRecords.length > 0) {
  let mainIdx = 0;
  let mainSize = componentRecords[0].size;
  for (let i = 1; i < componentRecords.length; i++) {
    if (componentRecords[i].size > mainSize) {
      mainSize = componentRecords[i].size;
      mainIdx = i;
    }
  }
  componentRecords[mainIdx].isMainComponent = true;
}
```

`componentCount` and `largest`-derived `connectivity` continue to be
computed from the same record set — no change in those fields. The
only new output is the populated `components: componentRecords` array
(was `[]` before).

`islandNodes: []` is left untouched — OKM's fixture has it empty too,
and the operational definition of "island" (small-but-not-largest
non-trivial component) is already captured in `componentRecords` with
`isMainComponent: false`; surfacing a separate islandNodes view would
duplicate data without adding signal. Future refinement if a consumer
needs the projection.

### Commit 3 — `c7bc236` (regression locks)
`test(44-09-amend): tighten api-router assertions on export + connectivity`

`lib/km-core/tests/integration/api-router.test.ts` — added 2 focused
tests:

  1. `GET /api/v1/export propagates edge source/target to wire (44-09 Drift #2)`:
     seeds two entities + one relation; asserts each exported edge has
     non-empty `source` and `target` strings (regression lock —
     missing endpoints was the bug); also asserts the seeded relation
     is found in the exported edges by exact source/target id match.
  2. `GET /api/v1/graph/connectivity populates components array (44-09 Drift #3)`:
     seeds two connected entities + one orphan; asserts:
       - `componentCount === components.length`
       - every component record has `{index, size, isMainComponent, nodeIds}`
         with `nodeIds.length === size`
       - exactly one component is `isMainComponent: true`
       - the main component has maximum size
       - indices are `0..N-1` in encounter order
       - `trueOrphans` is populated (we seeded one)

Both tests pass on the post-fix code; both would fail on the pre-fix code.

### km-core build + test
`cd lib/km-core && npm run build` — clean (TSC exit 0).
`cd lib/km-core && npx vitest run` — 287 / 287 passed (was 285;
the 2 new regression-lock tests are the delta).

### km-core remote
Pushed to `github.com:fwornle/km-core.git` main:
`1298b51..c7bc236 main -> main`. Outer-repo submodule pointer bumped
`1298b51 -> c7bc236` via commit `5a178f94b` on coding-repo main:
`chore(44-09-amend): bump km-core pointer — drifts #2 + #3 + test tighten`.

## OKM PR #5 update

### Tarball repack
`cd lib/km-core && npm pack` produced `fwornle-km-core-0.1.0.tgz`
(196,020 bytes; was 195,233 before this amendment). Copied to
`_work/.../okm/vendor/fwornle-km-core-0.1.0.tgz`.

### node_modules refresh
`rm -rf node_modules package-lock.json && npm install --legacy-peer-deps`
to invalidate the prior tarball integrity hash. New install correctly
materializes `node_modules/@fwornle/km-core/dist/api/handlers/query.js`
with both Drift #2 and Drift #3 fixes visible at the expected line
positions (grep verified).

`cd OKM && npm run build` — clean.

### Fixture re-record
`cd OKM && node scripts/record-rest-fixtures.mjs` — recorded all 10
fixtures into `tests/fixtures/pre-migration/`. Four files diffed:

| Fixture                             | Expected | Diff nature                                   |
| ----------------------------------- | :------: | :-------------------------------------------- |
| `api-entities.json`                 | bystander | ontologyClass key-position shift only (jq -S identical) |
| `api-relations.json`                | yes      | Drift #1 Option A: composite → bare source/target |
| `api-export.json`                   | yes      | Drift #2: edges now have populated source/target (composite, since km-core walks graphology directly) |
| `api-graph-connectivity.json`       | yes      | Drift #3: components[] now populated with `{index, isMainComponent, nodeIds, size}` records |

Verified via `diff <(jq -S a) <(jq -S b)` that `api-entities.json` is
semantically identical to the pre-amendment fixture (this byte-shift
was documented in original 44-09-SUMMARY § Verification as the 4th
"diff" that was not a semantic divergence).

**No unintended drift** — the 6 other fixtures (search, clusters,
stats, ontology-classes, ontology-entity-types, rca-lookup) are
byte-identical to the pre-amendment fixtures (preserved unchanged on
disk).

### Wire shape: composite vs bare nuance

The /api/v1/relations fixture now carries bare IDs as the canonical
contract (Option A). The /api/v1/export and /api/v1/graph/connectivity
fixtures carry composite IDs (`evidence:f1f00001-...`) because the
km-core handlers for those endpoints walk `graph.export()` and
`graph.forEachNode()` directly — and OKM's `GraphStore.addEntity`
stores entities under composite keys (`${layer}:${id}`). km-core does
NOT strip prefixes (that would re-introduce OKM-specific knowledge
into the framework-agnostic package, per the original 44-09-SUMMARY's
Drift #1 framing). The contracts schema (`z.string()`) accepts both
shapes, so byte-equal verification passes. /api/v1/relations is the
only endpoint that emits bare IDs, because its path goes through
`findRelations` which calls `stripLayer` on graphology edge endpoints.

This is consistent with km-core's design as a framework-agnostic
package. If a downstream consumer needs a fully-bare /api/v1 surface
across all endpoints, the work belongs in OKM's data layer (have OKM's
GraphStore store bare keys, matching km-core's own GraphKMStore
convention), not in km-core's HTTP serializers.

### Verification
`cd OKM && npx vitest run tests/integration/rest-contract.test.ts`:
**10 passed / 10 total** (was 7 / 10; the 3 previously-failing
endpoints — relations, export, graph-connectivity — now byte-equal).

### Push
Committed as `49fe794`:
```
fix(44-09-amend): re-record 3 fixtures with bare IDs + km-core handler fixes (drifts 2+3)
```
Pushed to `bmw.ghe.com/adpnext-apps/operational-knowledge-management`
on branch `gsd/44-09-rest-cutover-v2` via HTTPS-token auth:
`246390b..49fe794 gsd/44-09-rest-cutover-v2 -> gsd/44-09-rest-cutover-v2`.

PR #5 (https://bmw.ghe.com/adpnext-apps/operational-knowledge-management/pull/5)
auto-updated. **NOT merged** (operator-owned per directive).

## OKM PR + commits

| Hash      | Subject                                                                                        |
| --------- | ---------------------------------------------------------------------------------------------- |
| `2ea3fb1` | `chore(44-09): bump vendored @fwornle/km-core to post-refit build` (pre-amendment, on PR)      |
| `3649335` | `refactor(44-09): mount createKmCoreRouter at /api/v1; relocate OKM-specific routes to /api/okm` |
| `41522a4` | `test(44-09): import REST contract schemas from @fwornle/km-core; rewrite URLs to /api/v1`     |
| `246390b` | `refactor(44-09): rewrite viewer + fixture-scripts URLs to /api/v1 and /api/okm prefixes`      |
| `49fe794` | **`fix(44-09-amend): re-record 3 fixtures with bare IDs + km-core handler fixes (drifts 2+3)`** |

## km-core commits (this amendment)

| Hash      | Subject                                                                  |
| --------- | ------------------------------------------------------------------------ |
| `a6d0323` | `fix(44-09-amend): export handler propagates edge source/target to wire` |
| `5896ee8` | `feat(44-09-amend): graph-connectivity emits per-component nodeIds via BFS` |
| `c7bc236` | `test(44-09-amend): tighten api-router assertions on export + connectivity` |

## Coding-repo outer commits (this amendment)

| Hash         | Subject                                                                  |
| ------------ | ------------------------------------------------------------------------ |
| `5a178f94b`  | `chore(44-09-amend): bump km-core pointer — drifts #2 + #3 + test tighten` |
| (this file)  | `docs(44-09-amend): record amendment summary — 10/10 byte-equal achieved` |

## What was NOT done (per directive)

  - **STATE.md, ROADMAP.md** in coding repo: untouched.
  - **OKM PR merge**: PR #5 still open; operator-owned.
  - **Service restart** (obs-api, semantic-analysis container,
    OKM-side API): operator-owned per directive.
  - **Cross-system-parity C-leg flip**: depends on PR merge + OKM
    service restart; operator action per directive.
  - **No v2/enhanced/new file names** introduced (verified — only
    in-place edits to `query.ts` and `api-router.test.ts`).

## Self-Check: PASSED

  - `lib/km-core/src/api/handlers/query.ts` contains the Drift #2 fix
    (`from: e.source as EntityId, to: e.target as EntityId, key: e.key`):
    ✓ (`grep -c "from: e.source as EntityId" lib/km-core/src/api/handlers/query.ts` → 1).
  - `lib/km-core/src/api/handlers/query.ts` contains the Drift #3 BFS
    accumulator (`componentRecords` + `isMainComponent`): ✓
    (`grep -c "componentRecords" lib/km-core/src/api/handlers/query.ts` → multiple hits across BFS, flagging, and response).
  - `lib/km-core/tests/integration/api-router.test.ts` contains the 2
    new regression-lock tests: ✓
    (`grep -c "Drift #2\\|Drift #3" lib/km-core/tests/integration/api-router.test.ts` → multiple).
  - km-core full suite: 287/287 passed: ✓ (post-amendment vs 285
    pre-amendment).
  - km-core commits pushed to `github.com:fwornle/km-core.git`:
    `1298b51..c7bc236`: ✓ (verified via `git push` output).
  - km-core submodule pointer bumped in coding repo (`1298b51 ->
    c7bc236`): ✓.
  - km-core tarball repacked (196,020 bytes) + copied into OKM
    vendor/: ✓ (verified via `ls -la`).
  - OKM `npm install --legacy-peer-deps` clean: ✓.
  - OKM `npm run build` clean: ✓.
  - OKM dist tarball materializes Drift #2 + Drift #3 fixes: ✓
    (verified via `grep` for the fix landmarks in
    `node_modules/@fwornle/km-core/dist/api/handlers/query.js`).
  - 4 fixtures changed (3 expected + 1 documented-benign bystander): ✓
    (`git status tests/fixtures/pre-migration/` reports exactly those
    four; semantic diff for api-entities is empty).
  - 6 other fixtures byte-identical to pre-amendment: ✓ (not in
    `git status` modified list).
  - OKM `npx vitest run tests/integration/rest-contract.test.ts`:
    10/10 passed: ✓.
  - OKM commit pushed via HTTPS to bmw.ghe.com (no SSH): ✓
    (`git remote get-url origin` returns
    `https://bmw.ghe.com/...`; push output confirms HTTPS endpoint).
  - OKM PR #5 NOT merged: ✓.
  - No v2/enhanced/new file names introduced: ✓.

## Resume Signal

Operator can now:

  1. **Review OKM PR #5** at
     https://bmw.ghe.com/adpnext-apps/operational-knowledge-management/pull/5
     (latest commit `49fe794`, 10/10 byte-equal).
  2. **Merge PR #5** — single-click after review.
  3. **Restart C's service** (OKM API + viewer) per operator runbook so
     the cross-system-parity script picks up the new contract.
  4. **Flip cross-system-parity C-leg GREEN** —
     `tests/integration/cross-system-parity.mjs` C-leg will go green
     after merge + restart, completing the verification spine the
     three-system parity claim depends on.
  5. **Proceed to Plan 44-10 (SQLite migration)** — unblocked.
