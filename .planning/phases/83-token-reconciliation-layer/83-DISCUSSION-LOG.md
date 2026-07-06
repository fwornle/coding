# Phase 83: Token Reconciliation Layer - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-06
**Phase:** 83-token-reconciliation-layer
**Areas discussed:** Reconcile rollout scope, Discrepancy policy & tolerance, 82-REVIEW fold-ins, reconciliation.json shape

---

## Reconcile rollout scope

**Q: Where should the new reconcile mode apply?**

| Option | Description | Selected |
|--------|-------------|----------|
| Measured spans only (Recommended) | measurement-stop invokes adapters in reconcile mode; interactive Stop/sweep keeps transcript+dedup-merge. Smallest blast radius; per-span sink has a natural home | ✓ |
| Everywhere, uniformly | All claude/copilot stop paths switch to reconcile; needs a sink for non-span sessions; touches sweep path | |
| Measured now, interactive flag-gated | Flag lets interactive opt in for a soak period | |

**Q: How should the proxy-down transcript fallback be triggered?**

| Option | Description | Selected |
|--------|-------------|----------|
| Match-outcome + provenance (Recommended) | Unmatched transcript rows insert as fallback, provenance-tagged, counted in reconciliation.json; matching bugs surface as loud fallback counts | ✓ |
| Health-evidence gated | Insert only with corroborating proxy-down evidence; stronger protection, more moving parts | |
| You decide | | |

**Q: How should interactive (non-measured) copilot sessions avoid double-counting?**

| Option | Description | Selected |
|--------|-------------|----------|
| BYOK only for measured runs (Recommended) | Gate COPILOT_PROVIDER_* exports to measured launches; interactive copilot stays copadt-only; fixes WR-05 too | ✓ |
| Suppress copadt when wire rows exist | Reconcile-lite check on the interactive sweep path | |
| Accept + track | Documented known double-count until reconcile goes interactive | |

---

## Discrepancy policy & tolerance

**Q: For a matched wire/transcript pair, what may the transcript change on the wire row?**

| Option | Description | Selected |
|--------|-------------|----------|
| Fill gaps only (Recommended) | Wire authoritative, never overwritten; transcript fills missing fields (reasoning_tokens, granularity_tier, parent_call_id, cache when wire=0); count disagreements recorded, never applied | ✓ |
| Transcript wins on richer data | Transcript overwrites zero/smaller wire values; risks masking wire-capture bugs | |
| Record only, no mutation | Pure audit trail; loses reasoning-step enrichment in token_usage | |

**Q: What delta should be flagged as a discrepancy in reconciliation.json?**

| Option | Description | Selected |
|--------|-------------|----------|
| Record all, flag beyond tolerance (Recommended) | Every nonzero delta recorded per-request; beyond tolerance (~>2% or >50 tokens/field) gets flagged=true + span-summary rollup | ✓ |
| Flag any nonzero delta | Maximum sensitivity; jitter makes every span look dirty | |
| You decide | Calibrate from Phase-82 verification data | |

**Q: What should a flagged discrepancy do to the measured run?**

| Option | Description | Selected |
|--------|-------------|----------|
| Advisory only (Recommended) | Never fails/invalidates a run; surfaced later via Phase-86 badge | ✓ |
| Taint the run's token metrics | tokens_reliable=false marker on the Run entity | |
| Threshold-gated taint | Advisory by default, taint on extreme divergence | |

---

## 82-REVIEW fold-ins

**Q: Which 82-REVIEW findings should fold into Phase 83 scope? (multi-select)**

| Option | Description | Selected |
|--------|-------------|----------|
| CR-01 sanitizeTaskId crash | Guard both unguarded proxy HTTP-handler call sites; crash-grade | ✓ |
| WR-01 interactive ambient leak | Interactive tap rows inherit concurrent cell span; pollutes primary wire rows | ✓ |
| IN-05 OpenAI-wire cache parse | Shim rows always report 0 cache; parse cached_tokens | ✓ |
| WR-06 inconsistent task-id sanitization | Same logical id keyed 3 ways; breaks DB↔breakdown join | ✓ |

**Q: Fold the duplicate-id fix (PK/unique constraint on token_usage) into Phase 83 too?**

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, fold it in (Recommended) | Matcher makes row identity load-bearing | ✓ |
| No, keep as backlog | Matcher keys on request-id, not id column | |
| You decide | | |

---

## reconciliation.json shape

**Q: What should reconciliation.json contain?**

| Option | Description | Selected |
|--------|-------------|----------|
| Summary + per-request detail (Recommended) | Span summary (matched/unmatched/fallback counts, aggregate deltas, flags) + per-request array (match method, per-field deltas, flags) | ✓ |
| Summary only | Tiny file, enough for a badge; debugging requires re-running the matcher | |
| Summary + flagged requests only | Loses clean-match evidence for the golden comparison | |

**Q: Should Phase 83 expose reconciliation data via a read API, or stay file-only?**

| Option | Description | Selected |
|--------|-------------|----------|
| File + thin read API (Recommended) | GET /api/experiments/runs/:taskId/reconciliation in vkb api-routes.js, serves file verbatim; Phase 86 badge needs zero backend work | ✓ |
| File-only this phase | Defer the API contract to Phase 86 | |
| You decide | | |

---

## Claude's Discretion

- Exact D-05 tolerance values (calibrate against Phase-82 matched-pair data)
- Fuzzy-match window width + tie-breaking for time+model secondary matcher
- reconciliation.json exact field names / schema versioning
- copadt session-state cache-split merge mechanics
- Duplicate-id constraint implementation (migration mechanics, existing-row repair)
- Where D-03 BYOK gating lives (launch-agent-common.sh vs experiment-runner.mjs vs both)

## Deferred Ideas

- WR-03 SSE `delta.tool_calls` missing `index` field — backlog
- WR-04 `CopilotProvider.supportsFunctionCalling` unconditional claim — backlog
- Reconcile mode on the interactive Stop/sweep path — later phase after soak
- Dashboard reconciliation badge — Phase 86
- Re-validating past shim-routed opencode experiment results (v7–v9) — backlog (carried from 82-CONTEXT)
