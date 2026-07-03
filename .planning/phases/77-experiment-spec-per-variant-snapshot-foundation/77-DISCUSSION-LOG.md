# Phase 77: Experiment Spec & Per-Variant Snapshot Foundation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-03
**Phase:** 77-experiment-spec-per-variant-snapshot-foundation
**Areas discussed:** Spec format & matrix shape, Validation & fail-fast policy, Restore isolation model, Repeat-determinism proof

---

## Spec format & matrix shape (SPEC-01)

| Option | Description | Selected |
|--------|-------------|----------|
| YAML file, cartesian axes | YAML spec with axes (agents[] × models[] × frameworks[] × env[]) auto-expanding into variants; matches config/task-taxonomy.yaml precedent; compact | ✓ |
| JSON file, explicit variants | JSON + $schema (config/*.json convention); each variant spelled out; $schema-validatable | |
| CLI flags only, no file | Variants via repeated CLI flags; no committable spec file | |

**User's choice:** YAML file, cartesian axes
**Notes:** CLI-flag overrides remain available on top of the file (SPEC-01 "flags and/or file"). Matches the repo's curated-data (taxonomy) YAML precedent rather than the machine-config JSON dir.

---

## Validation & fail-fast policy (SPEC-02)

| Option | Description | Selected |
|--------|-------------|----------|
| Strict enums + refuse whole run | agent + framework closed enums, model warn-if-unknown; any invalid cell aborts whole experiment | |
| Loose (agent-only enum) + refuse whole run | Only agent enum-validated; model + framework free-form; whole-run fail-fast on existing checks | ✓ |
| Validate-and-skip invalid cells | Run valid cells, skip + report invalid ones | |

**User's choice:** Loose (agent-only enum) + refuse whole run
**Notes:** No new closed framework enum this phase (deferred). Derived decision captured in CONTEXT (D-07): the validator still ships a minimal unsupported-**combinations** gate seeded with `copilot + headless → fail fast` (SPEC-02's own named example / Phase-78 spike pointer) — dimensions stay loose, combinations can still be gated. `test_command` validated with SHELL_META_RE at resolve-time (D-08).

---

## Restore isolation model (RUN-01)

| Option | Description | Selected |
|--------|-------------|----------|
| Isolated sandbox, one declare-time baseline | Capture one baseline at declare; restore each cell into fresh isolated worktree + sandbox .data/ (rig default D-04) | ✓ |
| In-place, one declare-time baseline | Single baseline, destructive in-place restore per cell (rig --in-place D-05, needs confirm); serial | |
| Point at an existing snapshot id | Operator supplies existing .data/run-snapshots/<id> as baseline | |

**User's choice:** Isolated sandbox, one declare-time baseline
**Notes:** Wires the shipped Phase-67 rig (`captureSnapshot` at declare, `restoreSnapshot({inPlace:false})` per cell). Never touches the live tree; parallelizable; identical start by construction. `--in-place` not used by the runner in this phase.

---

## Repeat-determinism proof (SC#4)

| Option | Description | Selected |
|--------|-------------|----------|
| Hash tree+KB+routing, assert equal, fail on divergence | Digest restored git tree + .data/knowledge-graph + routing; assert repeats identical; divergence aborts | ✓ |
| Hash + record, warn on divergence | Persist digests as evidence, warn but proceed | |
| Trust snapshot manifest (git_sha) only | Rely on recorded git_sha; no per-restore rehash | |

**User's choice:** Hash tree+KB+routing, assert equal, fail on divergence
**Notes:** Turns SC#4 into a proof, not an assumption. Divergence hard-fails the experiment (comparison untrustworthy if start states differ). Can lean on the Phase-67 manifest's recorded git_sha + a KB/routing content hash (digest specifics = Claude's Discretion).

---

## Claude's Discretion
- Exact YAML schema key names/nesting; optional named-explicit-variant escape hatch alongside axes.
- Digest algorithm + exactly what bytes feed it (must deterministically cover tree + KB + routing).
- Home of the experiment-spec resolver/validator module and how variant fields thread into `measurement-start.mjs` meta (new flags vs `--spec/--variant` mode).
- Actionable-error wording for invalid cells / unsupported combinations.

## Deferred Ideas
- Closed framework/approach enum (straight | gsd | sdd) → later (revisit for Phase 79 report labels).
- Actual Copilot headless drivability → Phase 78 (RUN-04 spike).
- Autonomous agent launch (RUN-02/03) → Phase 78; success gate / variance / report (CMP-01/02/03) → Phase 79; policy engine → v7.6.
- Reviewed-not-folded todos: okm-express-api-contract-bridge, sub-agent-dashboard-observability-gap (weak keyword matches; unrelated to spec/runner scope).
