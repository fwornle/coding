---
phase: 82
slug: wire-measurement-foundation
status: validated
nyquist_compliant: false
wave_0_complete: true
created: 2026-07-06
---

# Phase 82 — Validation Strategy

> Per-phase validation contract, reconstructed retroactively from PLAN/SUMMARY artifacts (State B) + gap-fill audit on 2026-07-06.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | node:test + node:assert/strict (`node --test`), in BOTH repos |
| **Config file** | none — zero-config node:test convention (proxy `tests/integration/`, coding `tests/experiments/` + `tests/token-adapters/` + `tests/agents/`) |
| **Quick run command** | `node --test tests/experiments/experiment-runner.test.mjs tests/agents/opencode-anthropic-native-splice.test.mjs tests/token-adapters/token-db-dedup-merge.test.js` (coding repo) |
| **Full suite command** | coding cmd above **+** `cd /Users/Q284340/Agentic/_work/rapid-llm-proxy && npm run build && node --test tests/integration/token-usage-cache-migration.test.mjs tests/integration/messages-tap-cache-parse.test.mjs tests/integration/shim-tool-passthrough.test.mjs tests/integration/background-process-guard.test.mjs` |
| **Estimated runtime** | ~3 s (coding) + ~10 s (proxy incl. tsc build) |

Note: implementation spans two repos. Proxy-side tests live in `/Users/Q284340/Agentic/_work/rapid-llm-proxy` (its own git); coding-side tests in this repo. Live-only assertions are env-gated on `LLM_PROXY_LIVE=1` (never trailing argv — see memory `reference_node_test_argv_live_gate`).

---

## Sampling Rate

- **After every task commit:** run the affected repo's quick command
- **After every plan wave:** run the full suite (both repos)
- **Before `/gsd-verify-work`:** full suite must be green
- **Max feedback latency:** ~15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 82-01-01 | 01 | 1 | WIRE-01 | T-82-01-01/02 | PRAGMA-guarded idempotent ALTER; `?? 0` coalesce on hot path | integration | `node --test tests/integration/token-usage-cache-migration.test.mjs` (proxy) | ✅ | ✅ green (4/4) |
| 82-01-02 | 01 | 1 | WIRE-01 | T-82-01-03 | export/hydrate round-trip; legacy peer files coalesce to 0 | integration | same file (cases c+d) | ✅ | ✅ green |
| 82-02-01 | 02 | 2 | WIRE-02 | T-82-02-04 | parseUsageCache never throws; total excludes cache | integration | `node --test tests/integration/messages-tap-cache-parse.test.mjs` (proxy) | ✅ | ✅ green (4 pass / 1 live-skip) |
| 82-02-02 | 02 | 2 | WIRE-03 | T-82-02-01/02/03 | header precedence + sanitizeTaskId + adapterUserHash `/^[a-z][a-z0-9]{5}$/` | manual-only | — (inline in `proxy-bridge/server.mjs` tap; see Manual-Only) | — | ⚠️ manual (live-verified) |
| 82-02-03 | 02 | 2 | WIRE-02 | T-82-02-04 | both wire forms parse; malformed coalesces | integration | same as 82-02-01 | ✅ | ✅ green |
| 82-03-01 | 03 | 3 | WIRE-04 | T-82-03-03 | /v1/copilot path + task-scoped `/t/<id>` (sanitized); header > body > path precedence | unit + manual | `node --test tests/integration/shim-tool-passthrough.test.mjs` (proxy; `resolveShimTaskId` precedence) — path→agent table itself manual-only | ✅ | ✅ green / ⚠️ partial |
| 82-03-02 | 03 | 3 | WIRE-05 | T-82-03-02 | capability gate fails loud (400 NO_TOOL_CAPABLE_PROVIDER); never silent-strips onto claude-code | unit | same file (`gateToolCapableChain` cases) | ✅ | ✅ green |
| 82-03-03 | 03 | 3 | WIRE-05 | T-82-03-04 | tool_calls envelope mapping; no-toolCalls path byte-identical | unit | same file (buffered + SSE cases) | ✅ | ✅ green (12 pass / 1 live-skip) |
| 82-04-01 | 04 | 1 | WIRE-06 | T-82-04-01/02 | merge only when existing cache-less (never additive); parameterized binds | unit | `node --test tests/token-adapters/token-db-dedup-merge.test.js` | ✅ | ✅ green (4/4) |
| 82-04-02 | 04 | 1 | WIRE-06 | T-82-04-03 | never-throw write path; MAX() preserves reasoning | unit | same file | ✅ | ✅ green |
| 82-05-01 | 05 | 1 | WIRE-07 | T-82-05-02/03 | claude re-route + x-task-id header; copilot BYOK task-scoped URL; opt-out/health gate fail-soft | unit | `node --test tests/experiments/experiment-runner.test.mjs` | ✅ | ✅ green (20/20, incl. gap-fill BYOK cases) |
| 82-05-02 | 05 | 1 | WIRE-07 | T-82-05-01 | launcher shell exports (placeholder key non-secret) | manual-only | — (`bash -n` + greps at execution; live-verified in 82-06; see Manual-Only) | — | ⚠️ manual |
| 82-05-03 | 05 | 1 | WIRE-07 | T-82-05-04 | opencode anthropic-native OFF-by-default; default blob byte-identical | integration (shell-out) | `node --test tests/agents/opencode-anthropic-native-splice.test.mjs` | ✅ | ✅ green (7/7, gap-fill) |
| 82-06-01 | 06 | 4 | WIRE-08 | T-82-06-01/SC | deploy after coordinator location=open; no lockfile drift | manual + regression | `node --test tests/integration/background-process-guard.test.mjs` (proxy; mid-gate leak fix, 2/2) | ✅ | ✅ green + human-approved |
| 82-06-02 | 06 | 4 | WIRE-08 | T-82-06-03 | zero cross-contamination under concurrent spans | checkpoint:human-verify | — (live gate, by design) | — | ✅ human-approved 2026-07-06 |
| 82-06-03 | 06 | 4 | WIRE-08 | T-82-06-02 | real file on disk in scoped /tmp sentinel path | checkpoint:human-verify | — (live gate, by design) | — | ✅ human-approved 2026-07-06 |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky/manual*

