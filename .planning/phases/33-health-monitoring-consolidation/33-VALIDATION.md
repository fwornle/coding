---
phase: 33
slug: health-monitoring-consolidation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-06
---

# Phase 33 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Sourced from 33-RESEARCH.md "Validation Architecture" section.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | bash + curl + jq + python3 (no JS test runner — matches `tests/integration/launcher-e2e.sh` pattern in this repo) |
| **Config file** | none — Wave 0 creates `scripts/__tests__/health-coordinator/` and lifts the `run_test` helper from `tests/integration/launcher-e2e.sh:43-48` |
| **Quick run command** | `bash scripts/__tests__/health-coordinator/quick.sh` (smoke: coordinator up, `GET /health/state` returns valid JSON) |
| **Full suite command** | `bash scripts/__tests__/health-coordinator/run-all.sh` (two-session + latency-50 + injection + reader-agreement) |
| **Estimated runtime** | ~3 min (latency-50 dominates: 50 × ~3s = 150s) |

---

## Sampling Rate

- **After every task commit:** Run `bash scripts/__tests__/health-coordinator/quick.sh`
- **After every plan wave:** Run `bash scripts/__tests__/health-coordinator/run-all.sh`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 180 seconds (full suite)

---

## Nyquist Conditions (from RESEARCH.md)

| Quantity | Rate / Period |
|----------|---------------|
| Coordinator tick (sampling) | 5 s |
| ETM heartbeat | ~4 s |
| SPEC SLA observable | 10 s p95 |
| Heartbeat staleness threshold | 15 s |
| Docker healthcheck probe | 30 s (Nyquist-violating for 10s SLA — by design per SPEC R7) |

