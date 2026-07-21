---
phase: 88-experiment-harness-agent-invocation-alignment-and-pre-flight
plan: 03
type: execute
wave: 3
depends_on: [88-02]
files_modified:
  - tests/experiments/_reverify/88-reverify-notes.md
autonomous: false
requirements: [REVERIFY-01]
must_haves:
  truths:
    - "A real cross-agent experiment is RE-RUN unattended (not driven by an interactive agent in this repo)"
    - "All three cells (claude, opencode, copilot) either EXECUTE with non-zero tokens OR record a clean skipped:<reason> — never a silent abort"
    - "The result is confirmed in the dashboard Runs/Compare view, not by DB query alone (e2e, per feedback_e2e_verify)"
  artifacts:
    - path: "tests/experiments/_reverify/88-reverify-notes.md"
      provides: "the recorded run_id, per-cell terminal_state/skip_reason, token counts, and the gsd-browser screenshot path"
  key_links:
    - from: "scripts/experiment-run.mjs"
      to: ".data (main) token_usage + experiment Run store"
      via: "an unattended detached matrix run of a real 3-agent spec"
      pattern: "experiment-run.mjs --spec"
---

<objective>
Prove the Phase 88 fix end-to-end: RE-RUN a real cross-agent experiment UNATTENDED and show all
three cells either execute with non-zero tokens OR record a clean `skipped:<reason>` — the exact
failure the phase exists to kill (a one-horse race that silently aborts opencode + copilot). DB-only
assertions are insufficient (feedback_e2e_verify) — confirm in the dashboard Runs/Compare view via
gsd-browser.

Purpose: the goal-backward acceptance gate for the whole phase — a genuine N-way comparison, or an
observable, diagnosable clean skip for any cell that legitimately can't run.
Output: a recorded re-run (run_id + per-cell dispositions + token counts) and a dashboard screenshot,
captured in the reverify notes.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/88-experiment-harness-agent-invocation-alignment-and-pre-flight/88-CONTEXT.md
@.planning/phases/88-experiment-harness-agent-invocation-alignment-and-pre-flight/88-01-agent-invocation-routing-alignment-PLAN.md
@.planning/phases/88-experiment-harness-agent-invocation-alignment-and-pre-flight/88-02-preflight-gate-and-probe-suppression-PLAN.md

<interfaces>
Unattended runner entry (scripts/experiment-run.mjs):
  node scripts/experiment-run.mjs --spec config/experiments/compare-fizzbuzz.yaml --run-id rv88a
  # gated spec (has test_command) so the judge scores each cell — preferred for a clean pass/fail read.
Env:
  CODING_REPO, LLM_PROXY_DATA_DIR (=<repo>/.data — MUST match the live proxy), LLM_PROXY_PORT (12435).
Pre-run health (CLAUDE.md): the rapid-llm-proxy must be up on :12435 (curl :12435/health → status ok);
  wave-analysis routing / launchd daemons unaffected.
