---
phase: 67
slug: reproducibility-replay-rig
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-02
---

# Phase 67 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `67-RESEARCH.md` §Validation Architecture. Repro modules follow the
> `tests/experiments/*.test.mjs` convention (`node:test` + `node:assert/strict`),
> NOT the jest src suite. Live-only paths gate on env vars, never a trailing `--live` argv.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node:test` + `node:assert/strict` (experiments convention). jest 29 governs only the `*.test.js` src suite. |
| **Config file** | none for `node:test` (jest.config.js governs the src suite only) |
| **Quick run command** | `node --test tests/repro/<file>.test.mjs` |
| **Full suite command** | `node --test tests/repro/` |
| **Estimated runtime** | ~10 seconds (unit-level; proxy stubbed as pure functions — no live daemon) |

---

## Sampling Rate

- **After every task commit:** Run `node --test tests/repro/<changed>.test.mjs`
- **After every plan wave:** Run `node --test tests/repro/`
- **Before `/gsd-verify-work`:** Full `tests/repro/` green; existing `npm test` (jest src suite) unaffected
- **Max feedback latency:** ~10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 67-01 | 01 | 1 | REPRO-02 | — | normalize+hash+ordinal match key stable & order-robust (D-07) | unit | `node --test tests/repro/match-key.test.mjs` | ❌ W0 | ⬜ pending |
| 67-01 | 01 | 1 | REPRO-02 | T-67 replay-mixing | record→replay round-trip serves recorded response; miss → hard-fail (D-06) | unit (proxy stubbed) | `node --test tests/repro/llm-record-replay.test.mjs` | ❌ W0 | ⬜ pending |
| 67-02 | 02 | 2 | REPRO-02 | T-67 replay-mixing | harness-channel replay throws `REPLAY_UNSUPPORTED_CHANNEL` (honest stub, A1) | unit | `node --test tests/repro/harness-stub.test.mjs` | ❌ W0 | ⬜ pending |
| 67-02 | 02 | 2 | REPRO-02 | — | clock shim monotonic & deterministic from a frozen base | unit | `node --test tests/repro/clock.test.mjs` | ❌ W0 | ⬜ pending |
| 67-03 | 03 | 1 | REPRO-01 | T-67 secret-leak | git SHA + patch + untracked + submodule capture; env allowlist + deny-regex; MCP inventory | unit (temp git repo) | `node --test tests/repro/capture-snapshot.test.mjs` | ❌ W0 | ⬜ pending |
| 67-04 | 04 | 2 | REPRO-01 | T-67 secret-leak | capture writes all SC-1 items into `.data/run-snapshots/<id>/`; KB = JSON export canonical + best-effort LevelDB tar; `kb_caveat` in manifest | unit (temp git fixture) | `node --test tests/repro/capture-snapshot.test.mjs` | ❌ W0 | ⬜ pending |
| 67-05 | 05 | 3 | REPRO-01 | T-67 destructive-restore | restore into sandbox worktree + sandbox data dir reproduces captured SHA + KB; `--in-place` requires backup + confirm (D-04/D-05) | integration (throwaway worktree, `REPRO_RESTORE_LIVE=1` gate) | `node --test tests/repro/restore-snapshot.test.mjs` | ❌ W0 | ⬜ pending |
| 67-06 | 06 | 2 | REPRO-02 | T-67 replay-mixing | proxy `/api/complete` replay tap serves fixture, records on miss; 409 hard-fail on unknown request (D-06) | unit (pure fns; taps exercised without live HTTP) | `node --test tests/repro/llm-record-replay.test.mjs` | ❌ W0 | ⬜ pending |
| 67-07 | 07 | 4 | REPRO-01, REPRO-02 | — | `snapshot_id` populated on the Run via writeRun; span-integration e2e | unit (in-memory experiment store) + live e2e checkpoint | `node --test tests/repro/run-link.test.mjs` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/repro/_fixtures/` — a synthetic proxy request/response pair + a redacted transcript-JSONL fragment (mirror `tests/experiments/_fixtures/`)
- [ ] `tests/repro/match-key.test.mjs`, `llm-record-replay.test.mjs`, `harness-stub.test.mjs`, `clock.test.mjs`, `capture-snapshot.test.mjs`, `restore-snapshot.test.mjs`, `run-link.test.mjs`
- [ ] A no-daemon proxy record/replay harness: unit-test `llm-replay.mjs`/`llm-record.mjs` as pure functions (not the live HTTP server) so tests need no live proxy
- No new framework install needed (`node:test` is built-in)

*Each plan writes its Wave-0 test TDD-first, so `wave_0_complete` flips to true as the plans execute.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Full record→replay of a real interactive session (span open → record → replay produces comparable N=1) | REPRO-01, REPRO-02 | Needs a live `/gsd` measurement span + live proxy daemon; not reproducible in a unit harness | Plan 07 Task 3 blocking `checkpoint:human-verify` — open a span with `--record`, run a short task, then `measurement-start --replay <snapshot>` and confirm fixtures serve + `snapshot_id` linked |
| `--in-place` destructive restore backup + confirm on the live checkout | REPRO-01 | Overwrites live workspace/KB; unsafe to automate against the live repo | Plan 05 live-gated test (`REPRO_RESTORE_LIVE=1`) on a throwaway clone |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies (every task maps to a `tests/repro/*.test.mjs`)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (7 test files + fixtures enumerated)
- [x] No watch-mode flags (`node --test`, single-shot)
- [x] Feedback latency < 15s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
