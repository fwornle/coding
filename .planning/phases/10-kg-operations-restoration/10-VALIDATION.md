---
phase: 10
slug: kg-operations-restoration
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-07
---

# Phase 10 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node.js built-in test runner + manual `ukb full` verification |
| **Config file** | none — Wave 0 installs |
| **Quick run command** | `cd integrations/mcp-server-semantic-analysis && npx tsc --noEmit` |
| **Full suite command** | `ukb full` (end-to-end pipeline run) |
| **Estimated runtime** | ~120 seconds (type-check ~5s, ukb full ~120s) |

---

## Sampling Rate

- **After every task commit:** Run `cd integrations/mcp-server-semantic-analysis && npx tsc --noEmit`
- **After every plan wave:** Run `ukb full` (Docker rebuild + full pipeline)
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds (type-check), 120 seconds (e2e)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 10-01-01 | 01 | 1 | KGOP-03 | unit | `npx tsc --noEmit` | ❌ W0 | ⬜ pending |
| 10-01-02 | 01 | 1 | KGOP-03 | smoke | `ukb full` then check embedding field | ❌ W0 | ⬜ pending |
| 10-02-01 | 02 | 1 | KGOP-06 | unit | inline mergeEntities test | ❌ W0 | ⬜ pending |
| 10-02-02 | 02 | 1 | KGOP-04 | unit | inline dedup key test | ❌ W0 | ⬜ pending |
| 10-03-01 | 03 | 2 | KGOP-01 | e2e | `ukb full` then inspect enrichedContext | N/A - e2e | ⬜ pending |
| 10-03-02 | 03 | 2 | KGOP-02 | e2e | `ukb full` then inspect role field | N/A - e2e | ⬜ pending |
| 10-03-03 | 03 | 2 | KGOP-05 | e2e | `ukb full` then inspect predicted relations | N/A - e2e | ⬜ pending |
| 10-04-01 | 04 | 2 | ALL | e2e | Run `ukb full` twice, verify stable entity count | N/A - e2e | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `integrations/mcp-server-semantic-analysis/src/utils/embedding_generator.py` — Python embedding script with sentence-transformers
- [ ] Dockerfile additions for sentence-transformers + all-MiniLM-L6-v2 model download
- [ ] Type additions for `updateProgress` to support 'operators' phase in WAVE_STEP_SEQUENCE

*These must exist before Wave 1 tasks can verify.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Embedding vectors are 384-dim, non-zero | KGOP-03 | Requires running full pipeline + KG inspection | Run `ukb full`, then check entity embedding arrays via KG export |
| Cross-branch predicted edges exist | KGOP-05 | Requires full pipeline with multi-branch entities | Run `ukb full`, inspect relations for `source: 'predicted'` |
| Second run doesn't create duplicates | KGOP-04 | Requires running pipeline twice | Run `ukb full` twice, compare entity counts and names |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
