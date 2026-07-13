# Phase 80: Experiment Surface — Dashboard & Skill Packaging - Discussion Log

> **Audit trail only.** Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-13
**Phase:** 80-experiment-surface-dashboard-skill-packaging
**Areas discussed:** Dashboard surface, Comparison data source, Skill scope, Skill distribution

---

## Dashboard surface (CMP-04)

| Option | Description | Selected |
|--------|-------------|----------|
| New "Comparison" sub-tab | Dedicated variant-matrix tab alongside Runs/Avenues/Compare/Reports | ✓ |
| Enhance existing "Compare" tab | Add matrix mode to the 2-run A/B tab | |
| Enhance "Reports" tab | Render matrix inside Phase 74 saved-queries tab | |

**User's choice:** New "Comparison" sub-tab
**Notes:** Avoids conflating with the existing manual A/B "Compare" tab (audit-flagged as NOT variant-aware) and Phase 74's "Reports" (saved queries). Matrix = variants as columns, metrics/variance/gate as rows, ranked.

---

## Comparison data source (CMP-04)

| Option | Description | Selected |
|--------|-------------|----------|
| Live backend endpoint | GET /api/experiments/comparison?task_hash=X → readRuns + buildComparison, always fresh | ✓ |
| Read persisted JSON export | Serve the CLI's .data/experiments/reports/<task_hash>.json (stale/absent unless CLI run) | |

**User's choice:** Live backend endpoint
**Notes:** "Without re-running the experiment" satisfied robustly — the endpoint recomputes the comparison over stored Runs on demand; no dependency on the CLI having been run. Endpoint lives on the vkb-server (:8080), not the dashboard server.js (which only proxies).

---

## Skill scope (ORCH-01)

| Option | Description | Selected |
|--------|-------------|----------|
| Full flow (run + compare) | `experiment run` launches matrix then auto-compares + prints ranked table + writes report JSON | ✓ |
| Run only | Skill wraps just the matrix launch; compare is separate | |

**User's choice:** Full flow (run + compare)
**Notes:** Delivers success-criterion 3 (one-line command → rendered comparison end-to-end). Thin wrapper over experiment-run.mjs + experiments-compare.mjs.

---

## Skill distribution (ORCH-01)

| Option | Description | Selected |
|--------|-------------|----------|
| All driveable agents | Install to claude/copilot/opencode(/mastra) via generate-agent-instructions.sh | ✓ |
| Claude only (v1) | Install to .claude/commands only | |

**User's choice:** All driveable agents
**Notes:** Matches ORCH-01's "across the coding agents" wording. Copilot/OpenCode hook-schema quirks apply (memory feedback_copilot_hook_schema).

## Claude's Discretion

- Matrix cell formatting, column ordering within a rank tier, variance rendering.
- Redux slice shape (mirror performanceSlice createAsyncThunk).
- Skill file prose (mirror existing .claude/commands/*.md).

## Deferred Ideas

- None — stayed within CMP-04 + ORCH-01. Remaining v7.5 work (Phase 78-05 live gate + close-out) tracked separately.
