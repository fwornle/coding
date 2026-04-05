---
phase: 21
slug: mastracode-agent-integration
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-02
---

# Phase 21 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Bash integration tests + Node.js unit tests |
| **Config file** | tests/integration/launcher-e2e.sh (existing) |
| **Quick run command** | `bash tests/integration/launcher-e2e.sh` |
| **Full suite command** | `bash tests/run-e2e.sh` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `bash -n config/agents/mastra.sh && bash tests/integration/launcher-e2e.sh`
- **After every plan wave:** Run `bash tests/run-e2e.sh`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 21-01-01 | 01 | 1 | MSTR-01 | unit | `bash -n config/agents/mastra.sh` | Wave 0 | ⬜ pending |
| 21-01-02 | 01 | 1 | MSTR-01 | unit | `bash -n scripts/launch-mastra.sh` | Wave 0 | ⬜ pending |
| 21-01-03 | 01 | 1 | MSTR-01 | integration | `bash tests/integration/launcher-e2e.sh` | Partial | ⬜ pending |
| 21-02-01 | 02 | 1 | MSTR-02 | unit | `node -e "require('./scripts/combined-status-line.js')"` | Wave 0 | ⬜ pending |
| 21-02-02 | 02 | 1 | MSTR-02 | unit | `node -e "require('./scripts/global-process-supervisor.js')"` | Wave 0 | ⬜ pending |
| 21-02-03 | 02 | 1 | MSTR-02 | manual | Visual verification in tmux | -- | ⬜ pending |
| 21-03-01 | 03 | 2 | MSTR-03 | unit | `node tests/unit/test-mastra-reader.js` | Wave 0 | ⬜ pending |
| 21-03-02 | 03 | 2 | MSTR-03 | integration | Verify LSL file creation after hook event | Wave 0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/integration/launcher-e2e.sh` — add `test_mastra_flag` test case (pattern: `test_claude_flag`)
- [ ] `tests/unit/test-mastra-reader.js` — test MastraTranscriptReader parses hook NDJSON
- [ ] Verify mastracode hook variable names empirically

*Existing infrastructure covers launcher integration tests; mastra-specific tests needed.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Statusline shows mastra icon/color | MSTR-02 | Visual tmux rendering | Launch `coding --mastra`, verify statusline shows unique mastra indicator |
| First-run OAuth in tmux | MSTR-01 | Requires interactive auth | Run `coding --mastra` on fresh install, verify OAuth flow completes |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
