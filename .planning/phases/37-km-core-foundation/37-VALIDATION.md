---
phase: 37
slug: km-core-foundation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-19
---

# Phase 37 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Source: `37-RESEARCH.md` §Validation Architecture (lines 769–831).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest ^4.0.18 (mirrors OKM's pin; ESM-native, TS-native) |
| **Config file** | `vitest.config.ts` — copy from `_work/rapid-automations/integrations/operational-knowledge-management/vitest.config.ts` (Wave 0 installs) |
| **Quick run command** | `npm test -- tests/unit/<file>.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~15–30 seconds (OKM full suite at 22 files runs ~15s on M1) |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- tests/unit/<file>.test.ts` (quick, <2s/file)
- **After every plan wave:** Run `npm test` (full suite, including integration parity)
- **Before `/gsd:verify-work`:** Full unit + integration suite green
- **Max feedback latency:** ≤30 seconds

---

## Per-Task Verification Map

> Plan-level task IDs (37-NN-NN) are not yet assigned at this point — the planner will populate them. This map captures the **requirement → test → command** triples the planner must wire onto specific tasks.

| Req | Behavior | Test Type | Automated Command | File Exists | Status |
|-----|----------|-----------|-------------------|-------------|--------|
| CORE-01 | `Entity` / `Relation` types importable under `strict: true` from a TS consumer | unit (type-level, `expectTypeOf` / `tsd`) | `npm test -- tests/unit/entity.test.ts` | ❌ W0 | ⬜ pending |
| CORE-01 | `EntityId` branded type rejects raw `string` at compile time | unit (compile-fail via `// @ts-expect-error`) | `npm test -- tests/unit/ids.test.ts` | ❌ W0 | ⬜ pending |
| CORE-02 | `GraphKMStore.putEntity` + `getEntity` round-trip preserves all fields | unit | `npm test -- tests/unit/graph-store.test.ts` | ❌ W0 | ⬜ pending |
| CORE-02 | `GraphKMStore.exportJson` writes per-domain files atomically (temp + rename) | unit | `npm test -- tests/unit/exporter.test.ts` | ❌ W0 | ⬜ pending |
| CORE-02 | `GraphKMStore.batch(ops[])` is all-or-nothing under failure | unit | `npm test -- tests/unit/graph-store.test.ts` | ❌ W0 | ⬜ pending |
| CORE-02 | `GraphKMStore` emits `entity:put`, `entity:delete`, `relation:added`, `relation:removed` events | unit | `npm test -- tests/unit/graph-store.test.ts` | ❌ W0 | ⬜ pending |
| CORE-02 | `GraphKMStore.iterate({ filter })` is lazy and filter-honoring | unit | `npm test -- tests/unit/graph-store.test.ts` | ❌ W0 | ⬜ pending |
| CORE-02 | LevelDB-first / JSON-fallback startup hydrates the in-memory graph identically | unit | `npm test -- tests/unit/persistence.test.ts` | ❌ W0 | ⬜ pending |
| CORE-02 | 5-second debounce coalesces multiple writes; only one atomic flush | unit | `npm test -- tests/unit/exporter.test.ts` | ❌ W0 | ⬜ pending |
| CORE-02 | Parity: import frozen `b-coding-snapshot.json`, export, byte-equal after canonical key-sort | integration | `npm test -- tests/integration/round-trip.test.ts` | ❌ W0 | ⬜ pending |
| CORE-02 | Parity: same round-trip for `c-raas-snapshot.json`, `c-kpifw-snapshot.json`, `c-general-snapshot.json` | integration | `npm test -- tests/integration/round-trip.test.ts` | ❌ W0 | ⬜ pending |
| CORE-02 | Strict ontology validation rejects unknown class on `putEntity`; `skipOntologyCheck: true` allows | unit | `npm test -- tests/unit/graph-store.test.ts` | ❌ W0 | ⬜ pending |
| CORE-03 | `putEntity` without `id` stamps a fresh UUIDv7 matching the v7 regex | unit | `npm test -- tests/unit/ids.test.ts` | ❌ W0 | ⬜ pending |
| CORE-03 | `putEntity` with caller-supplied valid UUIDv7 keeps the ID verbatim (idempotency) | unit | `npm test -- tests/unit/ids.test.ts` | ❌ W0 | ⬜ pending |
| CORE-03 | `putEntity` with caller-supplied invalid id throws via `parseEntityId` | unit | `npm test -- tests/unit/ids.test.ts` | ❌ W0 | ⬜ pending |
| CORE-03 | UUIDv7 IDs survive `exportJson()` → re-import round-trip unchanged | integration | `npm test -- tests/integration/round-trip.test.ts` | ❌ W0 | ⬜ pending |
| CORE-03 | UUIDv7 IDs sort lexicographically by creation time (k-sortability) | unit | `npm test -- tests/unit/ids.test.ts` | ❌ W0 | ⬜ pending |
| SC#4 | `.data/knowledge-export/coding.json` symlink resolves to `.data/exports/coding.json`; OKB-baseline hook regex matches both | integration (shell) | `bash tests/integration/symlink-bc.sh` | ❌ W0 | ⬜ pending |

