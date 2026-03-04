---
phase: 7
slug: hierarchy-completeness
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-04
---

# Phase 7 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | TypeScript compiler (tsc --noEmit) + smoke test (ukb full) |
| **Config file** | integrations/mcp-server-semantic-analysis/tsconfig.json |
| **Quick run command** | `cd integrations/mcp-server-semantic-analysis && npx tsc --noEmit` |
| **Full suite command** | `cd integrations/mcp-server-semantic-analysis && npm run build` |
| **Estimated runtime** | ~5 seconds (tsc), ~15 seconds (build), ~3 min (ukb full smoke) |

---

## Sampling Rate

- **After every task commit:** Run `cd integrations/mcp-server-semantic-analysis && npx tsc --noEmit`
- **After every plan wave:** Run `npm run build` + Docker rebuild + smoke test
- **Before `/gsd:verify-work`:** Full `ukb full` run with real LLM, human review of output hierarchy
- **Max feedback latency:** 5 seconds (tsc), 75 seconds (build + Docker)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 07-01-xx | 01 | 1 | HIER-01, HIER-02 | compile + smoke | `npx tsc --noEmit` | ✅ | ⬜ pending |
| 07-02-xx | 02 | 1 | HIER-01, HIER-02 | compile + smoke | `npx tsc --noEmit` | ✅ | ⬜ pending |
| 07-03-xx | 03 | 2 | HIER-03 | compile + smoke | `npx tsc --noEmit` | ✅ | ⬜ pending |
| 07-04-xx | 04 | 3 | HIER-01..04 | smoke + manual | `ukb full` + human review | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements:
- TypeScript compilation serves as the primary automated check
- `npm run build` produces `dist/` for Docker
- `ukb full` serves as integration/smoke test (consistent with Phases 5 and 6)
- No new test framework needed

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| L1 components have comprehensive sub-node counts | HIER-01 | Output quality requires human judgment | Run `ukb full`, check entity counts per L1 in KG export. SemanticAnalysis should have 8+ children. |
| Sub-node names reflect real architecture | HIER-02 | Semantic quality of names requires human review | Check insight docs for specific names (BatchScheduler, LLMRetryPolicy) vs generic labels (Pipeline, Insights) |
| Manifest auto-extends with discoveries | HIER-03 | Verify `discovered: true` entries in YAML | Run `ukb full`, then `cat config/component-manifest.yaml` — look for new entries with `discovered: true` |
| Each level provides self-sufficient knowledge | HIER-04 | Reading comprehension quality | Read L1 and L2 entity descriptions independently — should orient a new developer |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 75s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