Dashboard: http://localhost:3032 → Performance tab → Runs / Compare (experiment cells keyed by task_hash).
Verify UI with gsd-browser (navigate/screenshot), NEVER a hand-rolled Playwright script (CLAUDE.md).
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Pre-flight the environment + kick off the unattended real re-run</name>
  <read_first>
    - scripts/experiment-run.mjs (the UNATTENDED caveat header lines ~19-37; --run-id/--spec flags; REQUIRED_AGENTS exit logic ~336-351)
    - config/experiments/compare-fizzbuzz.yaml (gated 3-agent spec, corrected by Plan 01)
    - CLAUDE.md (proxy :12435 /health + /api/complete; configure-wave-analysis-routing.sh; run experiments standalone/unattended — NOT from an interactive agent in this repo)
  </read_first>
  <action>
    Confirm the live proxy is healthy: `curl -sf --max-time 3 http://127.0.0.1:12435/health` returns `status":"ok"`
    with copilot `available:true` (if not, kickstart per CLAUDE.md and retry — do not proceed against a down proxy,
    the cells would all record `unrouted`). Create the notes dir `tests/experiments/_reverify/`. Kick off the matrix
    UNATTENDED and DETACHED so it is NOT driven by this interactive session (the one-span-slot caveat — a concurrent
    main-session LLM call would mis-stamp the cell task_id): run
    `CODING_REPO=$PWD LLM_PROXY_DATA_DIR=$PWD/.data node scripts/experiment-run.mjs --spec config/experiments/compare-fizzbuzz.yaml --run-id rv88a`
    via the Bash tool's run_in_background (detached) so it survives across turns; tee stderr to
    `tests/experiments/_reverify/88-rv88a.log`. Record the chosen run_id and the exact command in
    `tests/experiments/_reverify/88-reverify-notes.md`. Do NOT block the whole turn waiting — the matrix runs three
    cells sequentially (up to the 20-min per-cell cap each); poll the log for the per-cell
    `[experiment-run] <task_id> status=… terminal_state=… reason=…` summary lines and the final
    `matrix complete` line before moving to Task 2.
  </action>
  <verify>
    <automated>test -f tests/experiments/_reverify/88-rv88a.log && grep -q "matrix complete" tests/experiments/_reverify/88-rv88a.log</automated>
  </verify>
  <acceptance_criteria>
    - `curl -sf --max-time 3 http://127.0.0.1:12435/health` printed `"status":"ok"` and copilot `"available":true` (recorded in notes)
    - The matrix ran detached/unattended (run_in_background), NOT inline in the interactive session
    - `tests/experiments/_reverify/88-rv88a.log` contains a `[experiment-run] … status=…` line for EACH of the 3 cells and a final `matrix complete` line
    - The exact command + run_id are recorded in `tests/experiments/_reverify/88-reverify-notes.md`
  </acceptance_criteria>
  <done>The proxy is confirmed healthy and a real 3-agent matrix completed unattended with a per-cell summary in the log.</done>
</task>

