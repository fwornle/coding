---
phase: 19
slug: migration-cleanup
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-11
---

# Phase 19 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node.js built-in test runner (`node:test`) |
| **Config file** | None (direct execution) |
| **Quick run command** | `cd integrations/mcp-server-semantic-analysis && npx tsx --test src/workflow-state-machine.test.ts` |
| **Full suite command** | `cd integrations/mcp-server-semantic-analysis && npx tsx --test src/*.test.ts` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** `npm run build` in affected submodule (compile check)
- **After every plan wave:** Full build of both backend and dashboard submodules
- **Before `/gsd:verify-work`:** 3 successful validation runs + clean builds after all deletions
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 19-01-01 | 01 | 1 | MIG-01 | integration | Comparison script + 3 workflow runs | N/A - manual validation | ⬜ pending |
| 19-01-02 | 01 | 1 | MIG-02 | unit | `npx tsx --test src/workflow-state-machine.test.ts` | Partial - schema tests needed | ⬜ pending |
| 19-02-01 | 02 | 2 | MIG-03 | build | `npm run build` in both submodules | N/A - build verification | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Comparison utility script — covers MIG-01 (post-run divergence detection between legacy and new progress files)
- [ ] Schema migration test — verify `WorkflowStateWithMigrationSchema` handles old format (covers MIG-02, proves it works before removal)

*These must exist before Wave 1 execution begins.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Legacy/new path equivalence | MIG-01 | Requires running actual workflow (production, debug, cancel) | Run 3 full workflows, compare `workflow-progress.json` vs `workflow-progress-legacy.json` |
| Dashboard warning on divergence | MIG-01 | Visual UI verification | Inject artificial divergence, verify warning banner appears |
| Cancel flow after writeProgressFile removal | MIG-03 | Requires live workflow + mid-run cancel | Start workflow, cancel mid-run, verify state machine handles it without writeProgressFile |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
