---
phase: 78
slug: autonomous-cross-agent-runner
status: approved
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-03
---

# Phase 78 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Formalized from `78-RESEARCH.md` § Validation Architecture (the plans already carry
> `<verify><automated>` node:test commands on every task — this file is the gate artifact).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node:test` + `node:assert/strict` (the `lib/experiments/*` convention — every `tests/experiments/*.test.mjs` uses `import { test } from 'node:test'`) |
| **Config file** | none — run positionally |
| **Quick run command** | `node --test tests/experiments/experiment-runner.test.mjs` |
| **Full suite command** | `node --test tests/experiments` |
| **Estimated runtime** | ~5–20 seconds (unit); integration with a stub agent (`node -e "process.exit(0)"`) adds a few seconds |

> Note: top-level `npm test` is **jest** (`package.json`), but the experiments module is `node:test`.
> Use `node:test` for this phase's own tests. The per-variant `test_command` example is
> `node --test tests/experiments` (`config/experiments/example-experiment.yaml:37`).

---

## Sampling Rate

- **After every task commit:** Run `node --test tests/experiments/experiment-runner.test.mjs`
- **After every plan wave:** Run `node --test tests/experiments`
- **Before `/gsd-verify-work`:** Full experiments suite green **+** one live one-cell smoke (real `claude -p` against a trivial goal inside a sandbox worktree)
- **Max feedback latency:** ~20 seconds (unit); the live smoke is a phase-gate manual step (78-05, `autonomous: false`)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 78-01-01 | 01 | 1 | RUN-02/03/04 | T-78-INJ | `writeRun` tag allow-list extended (`variant`,`repeat`,`terminal_state`,`skip_reason`) with `?? null` idiom | unit | `node --test tests/experiments/run-write.test.mjs` | ❌ W0 | ⬜ pending |
| 78-01-02 | 01 | 1 | RUN-02 | — | `variant`/`repeat` threaded through span.meta → measurement-stop tags | unit | `node --test tests/experiments/experiment-runner.test.mjs` | ❌ W0 | ⬜ pending |
| 78-01-03 | 01 | 1 | RUN-03 | — | `--terminal-state` validated against closed set `complete|timeout|abort` | unit | `node --test tests/experiments/experiment-runner.test.mjs` | ❌ W0 | ⬜ pending |
| 78-02-01 | 02 | 1 | RUN-02 | T-78-INJ | agent→argv fixed-argv adapter (no `shell:true`, no `getAdapter`) | unit (fake spawn) | `node --test tests/experiments/agent-headless.test.mjs` | ❌ W0 | ⬜ pending |
| 78-02-02 | 02 | 1 | RUN-04 | T-78-INJ | one-turn Copilot probe (`copilot -p … --allow-all-tools`) → boolean | unit (fake spawnSync) | `node --test tests/experiments/agent-headless.test.mjs` | ❌ W0 | ⬜ pending |
| 78-03-01 | 03 | 2 | RUN-02/03 | T-78-ESC / T-78-DOS | async `spawn` under 20-min timer; SIGTERM→SIGKILL → `complete|timeout|abort`; cwd=worktree, env `LLM_PROXY_DATA_DIR`=sandbox | unit (fake child) | `node --test tests/experiments/experiment-runner.test.mjs` | ❌ W0 | ⬜ pending |
| 78-03-02 | 03 | 2 | RUN-03 | — | `measurement-stop` (inline score) runs in a `finally` even on abort/timeout | unit | `node --test tests/experiments/experiment-runner.test.mjs` | ❌ W0 | ⬜ pending |
| 78-03-03 | 03 | 2 | RUN-04/SC#4 | T-78-DOS | probe-gated skip-Run with `skip_reason=copilot-headless-unsupported`; sequential; done-set keyed by composite `task_id`, filtered `terminal_state==='complete'` | unit (fake readRuns) | `node --test tests/experiments/experiment-runner.test.mjs` | ❌ W0 | ⬜ pending |
| 78-04-01 | 04 | 3 | RUN-02/03 | T-78-INJ | thin operator CLI (`process.stderr.write` diagnostics; `--timeout` override) | unit / CLI exit | `node --test tests/experiments/experiment-run-cli.test.mjs` | ❌ W0 | ⬜ pending |
| 78-04-02 | 04 | 3 | SC#4 | — | 2×2 matrix lands exactly 4 Runs; re-run stays 4 (idempotent); abort cell retries | integration (stub agent) | `node --test tests/experiments/experiment-runner.integration.test.mjs` | ❌ W0 | ⬜ pending |
| 78-05-01 | 05 | 4 | RUN-02/03/04 | T-78-ESC | live claude+opencode smoke + copilot probe + mastra best-effort; blast-radius check (live tree untouched) | live CLI | `node scripts/experiment-run.mjs --spec config/experiments/smoke-cross-agent.yaml` | ❌ W0 | ⬜ pending |
| 78-05-02 | 05 | 4 | SC#4 | — | human-verify checkpoint: exactly one Run per cell in the experiment KB | manual | checkpoint (`autonomous: false`) | — | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky. File-Exists ❌ W0 = the test file is created in that task's Wave 0 (the plans author the tests alongside the code).*

---

## Wave 0 Requirements

- [ ] `tests/experiments/experiment-runner.test.mjs` — RUN-02/03/04 + D-10 via injected seams (fake spawn / fake child / fake readRuns).
- [ ] `tests/experiments/experiment-runner.integration.test.mjs` — SC#4 with a stub agent binary (`node -e "process.exit(0)"`).
- [ ] `tests/experiments/agent-headless.test.mjs` — adapter fixed-argv + Copilot probe.
- [ ] `tests/experiments/run-write.test.mjs` (or extend existing) — the additive tag allow-list.
- [ ] A stub-agent fixture (exits 0 / hangs / exits non-zero on demand) for terminal-state tests.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live cross-agent drive (real `claude -p` / `opencode run` completing a real goal in a sandbox) | RUN-02/03, SC#4 | Requires live agent CLIs + proxy + real wall-clock; non-deterministic | Run 78-05 smoke spec; confirm claude+opencode land scored Runs, copilot/mastra land complete-or-recorded-skip, and the live checkout + live `.data` are untouched (blast-radius check) |
| Copilot headless drivability verdict | RUN-04 | The whole point is an empirical capability check on the installed binary | Observe the probe result on this machine; a recorded skip with `skip_reason` is a PASS (never silently absent) |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies (checker Dimension 2: PASS — every `<verify>` has an `<automated>` command; live-only behaviors isolated to the 78-05 checkpoint)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (test files authored in-task)
- [x] No watch-mode flags (positional `node --test`, no `--watch`)
- [x] Feedback latency < 20s (unit suite)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-07-03