*Status legend:* ⬜ pending · ✅ green · ❌ red · ⚠️ flaky

---

## Wave 0 Requirements

All test files are net-new (KM-Core is a brand-new package). Wave 0 must create:

- [ ] `vitest.config.ts` — copy from OKM verbatim with path adjustments
- [ ] `tests/unit/entity.test.ts` — CORE-01 (type exports, branded `EntityId`)
- [ ] `tests/unit/ids.test.ts` — CORE-03 (UUIDv7 stamp, validation, k-sortability)
- [ ] `tests/unit/graph-store.test.ts` — CORE-02 (CRUD, `batch`, `iterate`, events, ontology validation)
- [ ] `tests/unit/persistence.test.ts` — CORE-02 (LevelDB hydrate, JSON fallback)
- [ ] `tests/unit/exporter.test.ts` — CORE-02 (atomic temp+rename, 5s debounce, per-domain bucketing)
- [ ] `tests/integration/round-trip.test.ts` — CORE-02 parity + CORE-03 ID survival across 4 fixtures
- [ ] `tests/integration/symlink-bc.sh` — ROADMAP SC#4 (legacy-path symlink BC + pre-commit hook regex)
- [ ] `tests/fixtures/b-coding-snapshot.json` — captured at start of Phase 37 from `coding/.data/knowledge-export/coding.json`
- [ ] `tests/fixtures/c-raas-snapshot.json` — captured from `_work/rapid-automations`
- [ ] `tests/fixtures/c-kpifw-snapshot.json` — captured from `_work/rapid-automations`
- [ ] `tests/fixtures/c-general-snapshot.json` — captured from `_work/rapid-automations`
- [ ] Framework install: `npm install --save-dev vitest@^4.0.18 @vitest/expect typescript@^5.9.3 @types/node@^22.0.0`

Total fixture footprint: ~400KB committed under `tests/fixtures/` (each snapshot <100KB).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Importing `Entity`/`Relation` types in `coding/` after the submodule mount works end-to-end | CORE-01 (cross-repo consumer view) | Requires the submodule to be registered + the consumer side to be wired (Wave 4 in the planner's seam map). A fresh shell + `tsc --noEmit` from coding's side proves it; cannot reasonably live as a unit test inside `km-core/`. | After the submodule is mounted at `coding/lib/km-core/`, in `coding/`: write a one-line probe `import type { Entity } from '@fwornle/km-core'` in a scratch `.ts` file, run `npx tsc --noEmit scratch.ts`, expect exit 0. |
| Pre-commit OKB-baseline hook still fires on `.data/exports/{domain}.json` paths after the symlinks land | SC#4 (D-23) | The hook runs in a real git commit context; safest to confirm by attempting a representative two-commit + one-commit mistake in a clean working copy. | Stage only `.data/exports/coding.json` → commit → expect success. Stage `.data/exports/coding.json` + `.data/observation-export/observations.json` together → commit → expect hook to fire and block. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references above
- [ ] No watch-mode flags
- [ ] Feedback latency <30s
- [ ] `nyquist_compliant: true` set in frontmatter (set after the planner wires task IDs into this map)

**Approval:** pending
