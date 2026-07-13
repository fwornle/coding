# Plan 78-05 Summary — Live Cross-Agent Smoke + Acceptance Checkpoint

**Status:** complete (operator-approved 2026-07-13)
**Requirements:** RUN-02, RUN-03, RUN-04 (SC#4)
**Autonomous:** false (live token spend + human-verify checkpoint)

## What ran

`node scripts/experiment-run.mjs --spec config/experiments/smoke-cross-agent.yaml` — a live 3-agent matrix (experiment `exp-3ec6afa7a1c5`), trivial goal "Create a file named HELLO.txt … containing the single word hello.", `repeats: 1`, `test_command: node --version` (score-time only), `snapshot_id: smoke-spec`.

## Per-cell outcomes (live)

| Cell (variant) | terminal_state | tokens | calls | Notes |
|----------------|----------------|--------|-------|-------|
| `claude-haiku-straight-default` | **complete** | 318 | 4 | real work, scored (trivial) |
| `opencode-rapid-proxy/claude-haiku-4-5-straight-default` | **complete** | 26,472 | 2 | real work via rapid-proxy, scored (trivial) |
| `copilot-auto-straight-default` | **complete** | 0 | 0 | RUN-04 probe → **true** (ran); copilot LLM provider returned persistent **500 Internal Server Error** after 5 retries → cell recorded complete-but-empty (see caveat) |

`readRuns(includePending:true)` grew 36 → **39** — exactly one new Run per attempted cell, none silently absent.

## Acceptance criteria — all met

- **SC#4 / RUN-02 / RUN-03:** the two REQUIRED headless-drivable agents (claude + opencode, D-12) completed end-to-end unattended, each landing exactly one scored Run tagged with `variant`/`repeat`/`task_hash` and a terminal state. ✅
- **RUN-04:** copilot participation gated on the live headless-drivability probe (returned `true` → run-branch fired); the cell executed and recorded a Run — never silently absent. ✅
- **D-02 (zero blast radius):** `git status` on the live checkout shows **no `HELLO.txt`** and **no agent source edits** — all cell edits confined to isolated sandbox worktrees (`restoreForCell inPlace:false`). ✅

## Caveats (honest record)

1. **Copilot cell empty (provider 500, not a runner defect):** the copilot LLM provider (BMW copilot endpoint) returned `500` on every attempt, so the copilot agent produced no work. The **runner behaved correctly** — it launched the cell, ran the RUN-04 probe, measured the span, and recorded `terminal_state=complete` with a Run (0 tokens). A re-run once the provider recovers would produce a working copilot cell. The `[measurement-stop] A1 WARN` (copilot no proxy/adapter rows) is the known copilot token-capture nuance, not new.
2. **RUN-04 skip-branch not live-exercised:** the probe *passed* in this environment, so the run-branch fired; the negative skip-branch (`copilot-headless-unsupported` recorded skip) remains unit-tested-only. Forcing it requires an environment where copilot is genuinely undriveable.
3. **Mastra intentionally omitted:** `KNOWN_AGENTS` (`[claude, copilot, opencode]`) is a frozen, test-guarded, route-attribution-coupled enum; admitting `mastracode` is an architectural change out of this yaml-only plan's scope. The 3-agent smoke satisfies SC#4's "≥2 agents." Extending the enum for a mastra cell is a documented follow-up option.
4. **Snapshot hygiene:** `smoke-spec` snapshot references a `lib/km-core` submodule commit (`cd027076…`) that has since been gc'd → `restore-snapshot` logged a non-fatal submodule-checkout failure and proceeded (best-effort restore, sandbox KB left empty). Cells still completed. Worth refreshing the baseline snapshot in a follow-up.

## Artifacts

- Run log: `.data/78-05-smoke-run.log`
- Measurement archives: `.data/measurements/exp-3ec6afa7a1c5--*.json`
- Store rows: 3 new Runs under `exp-3ec6afa7a1c5` (query via `readRuns`)
