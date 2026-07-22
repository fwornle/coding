# Phase 88 — Re-verify Notes (rv88a)

## Task 1 — unattended real re-run

- **Spec:** config/experiments/compare-fizzbuzz.yaml (gated, judge-scored; opencode model corrected to `rapid-proxy/claude-haiku-4.5`, copilot `auto`→resolver default)
- **run_id:** rv88a
- **Command:** `CODING_REPO=$PWD LLM_PROXY_DATA_DIR=$PWD/.data node scripts/experiment-run.mjs --spec config/experiments/compare-fizzbuzz.yaml --run-id rv88a`
- **Launched:** detached via Bash run_in_background (NOT inline in the interactive session — honors the one-span-slot caveat, T-88-03-01)
- **Proxy pre-check:** `:12435/health` → status=ok, claude-code=true, copilot=true
- **Log:** tests/experiments/_reverify/88-rv88a.log

## Task 2 — per-cell dispositions

`node tests/experiments/_reverify/assert-cells.mjs` → **exit 0 (PASSED)**. Reads the authoritative
runner-log `writeRun`/status lines (experiments LevelDB is single-owner and was locked by obs-api/exporter).

| Variant | terminal_state | tokens | calls | skip_reason | vs. first run (compare-avenues-help-v1) |
|---------|----------------|--------|-------|-------------|------------------------------------------|
| claude / sonnet | complete | 11,183 | 3 | — | complete (unchanged) |
| opencode / rapid-proxy/claude-haiku-4.5 | **complete** | **28,331** | 2 | — | was **abort · `Model not found: rapid-proxy/claude-haiku-4-5`** |
| copilot / auto | **complete** | **57,158** | 2 | — | was **abort · `500 Internal Server Error`** |

All three cells executed with non-zero tokens; **no silent aborts**. The two formerly-broken cells
(opencode model-not-found, copilot 500) now execute — Phase 88 goal achieved. (score=trivial for all
is expected for the smoke fizzbuzz baseline and orthogonal to the execute-or-skip goal.)

## Task 3 — dashboard confirmation (gsd-browser)

- **Screenshot:** tests/experiments/_reverify/88-rv88a-runs.png (localhost:3032/performance → Runs)
- **Confirmed visually:** all three `compare-fizzbuzz-v9-rv88a--{claude,opencode,copilot}` cells appear with
  real token counts (claude 11,183 · opencode 28,331 · copilot 57,158). NO 0-token silent-abort row for rv88a.
- **Suppression verified:** the copilot pre-flight `POST /api/complete` probe added NO spurious Runs row
  (the only "Reply with the single word OK" row is the 16h-old pre-fix one, not from rv88a).
- **Operator sign-off:** APPROVED (2026-07-22)
