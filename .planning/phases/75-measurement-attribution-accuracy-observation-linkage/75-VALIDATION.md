---
phase: 75
slug: measurement-attribution-accuracy-observation-linkage
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-29
---

# Phase 75 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | dual: `node --test` (lib/* .mjs) + jest 29.x (dashboard .tsx) — see RESEARCH.md Validation Architecture |
| **Config file** | none for node:test; dashboard `integrations/system-health-dashboard/jest.config` |
| **Quick run command** | `node --test <changed *.test.mjs>` |
| **Full suite command** | `node --test 'lib/**/*.test.mjs' 'scripts/**/*.test.mjs'` + dashboard `npm test` |
| **Estimated runtime** | ~{planner to fill} seconds |

---

## Sampling Rate

- **After every task commit:** Run quick run command on the changed test file
- **After every plan wave:** Run full suite command
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** {planner to fill} seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| {planner to fill from PLAN.md task breakdown} | | | | | | | | | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] OBS-02 acceptance fixture from transcript `e0af5b8b` (last typed prompt 2026-06-28T21:00:43Z, ran to 2026-06-29T06:08Z, 5 AskUserQuestion decisions 05:30–06:03Z) — expected: observations dated ~05:30–06:03Z, not all collapsed to T0
- [ ] {planner to confirm remaining Wave 0 test stubs / fixtures per RESEARCH.md Validation Architecture}

*If none: "Existing infrastructure covers all phase requirements."*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Two-column model display (chat model \| background-service models) renders consistently across runs table, score drawer, timeline | ATTR-02 | Visual dashboard rendering | `gsd-browser` against localhost:3032 per CLAUDE.md E2E-verify rule |

*If none: "All phase behaviors have automated verification."*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < {N}s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
