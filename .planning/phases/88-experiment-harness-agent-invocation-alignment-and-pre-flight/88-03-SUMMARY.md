# Plan 88-03 — Unattended Cross-Agent Re-verify — SUMMARY

**Status:** Complete
**Requirement:** REVERIFY-01
**Type:** verification (autonomous:false — human-verify checkpoint)

## What was proven

The Phase 88 fix was validated end-to-end with a **real, unattended** cross-agent re-run — the exact
scenario the phase exists to fix (a one-horse race that silently aborted opencode + copilot).

- **Run:** `node scripts/experiment-run.mjs --spec config/experiments/compare-fizzbuzz.yaml --run-id rv88a`,
  launched detached (Bash `run_in_background`) so it was NOT driven by the interactive session
  (honors the one-span-slot caveat, T-88-03-01). Proxy pre-checked healthy (`:12435/health` → status=ok,
  claude-code=true, copilot=true).
- **Result:** `matrix complete: 3 cells` — every cell `terminal_state=complete`.

| Variant | terminal_state | tokens | vs. pre-fix (compare-avenues-help-v1) |
|---------|----------------|--------|----------------------------------------|
| claude / sonnet | complete | 11,183 | complete (unchanged) |
| opencode / rapid-proxy/claude-haiku-4.5 | complete | 28,331 | **was abort · `Model not found: rapid-proxy/claude-haiku-4-5`** |
| copilot / auto | complete | 57,158 | **was abort · `500 Internal Server Error`** |

## Verification

- **Task 1:** `tests/experiments/_reverify/88-rv88a.log` contains a per-cell `[experiment-run] … status=… terminal_state=complete` line for all 3 cells and a final `matrix complete`.
- **Task 2:** `node tests/experiments/_reverify/assert-cells.mjs` → **exit 0** — every cell executed with tokens>0 (or would clean-skip); NO silent abort (abort/timeout + 0 tokens + no skip_reason). Reads the authoritative runner-log writeRun/status lines (experiments LevelDB is single-owner and was locked by obs-api/exporter).
- **Task 3 (human-verify, gated):** dashboard `localhost:3032/performance → Runs` screenshot `tests/experiments/_reverify/88-rv88a-runs.png` shows all 3 `compare-fizzbuzz-v9-rv88a--*` cells with real token counts; the copilot pre-flight `POST /api/complete` probe added **NO** spurious Runs row (suppression-by-construction confirmed). **Operator sign-off: APPROVED (2026-07-22).**

## Key files

- `tests/experiments/_reverify/88-reverify-notes.md` — run_id, command, per-cell table, screenshot path, sign-off
- `tests/experiments/_reverify/assert-cells.mjs` — disposition assertion (exit non-zero on silent abort)
- `tests/experiments/_reverify/88-rv88a.log` — the unattended run log
- `tests/experiments/_reverify/88-rv88a-runs.png` — dashboard confirmation screenshot

## Deviations

- Task 2's assertion reads the runner log rather than opening the experiments LevelDB directly: the store
  is single-owner (km-core constraint) and was locked by obs-api/exporter at assert time. The log's
  `writeRun`/status lines are the same values written to the store, so the evidence is equivalent.
- `score=trivial` for all three cells is expected for the smoke fizzbuzz baseline (the judge marks it
  trivial) and is orthogonal to REVERIFY-01's execute-or-clean-skip goal.

## Self-Check: PASSED
Matrix completed unattended; assertion exits 0; operator approved the dashboard N-way picture.
