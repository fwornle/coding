---
phase: 69
slug: claude-copilot-token-adapters
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-22
---

# Phase 69 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `69-RESEARCH.md` § Validation Architecture (HIGH confidence; WAL test prototyped live, `ok=50 busy=0 err=0`).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Jest 29.x (coding repo: `NODE_OPTIONS='--experimental-vm-modules' jest`) + Node `node:test` for the WAL concurrency fixture |
| **Config file** | `package.json` jest block (existing tests under `tests/live-logging/`) — no install needed |
| **Quick run command** | `npx jest tests/token-adapters/<touched-file>.test.js` |
| **Full suite command** | `npx jest tests/token-adapters/` (whole adapter suite); phase gate `npm test` |
| **Estimated runtime** | ~30 seconds (adapter suite); WAL coexistence test ~3s |

---

## Sampling Rate

- **After every task commit:** Run `npx jest tests/token-adapters/<touched-file>.test.js`
- **After every plan wave:** Run `npx jest tests/token-adapters/`
- **Before `/gsd-verify-work`:** Full `npm test` green **AND** `tests/token-adapters/wal-concurrency.test.mjs` passing against the live `.data/llm-proxy/token-usage.db` while `com.coding.llm-cli-proxy` is up (true coexistence test)
- **Max feedback latency:** ~30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| W0 | — | 0 | (guardrail) | T-69-write | Second-process INSERT alongside live proxy → 0 `SQLITE_BUSY` (`busy_timeout=5000`) | integration | `node --test tests/token-adapters/wal-concurrency.test.mjs` | ❌ W0 | ⬜ pending |
| ADAPT-01 | — | 1 | ADAPT-01 | — | Claude `usage` block → `per-turn` row with correct token counts | unit | `npx jest tests/token-adapters/claude-token-rows.test.js` | ❌ W0 | ⬜ pending |
| ADAPT-01 | — | 1 | ADAPT-01 | T-69-traversal | Sub-agent row gets `parent_call_id` from `claude-jsonl-tree.mjs` tree (uid-check gate honored) | unit | `npx jest tests/token-adapters/claude-parent-linkage.test.js` | ❌ W0 | ⬜ pending |
| ADAPT-01 | — | 1 | ADAPT-01 | — | Per-reasoning-step rows emitted per thinking block; `reasoning_tokens` estimated, `tokens_estimated=1` (D-05) | unit | `npx jest tests/token-adapters/claude-reasoning-rows.test.js` | ❌ W0 | ⬜ pending |
| ADAPT-01 | — | 1 | ADAPT-01 | — | Live `task_id` stamped from `resolveLiveTaskId()`; `''` when no span | integration | `npx jest tests/token-adapters/claude-taskid.test.js` | ❌ W0 | ⬜ pending |
| ADAPT-01 | — | 2 | ADAPT-01 | T-69-id | Live+sweep dedup: same `requestId` not double-inserted; distinct adapter `user_hash` (D-06) | integration | `npx jest tests/token-adapters/dedup.test.js` | ❌ W0 | ⬜ pending |
| ADAPT-02 | — | 1 | ADAPT-02 | T-69-input | `session.shutdown.modelMetrics` → one `per-session-aggregate` row per model; numeric fields coalesced (`?? 0`) | unit | `npx jest tests/token-adapters/copilot-token-rows.test.js` | ❌ W0 | ⬜ pending |
| ADAPT-02 | — | 1 | ADAPT-02 | — | Vocabulary check enumerates event `type:` set; verdict keyed on CLI version (v1.0.63) | unit | `npx jest tests/token-adapters/copilot-vocab.test.js` | ❌ W0 | ⬜ pending |
| ADAPT-01/02 | — | 1 | ADAPT-01, ADAPT-02 | T-69-dos | Best-effort: a corrupt span / locked DB / malformed JSONL line never throws out of ingestion | unit | `npx jest tests/token-adapters/best-effort.test.js` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/token-adapters/wal-concurrency.test.mjs` — the guardrail acceptance test (`node:test`); covers the write-path decision (D-07). PASS: `ok===N && busy===0 && rowsReadBack===N && cleanup===N`, sentinel `agent='__waltest__'` + distinct `user_hash`, run against live DB **and** a temp DB for CI portability.
- [ ] `tests/token-adapters/claude-token-rows.test.js` — ADAPT-01 per-turn extraction.
- [ ] `tests/token-adapters/claude-reasoning-rows.test.js` — D-05 estimated per-reasoning-step rows.
- [ ] `tests/token-adapters/copilot-token-rows.test.js` — ADAPT-02 aggregate extraction.
- [ ] `tests/token-adapters/dedup.test.js` — live+sweep double-count guard.
- [ ] Shared fixtures: a redacted sample Claude session JSONL with `usage` + thinking blocks, and a sample Copilot `events.jsonl` with `session.shutdown.modelMetrics` (copy/redact real files captured during research).
- [ ] No framework install needed — Jest + `node:test` already present.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| WAL coexistence against the *running* `com.coding.llm-cli-proxy` daemon | (guardrail) | The CI temp-DB run proves correctness; the true coexistence proof requires the live daemon up | `launchctl list \| grep llm-cli-proxy` to confirm up, then `node --test tests/token-adapters/wal-concurrency.test.mjs` pointed at `.data/llm-proxy/token-usage.db` |

*All other phase behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
