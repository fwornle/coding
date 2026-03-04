---
phase: 6
slug: entity-quality
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-04
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Manual validation via `ukb full` pipeline execution |
| **Config file** | none — integration testing via live pipeline |
| **Quick run command** | `npm run build` in submodule + Docker rebuild + `ukb full debug` |
| **Full suite command** | `ukb full` for real LLM execution |
| **Estimated runtime** | ~300 seconds (full pipeline with LLM calls) |

---

## Sampling Rate

- **After every task commit:** Run `cd integrations/mcp-server-semantic-analysis && npm run build`
- **After every plan wave:** Run Docker rebuild + `ukb full debug` (mock mode smoke test)
- **Before `/gsd:verify-work`:** `ukb full` with real LLM must complete successfully
- **Max feedback latency:** 30 seconds (build), 300 seconds (full pipeline)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| TBD | 01 | 1 | QUAL-01 | smoke | After `ukb full`: query KG entities, verify 3+ observations per entity | N/A | ⬜ pending |
| TBD | 01 | 1 | QUAL-02 | smoke | `ls knowledge-management/insights/*.md` cross-checked with KG entity names | N/A | ⬜ pending |
| TBD | 02 | 1 | QUAL-03 | smoke | `ls knowledge-management/insights/images/*.png` verify L1/L2 coverage | N/A | ⬜ pending |
| TBD | 02 | 1 | QUAL-05 | smoke | `grep -l "Related Entities" knowledge-management/insights/*.md` + verify links | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

*Existing infrastructure covers all phase requirements. No new test framework required — validation is done through pipeline execution and output inspection.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Observation specificity (references code artifacts) | QUAL-01 | Quality assessment requires reading observation content | After `ukb full`: read 5 random entity observations, verify each references a file/class/function |
| Insight document narrative quality | QUAL-02 | Prose quality assessment | After `ukb full`: read 3 insight .md files, verify architecture context + purpose + patterns sections |
| PlantUML diagram renders correctly | QUAL-03 | Visual correctness check | Open 2 L1/L2 entity .png files, verify they are readable diagrams (not error images) |
| Cross-reference link targets exist | QUAL-05 | Link integrity check | Click 3 relative markdown links in insight docs, verify target .md files exist |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 300s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
