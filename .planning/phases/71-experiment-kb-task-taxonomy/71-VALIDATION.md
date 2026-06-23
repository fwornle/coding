---
phase: 71
slug: experiment-kb-task-taxonomy
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-23
---

# Phase 71 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Extracted from `71-RESEARCH.md` §"Validation Architecture" — observable signals proving SC-1..SC-4.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node:test` (the repo + proxy convention; backfill self-test uses it) [VERIFIED: backfill-task-id-by-timestamp.mjs:218-219] |
| **Config file** | none — `node --test <file>` (NOTE the argv gotcha, see Wave 0) |
| **Quick run command** | `node --test tests/experiments/<touched>.test.mjs` |
| **Full suite command** | `node --test tests/experiments/` |
| **Estimated runtime** | ~10 seconds (temp-store + temp-DB fixtures, no live network) |

---

## Sampling Rate

- **After every task commit:** Run `node --test tests/experiments/<touched>.test.mjs`
- **After every plan wave:** Run `node --test tests/experiments/`
- **Before `/gsd-verify-work`:** Full experiments suite must be green **AND** the LIVE blocking human-verify (71-05 Task 5) passes — prove a real `coding measure stop` lands a Run in `.data/experiments/` with the enforced `task_class` + correct token totals, AND a headless run with no class lands in quarantine and is excluded from `experiments query`.
- **Max feedback latency:** ~10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 71-01-03 | 01 | 1 | SC-1 / KB-01 | — | Ontology loads without skip-warn; no default-class fallback | unit | `node --test tests/experiments/ontology.test.mjs` | ❌ W0 | ⬜ pending |
| 71-02-02 | 02 | 1 | SC-3 / KB-03 | T-71-05-01 | Closed-6 enum; free strings rejected (no `WHERE`-clause pollution) | unit | `node --test tests/experiments/taxonomy.test.mjs` | ❌ W0 | ⬜ pending |
| 71-03-01 | 03 | 1 | KB-02 (idemp.) | T-71-05-04 | token-usage.db opened `{readonly:true}`; parameterized binds | unit | `node --test tests/experiments/token-aggregate.test.mjs` | ❌ W0 | ⬜ pending |
| 71-04-01 | 04 | 2 | SC-2 / KB-02 | T-71-05-03 | Run keyed on minted id (not raw task_id); idempotent re-close updates | integration | `node --test tests/experiments/run-write.test.mjs` | ❌ W0 | ⬜ pending |
| 71-05-03 | 05 | 2 | SC-4 / KB-03 | T-71-05-01 / T-71-05-02 | Free-string reject + headless quarantine (never hard-block) + query-exclusion + classify re-include | integration | `node --test tests/experiments/enforcement.test.mjs` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

### Observable Signals → Success Criteria

| Req ID | Behavior | Test Type | Automated Command |
|--------|----------|-----------|-------------------|
| SC-1 / KB-01 | Ontology defines all 7 classes (`Experiment, Run, Route, Step, Decision, Outcome, Report`) + relations; loads without skip-warn; `store.ontology.getAllClassNames()` ⊇ the 7; `isValidClass('Run')` true | unit | `node --test tests/experiments/ontology.test.mjs` |
| SC-2 / KB-02 | A real span close materializes a Run with all 8 tags; `agent`/`model`/totals sourced from `token_usage` (not invented); re-close updates the SAME node (idempotent, keyed on minted id not task_id) | integration | `node --test tests/experiments/run-write.test.mjs` + `node --test tests/experiments/token-aggregate.test.mjs` |
| SC-3 / KB-03 | Taxonomy config loads 6 classes each with a non-empty definition; free-string class rejected; `deriveClassFromText('migrate the db')==='migration'` etc. | unit | `node --test tests/experiments/taxonomy.test.mjs` |
| SC-4 / D-06 | Free-string class rejected at write; headless close with no class writes `task_class='unclassified'`+`pending:true` (never hard-blocks); `experiments query` EXCLUDES pending rows; `experiments classify` flips pending→false and re-includes | integration | `node --test tests/experiments/enforcement.test.mjs` + live human-verify (71-05 Task 5) |
| KB-02 idemp. | token aggregation is read-only (`{readonly:true}`) and a re-run after a simulated backfill recomputes complete totals | unit | `node --test tests/experiments/token-aggregate.test.mjs` |

---

## Wave 0 Requirements

- [ ] `tests/experiments/ontology.test.mjs` — covers SC-1/KB-01 (load + 7 classes + no skip-warn + `isValidClass('Run')`)
- [ ] `tests/experiments/taxonomy.test.mjs` — covers SC-3/KB-03 (6 defs + verb→class map + free-string rejection)
- [ ] `tests/experiments/token-aggregate.test.mjs` — covers KB-02 read-only + recompute (temp DB fixture, mirror backfill self-test)
- [ ] `tests/experiments/run-write.test.mjs` — covers SC-2/KB-02 (8 tags + idempotency; temp store dir + temp ontologyDir)
- [ ] `tests/experiments/enforcement.test.mjs` — covers SC-4 (reject free string; quarantine; query-exclusion; classify re-include)
- [ ] Test fixtures: a synthetic archived span JSON + a seeded temp `token-usage.db` (reuse backfill self-test's temp-DB pattern)
- [ ] **argv gotcha guard** (MEMORY.md): `node --test <file> --live` drops trailing argv per-file; gate any live-only test on an env var (`EXPERIMENTS_LIVE=1`), **NOT** a `--live` CLI flag.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| A real `coding measure stop` close lands an enforced + idempotent Run with correct token totals in the dedicated `.data/experiments/` store; a headless/no-class close lands in quarantine and is excluded from `experiments query`; `classify` re-includes it; `.data/knowledge-graph/` untouched | SC-2, SC-4 / KB-02, KB-03 | Requires a real measurement span + live `token-usage.db` rows + the dedicated-store filesystem side effects — mirrors the Phase 69/70 blocking human-verify; cannot be fully proven by unit fixtures alone | See `71-05-PLAN.md` Task 5 (`checkpoint:human-verify`) steps 1–6: start span → work → `measure stop --task-class refactor` → `experiments query --query runs-by-class` → re-close (idempotency) → headless quarantine → `experiments classify` re-include → confirm store isolation |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
