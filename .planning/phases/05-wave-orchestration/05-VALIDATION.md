---
phase: 5
slug: wave-orchestration
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-04
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Custom Node.js integration test (no unit test framework in submodule) |
| **Config file** | none -- `dist/test.js` compiled from `src/test.ts` |
| **Quick run command** | `cd integrations/mcp-server-semantic-analysis && npm run build` |
| **Full suite command** | `ukb full` invocation + KG entity inspection via VKB API |
| **Estimated runtime** | ~120 seconds (build) / ~300 seconds (full wave execution) |

---

## Sampling Rate

- **After every task commit:** `npm run build` in submodule (TypeScript compilation catches type errors)
- **After every plan wave:** Full `ukb full` invocation against dev Docker environment + KG inspection
- **Before `/gsd:verify-work`:** All 6 WAVE requirements verified via KG API queries
- **Max feedback latency:** 120 seconds (build time)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| TBD | 01 | 1 | WAVE-01 | Integration (log) | Check logs for "=== WAVE 1", "=== WAVE 2", "=== WAVE 3" banners | Wave 0 | ⬜ pending |
| TBD | 01 | 1 | WAVE-05 | Integration (timestamp) | Wave 2 start > Wave 1 end in logs | Wave 0 | ⬜ pending |
| TBD | 02 | 1 | WAVE-02 | Integration (API) | `curl http://localhost:8080/api/entities?team=coding` filter level=0,1 | Wave 0 | ⬜ pending |
| TBD | 03 | 1 | WAVE-03 | Integration (API) | Check L2 entities have parentEntityName set to L1 names | Wave 0 | ⬜ pending |
| TBD | 03 | 1 | WAVE-04 | Integration (API) | Check L3 entities have hierarchyLevel=3 and valid parentEntityName | Wave 0 | ⬜ pending |
| TBD | 03 | 1 | WAVE-06 | Integration (timing) | Wave 2 elapsed < 8x single agent time | Wave 0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/types/wave-types.ts` -- WaveResult, WaveAgentOutput, ChildManifestEntry interfaces
- [ ] `src/agents/wave-controller.ts` -- WaveController class (main orchestration entry point)
- [ ] `src/agents/wave1-project-agent.ts` -- Wave 1 agent wrapper (L0 + L1 production)
- [ ] `src/agents/wave2-component-agent.ts` -- Wave 2 agent wrapper (L2 production per L1 parent)
- [ ] `src/agents/wave3-detail-agent.ts` -- Wave 3 agent wrapper (L3 production per L2 parent)
- [ ] `config/workflows/wave-analysis.yaml` -- workflow registration YAML
- [ ] `src/tools.ts` update -- add `wave-analysis` to `longRunningWorkflows` array
- [ ] `src/workflow-runner.ts` update -- add WaveController routing branch

*All files are new creations -- no existing infrastructure to reuse for unit tests.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Waves visible in logs | WAVE-01 | Log output format not programmatically testable without log parser | Run `ukb full`, check Docker logs for 3 wave banners |
| Sequential wave ordering | WAVE-05 | Requires timestamp comparison across log entries | Verify Wave 2 start timestamp > Wave 1 end timestamp |
| Parallel agent execution | WAVE-06 | Timing-based; must observe concurrent log entries | Check Wave 2 logs show interleaved agent outputs |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