---

## Wave 0 Requirements

Existing infrastructure covered all phase requirements — no Wave 0 install was needed. All test files were created during execution (Plans 01–04, 06) or by the 2026-07-06 gap-fill audit (Plan 05 BYOK + splice tests).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| /v1/messages tap x-task-id/x-agent binding + `adapterUserHash` stamping | WIRE-03 | Inline in `proxy-bridge/server.mjs` tap handler — not importable without refactoring impl (out of scope for validation). Live-verified: sentinel header trace bound row 164372; v2 concurrent gate zero cross-contamination (82-06-SUMMARY Evidence Appendix). | Set `ANTHROPIC_CUSTOM_HEADERS="x-task-id: <sentinel>"`, make one claude call through the proxy, query `token-usage.db` — the new row's task_id must equal the sentinel; a non-claude `x-agent` must stamp a non-cladpt `/^[a-z][a-z0-9]{5}$/` user_hash. |
| `SHIM_PATH_AGENTS` path→defaultAgent table (`/v1/copilot` → agent=copilot) | WIRE-04 | Shim guard is inline in `server.mjs`; the extracted helper (`resolveShimTaskId`) is tested but the route table is not importable. Live-verified: BYOK rows 164690/164691 stamped `agent=copilot provider=copilot` (82-06-SUMMARY). | POST a minimal completion to `http://127.0.0.1:12435/v1/copilot/chat/completions` with no X-Agent header; the resulting token row must stamp `agent=copilot`. |
| Interactive launcher shell exports (claude header, copilot BYOK env, mastra ambient comment) | WIRE-07 | `scripts/launch-agent-common.sh` / `config/agents/copilot.sh` run inside the launcher process; exercised end-to-end only by a real launch. Syntax (`bash -n`) + greps verified at execution; behavior inherited the 82-06 live gates. | Launch `coding --claude` (and copilot) with the proxy healthy; confirm the spawned process env carries `ANTHROPIC_CUSTOM_HEADERS` / `COPILOT_PROVIDER_BASE_URL=/v1/copilot[/t/<id>]` and rows land task-bound. |
| Concurrent 2-cell + interactive zero cross-contamination; cache fidelity vs cladpt; real files on disk | WIRE-08 | Behavioral live-acceptance gate by design (`checkpoint:human-verify`, 3 blocking gates, all approved 2026-07-06). | Re-run per 82-06-PLAN Tasks 2–3 (experiment spec `config/experiments/wire-verify-82-06-v2.yaml`). |

---

## Validation Audit 2026-07-06

| Metric | Count |
|--------|-------|
| Requirements audited | 8 (WIRE-01…08) |
| Gaps found | 4 |
| Resolved (tests added) | 2 — copilot BYOK branch (`experiment-runner.test.mjs`, 20/20), opencode splice (`tests/agents/opencode-anthropic-native-splice.test.mjs`, 7/7) |
| Escalated to manual-only | 2 — server.mjs inline tap binding (WIRE-03), shim path→agent table (WIRE-04); both carry live human-gate evidence |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify, a green test file, or a documented manual-only entry
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0: not required (existing infrastructure)
- [x] No watch-mode flags; live-only assertions env-gated (`LLM_PROXY_LIVE=1`)
- [x] Feedback latency < 15 s
- [ ] `nyquist_compliant: true` — NOT set: 4 behaviors remain manual-only (2 by-design live gates, 2 impl-refactor-blocked); all carry human-approved live evidence

**Approval:** approved 2026-07-06 (gap-fill audit; Partial — automated where the seams allow)