5s sampling vs 10s SLA = 2× — Nyquist holds for events ≥ 5s. Sub-5s flaps explicitly out of scope.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 33-01-01 | 01 | 1 | R1, R9 | — | Single coordinator, no parallel writers | smoke | `pgrep -fl 'health-coordinator' | wc -l` (expect: 1) | ❌ W0 | ⬜ pending |
| 33-01-02 | 01 | 1 | R2 | — | HTTP SoT serves canonical JSON | smoke | `curl -fs http://localhost:3034/health/state | jq -e '.container,.services,.lsl,.lsl_by_project,.processes,.generated_at,.coordinator_uptime_s'` | ❌ W0 | ⬜ pending |
| 33-01-03 | 01 | 1 | R7 | — | Container health = Docker's `.State.Health.Status` verbatim | unit | `bash scripts/__tests__/health-coordinator/docker-health-passthrough.test.sh` | ❌ W0 | ⬜ pending |
| 33-02-01 | 02 | 2 | R3 (per-session keying) | — | Two sessions visible, project rollup correct | integration | `bash scripts/__tests__/health-coordinator/two-session-agreement.test.sh` | ❌ W0 | ⬜ pending |
| 33-02-02 | 02 | 2 | R3 (eviction) | — | Stopped session evicts after 5 min (CONTEXT D-10) | integration | `bash scripts/__tests__/health-coordinator/eviction.test.sh` | ❌ W0 | ⬜ pending |
| 33-03-01 | 03 | 3 | R4 | — | P95 ≤ 10s on host-process-kill injection | latency | `bash scripts/__tests__/health-coordinator/detection-latency.test.sh` | ❌ W0 | ⬜ pending |
| 33-04-01 | 04 | 4 | R6 | — | Forced check throw → `unknown`, never `healthy` | injection | `bash scripts/__tests__/health-coordinator/injection.test.sh` | ❌ W0 | ⬜ pending |
| 33-05-01 | 05 | 4 | R8 (prompt-hook compat) | — | JSON shape preserved | unit | `echo '{"cwd":"/Users/Q284340/Agentic/coding"}' | node scripts/health-prompt-hook.js | python3 -c 'import json,sys; d=json.load(sys.stdin); assert "hookSpecificOutput" in d and "additionalContext" in d["hookSpecificOutput"]'` | ✅ existing hook can be patched | ⬜ pending |
| 33-05-02 | 05 | 4 | R8 (dashboard compat) | — | `/api/health-verifier/*` URLs respond with same shape | integration | `curl -fs http://localhost:3032/api/health-verifier/status \| jq -e '.overallStatus,.violationCount,.criticalCount,.lastUpdate,.autoHealingActive'` | ❌ W0 (dashboard not migrated yet) | ⬜ pending |
| 33-05-03 | 05 | 4 | R8 (rules schema compat) | — | `health-verification-rules.json` validates against extracted Ajv schema | unit | `node scripts/__tests__/health-coordinator/rules-schema.test.mjs` | ❌ W0 | ⬜ pending |
| 33-06-01 | 06 | 5 | R5 | — | No `force-recreate` references in remediation | grep | `! grep -rE "force-recreate\|--force-recreate" scripts/health-remediation-actions.js scripts/health-verifier.js` | ✅ check command exists | ⬜ pending |
| 33-06-02 | 06 | 5 | R5 | — | `bind_mount_freshness` rule deleted | grep | `! grep -q '"bind_mount_freshness"' config/health-verification-rules.json` | ✅ check command exists | ⬜ pending |
| 33-06-03 | 06 | 5 | R2 | — | No file reads of legacy `.health/*.json` paths in consumers | grep | `! grep -rE "readFileSync.*\\.health/(verification\|.*-transcript-monitor)" scripts/health-prompt-hook.js scripts/statusline-health-monitor.js integrations/system-health-dashboard/server.js integrations/mcp-constraint-monitor/src/dashboard-server.js` | ✅ check command exists | ⬜ pending |
| 33-07-01 | 07 | 6 | R9 (cutover) | — | Exactly one `com.coding.*` plist | smoke | `[[ $(launchctl list \| grep -c '^.*com\\.coding\\.') == 1 ]]` | ✅ check command exists | ⬜ pending |
| 33-07-02 | 07 | 6 | R9 (KeepAlive) | — | Coordinator survives `kill -9` within 30s | resilience | `bash scripts/__tests__/health-coordinator/keepalive.test.sh` | ❌ W0 | ⬜ pending |
| 33-08-01 | 08 | 7 | R2 (constraint dashboard migration — added per user resolution) | — | Constraint dashboard at :3030 reads HTTP SoT, not `.health/*.json` | grep + smoke | `! grep -nE "readFileSync.*\\.health/" integrations/mcp-constraint-monitor/src/dashboard-server.js && curl -fs http://localhost:3030/api/status \| jq -e '.health'` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `scripts/__tests__/health-coordinator/` directory created
- [ ] `scripts/__tests__/health-coordinator/_helpers.sh` — lifts `run_test` from `tests/integration/launcher-e2e.sh:43-48`
- [ ] `scripts/__tests__/health-coordinator/quick.sh` — smoke wrapper
- [ ] `scripts/__tests__/health-coordinator/run-all.sh` — full suite wrapper
- [ ] `lib/utils/log-rotator.js` — extracted from `health-verifier.js:179-188` 10MB inline pattern (no new dep)
- [ ] Test prerequisites documented: `jq`, `python3` (confirmed available); `gdate` optional

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Two `coding/bin/coding` sessions in tmux behave correctly under user-driven workflow | R3 | `bin/coding` is interactive — test harness uses stub reporters with the same `CLAUDE_SESSION_ID` shape; full E2E is human-attended | Open two `coding/bin/coding` panes in tmux on the same project; check dashboard, statusline, prompt-hook all agree; close one pane; verify project rollup remains `healthy` |
| Dashboard frontend (in `dist/`) renders correctly against migrated backend | R8 | Frontend is not rebuilt this phase; only the backend proxy contract is enforced by tests | Open `http://localhost:3032`; verify "Health Status" card and "Run Verification" button still work |
| Constraint dashboard at :3030 visually correct after migration | added (per user resolution) | Frontend not rebuilt; visual confirmation only | Open `http://localhost:3030`; verify health column populates from HTTP SoT |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 180s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
