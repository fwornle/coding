---
phase: 12
slug: pipeline-observability
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-09
---

# Phase 12 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Manual verification via `ukb full` + dashboard inspection |
| **Config file** | N/A — no automated test framework for dashboard UI |
| **Quick run command** | `cd integrations/system-health-dashboard && npm run build` |
| **Full suite command** | `ukb full` then open dashboard trace modal |
| **Estimated runtime** | ~300 seconds (full pipeline run) |

---

## Sampling Rate

- **After every task commit:** Run `cd integrations/system-health-dashboard && npm run build`
- **After every plan wave:** Run `cd integrations/mcp-server-semantic-analysis && npm run build` + Docker rebuild + visual inspection
- **Before `/gsd:verify-work`:** Full `ukb full` run with trace modal verification
- **Max feedback latency:** 30 seconds (build check), 300 seconds (full pipeline)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 12-01-01 | 01 | 1 | OBSV-01 | manual | `npm run build` (dashboard) | N/A | ⬜ pending |
| 12-01-02 | 01 | 1 | OBSV-02 | manual | `npm run build` (dashboard) | N/A | ⬜ pending |
| 12-01-03 | 01 | 1 | OBSV-03 | manual | `npm run build` (dashboard) | N/A | ⬜ pending |
| 12-01-04 | 01 | 1 | OBSV-04 | manual | `npm run build` (dashboard) | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Backend TypeScript interfaces for TraceLLMCall, TraceAgentInstance, entity flow counters
- [ ] Frontend build verification (`npm run build`) passes after TraceModal changes
- [ ] No automated UI tests exist — all verification is manual via dashboard

*Wave 0 creates type foundations; all behavioral verification is manual.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| LLM call counts per wave/agent in trace modal | OBSV-01 | UI rendering requires visual inspection | Run `ukb full`, open trace modal, verify wave-level LLM call breakdown matches Docker logs |
| Timing breakdown per agent/wave | OBSV-02 | Waterfall bar rendering needs visual check | Run `ukb full`, verify timing bars show correct duration per wave, parallel agents overlap |
| Model/provider info display | OBSV-03 | Badge rendering is visual | Run `ukb full`, verify model badges show correct provider per step |
| Data flow visualization with I/O | OBSV-04 | Entity flow, expand/collapse, information loss highlighting | Run `ukb full`, expand steps in trace, verify entity lists, flow counters, rejection reasons |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 300s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