<task type="auto">
  <name>Task 2: Assert every cell executed (non-zero tokens) or clean-skipped — from the Run store</name>
  <read_first>
    - tests/experiments/_reverify/88-rv88a.log (the run just completed)
    - lib/experiments/query.mjs (readRuns — how to read the Run store for this run_id's task_ids)
    - lib/experiments/store.mjs (openExperimentStore)
    - scripts/measurement-stop.mjs (skip_reason / terminal_state fields on a Run; the A1 no-proxy-rows warning ~769)
  </read_first>
  <action>
    Read the three cells' Runs for run_id `rv88a` (task_ids `compare-fizzbuzz-v9-rv88a--<variant>--r0`) from the
    experiment Run store (openExperimentStore + readRuns, includePending:true). For EACH cell assert the disposition
    is one of the two ACCEPTABLE outcomes: (a) EXECUTED — `terminal_state==='complete'` (or a scored Run) with
    total tokens > 0; or (b) CLEAN SKIP — a non-null `skip_reason` (`preflight:<agent>-…` or
    `copilot-headless-unsupported`). FAIL the check if ANY cell is a SILENT abort: `terminal_state` in {abort,timeout}
    with 0 tokens AND no skip_reason (that is the pre-fix failure mode this phase kills). Specifically confirm the two
    formerly-broken cells: opencode is NOT `abort` with the old `Model not found` cause, and copilot is NOT `abort`
    from a 500 — each is either executed-with-tokens or a diagnosable clean skip. Write the per-cell table
    (variant → terminal_state / skip_reason / total_tokens) into `tests/experiments/_reverify/88-reverify-notes.md`.
    Implement the assertions as a short throwaway node script under `tests/experiments/_reverify/` (or inline
    `node -e`), exiting non-zero if any cell is a silent abort. Diagnostics via process.stderr.write only.
  </action>
  <verify>
    <automated>node tests/experiments/_reverify/assert-cells.mjs</automated>
  </verify>
  <acceptance_criteria>
    - The assertion script reads all 3 cells for run_id rv88a and exits 0
    - Each cell is EITHER `terminal_state==='complete'` with total tokens > 0 OR carries a non-null `skip_reason`
    - NO cell is a silent abort (abort/timeout + 0 tokens + no skip_reason) — the script exits non-zero if one exists
    - opencode's disposition is NOT the old `Model not found: rapid-proxy/...` abort; copilot's is NOT the 500 abort
    - The per-cell disposition table (variant / terminal_state / skip_reason / tokens) is recorded in 88-reverify-notes.md
  </acceptance_criteria>
  <done>Every cell is proven to have either executed with real tokens or recorded a clean, diagnosable skip — no silent aborts.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 3: Operator confirms the N-way result in the dashboard (gsd-browser)</name>
  <what-built>
    A real 3-agent experiment (run_id rv88a) was re-run unattended after the Phase 88 routing/model
    alignment + pre-flight gate. The Run store shows each cell executed with non-zero tokens or recorded
    a clean skip:<reason> — no silent aborts. This checkpoint confirms the same visually in the dashboard,
    per feedback_e2e_verify / feedback_dashboard_screenshots_gsd_browser (never trust a DB read alone).
  </what-built>
  <how-to-verify>
    1. Ensure the dashboard is up: http://localhost:3032 (per CLAUDE.md; restart the frontend if needed).
    2. Capture a screenshot with the gsd-browser CLI (NOT a hand-rolled Playwright script):
       `gsd-browser navigate "http://localhost:3032/performance"` then `gsd-browser screenshot --output tests/experiments/_reverify/88-rv88a-runs.png`.
       Navigate to the Runs / Compare view filtered to the compare-fizzbuzz task_hash (or the rv88a run).
    3. Confirm visually: THREE cells appear for the run — claude, opencode, copilot — each showing either
       real token counts (executed) or an explicit skip badge/reason. Confirm NO cell is a bare 0-token
       silent row with no explanation, and that the copilot pre-flight PROBE did not add a spurious extra row.
    4. Save the screenshot path into tests/experiments/_reverify/88-reverify-notes.md.
  </how-to-verify>
  <resume-signal>Type "approved" if all three cells show executed-or-clean-skip in the dashboard, or describe what looks wrong (e.g. a silent 0-token abort row, a spurious probe row).</resume-signal>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| unattended matrix → shared host proxy + main .data span slot | the single active-measurement.json slot must be owned solely by the run (no concurrent main-session LLM calls) |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-88-03-01 | Spoofing | span-slot mis-attribution | mitigate | run detached/unattended (run_in_background), NOT driven by this interactive session — honors the one-span-slot caveat in experiment-run.mjs |
| T-88-03-02 | Info-disclosure | screenshot may capture repo/session context | accept | dashboard is localhost-only; screenshot saved under the repo test dir |
| T-88-03-SC | Tampering | npm/pip/cargo installs | accept | NO package installs — uses existing scripts + gsd-browser CLI |
</threat_model>

<verification>
- The matrix completed unattended (log has `matrix complete`)
- The assertion script exits 0 — every cell executed-with-tokens or clean-skipped, no silent abort
- Operator confirms the same N-way picture in the dashboard via a gsd-browser screenshot
</verification>

<success_criteria>
- A genuine 3-way comparison (or diagnosable clean skips) is reproduced on a real re-run, unattended
- Confirmed e2e in the dashboard, not by DB query alone
- The two formerly-broken cells (opencode model-not-found, copilot 500) no longer silently abort
</success_criteria>

<output>
Create `.planning/phases/88-experiment-harness-agent-invocation-alignment-and-pre-flight/88-03-SUMMARY.md` when done
</output>
