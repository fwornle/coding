---
phase: 9
slug: agent-pipeline-integration
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-07
---

# Phase 9 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Custom (no jest/vitest) -- `npm run build` compile check + `ukb full` integration |
| **Config file** | none — no formal test config |
| **Quick run command** | `cd integrations/mcp-server-semantic-analysis && npm run build` |
| **Full suite command** | `ukb full` (end-to-end pipeline run) |
| **Estimated runtime** | ~30 seconds (compile), ~300 seconds (full ukb run) |

---

## Sampling Rate

- **After every task commit:** Run `cd integrations/mcp-server-semantic-analysis && npm run build`
- **After every plan wave:** Run `ukb full` + inspect output
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds (compile check)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 09-01-01 | 01 | 1 | AGNT-03 | smoke | `npm run build` (compile check) | N/A | pending |
| 09-02-01 | 02 | 1 | AGNT-01, AGNT-02 | integration | `ukb full` + entity inspection | N/A | pending |
| 09-03-01 | 03 | 2 | AGNT-05 | integration | `ukb full` + ontology verification | N/A | pending |
| 09-04-01 | 04 | 2 | AGNT-04 | integration | `ukb full` + insight file check | N/A | pending |

*Status: pending / green / red / flaky*

---

## Wave 0 Requirements

- [ ] Verify `npm run build` compiles cleanly before any changes
- [ ] Verify `ukb full` runs end-to-end producing entities (baseline)

*Existing infrastructure covers compilation. No new test framework needed.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Deep semantic observations (multi-paragraph) | AGNT-01 | Quality assessment requires human review | Run `ukb full`, inspect entity observations for multi-paragraph code-grounded content |
| Hierarchy fields in KG | AGNT-03 | No automated schema validator | After `ukb full`, check entities in .data/knowledge-graph/ for parentEntityName/hierarchyLevel |
| Insight documents per entity | AGNT-04 | File content quality check | Check .data/knowledge-graph/insights/ for per-entity insight files |
| Ontology classification not auto-derived | AGNT-05 | Classification source verification | Verify entities have ontology metadata from OntologyClassificationAgent, not level-based defaults |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
