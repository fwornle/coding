# Phase 59 Plan 05 — 24h Orphan-Floor Soak Runbook

Operator-facing runbook for `scripts/poll-orphan-floor-soak.mjs` — the 24-sample hourly polling harness that proves ORPHAN-FLOOR (`orphanCount <= 10 sustained across 24h of online-learning activity`) against the km-core REST view at `localhost:3848`.

Anchored to Phase 59 CONTEXT.md D-04 (one-shot lifecycle), D-05 (canonical endpoint binding to `:3848`), and the Plan 59-05 frontmatter must-haves.

## Section 1 — When to run the soak

Prerequisites — verify each BEFORE invoking the soak. A premature soak measures the wrong steady state and the evidence will be invalid.

- **Plan 59-02 (Digest derivedFrom writer fix) MUST be deployed.** Verify via:
  ```bash
  grep -c "type: 'derivedFrom'" src/live-logging/ObservationConsolidator.js
  ```
  Expected: ≥ 1.
- **Plan 59-03 (`_pushInsightToKG` consumer refactor) MUST be deployed.** Verify via:
  ```bash
  grep -c "result.mintedId" src/live-logging/ObservationConsolidator.js
  ```
  Expected: ≥ 1.
- **The obs-api daemon (`com.coding.obs-api`) MUST be live and have been live for at least one full consolidation cycle (default 5 minutes) since the deploy.** This proves the writer-fix code is actually executing in the running process, not just sitting on disk. Verify via:
  ```bash
  launchctl list | grep com.coding.obs-api
  ```
  Then check the daemon's stdout/stderr log for evidence of at least one consolidation tick since the deploy timestamp.
- **Plan 59-04's repair script MUST have been run LIVE at least once.** The soak measures the post-repair steady state, NOT the orphan-recovery slope. Verify via the most recent `.data/repair-orphan-digest-insight-edges-<ts>.json` summary file showing a `--layer=both` run.
- **The km-core REST endpoint at `:3848` MUST be live** (served by the semantic-analysis SSE server in the coding-services container). Verify via:
  ```bash
  curl -s http://localhost:3848/api/v1/stats | head -c 200
  ```
  Expected: a JSON response with `data.orphanCount`, `data.nodeCount` (or `data.nodes`), and `data.connectivity` keys.

If any prerequisite fails, do NOT start the soak — fix the gap first, otherwise the evidence is meaningless.

## Section 2 — How to run

The soak takes 24 hours; the operator's terminal will close. Run it inside a tmux session so the process survives. The single-line invocation:

```bash
tmux new-session -d -s orphan-soak 'cd /Users/Q284340/Agentic/coding && node scripts/poll-orphan-floor-soak.mjs 2>&1 | tee .data/orphan-floor-soak-runlog.txt'
```

Why `tmux`: the soak takes ~24h; the operator's shell session would terminate the foreground process otherwise. Why `tee`: keep a live tail of stderr+stdout for monitoring without re-attaching to tmux.

### Monitoring mid-run

Inspect the last few sample log lines:
```bash
tmux capture-pane -t orphan-soak -p | tail -20
tail -f .data/orphan-floor-soak-runlog.txt
```

Inspect the last-written sample in the incremental session log:
```bash
ls -t .data/orphan-floor-soak-*.json | head -1                          # find the latest
cat $(ls -t .data/orphan-floor-soak-*.json | head -1) | jq '.samples[-1]'
```

### Aborting cleanly (if needed)

```bash
tmux send-keys -t orphan-soak C-c
tmux kill-session -t orphan-soak
```

CTRL-C between samples leaves the partial session log intact — the writer is one-shot per-sample, so the partial JSON is valid. CTRL-C DURING a fetch may leave a stale lock-free record (the in-flight sample was not appended), but the previously-written records are intact.

## Section 3 — Interpreting the output

End-of-run summary written to stdout AND to the final session-log file (under a `summary` key):

```json
{
  "totalSamples": 24,
  "validSamples": 24,
  "failedSamples": 0,
  "threshold": 10,
  "breached": false,
  "orphanCount": { "max": 7, "min": 4, "mean": 6, "median": 6 },
  "startedAt": "2026-06-17T08:00:00.000Z",
  "endedAt": "2026-06-18T08:00:00.000Z",
  "sessionLogPath": ".data/orphan-floor-soak-2026-06-17T08-00-00-000Z.json",
  "kmcoreRestBase": "http://localhost:3848"
}
```

The `kmcoreRestBase` field is the operator's confirmation that the soak hit the km-core REST view (`:3848`), NOT the obs-api daemon view. If the field shows any other host or port (e.g., because an operator exported `KMCORE_REST_BASE` to "match an analog script"), the soak is INVALID and must be re-run — the two graphs differ and Phase 59 SC#4 specifically anchors on `:3848`.

### Decision matrix

| Result                                                                                | Verdict                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `breached: false` AND `validSamples == 24` AND `kmcoreRestBase: http://localhost:3848` | SC#4 met. The full samples array in the session log is the evidence — paste a link in the Phase 59 final SUMMARY.                                                                                                                  |
| `breached: false` BUT `validSamples < 24` (some failed samples)                       | Conditional success. The soak ran but had REST fetch failures. Operator inspects which samples failed (timestamps in `errors[]`) and decides whether the failures are environmental (e.g., a container restart — acceptable) or systemic (e.g., persistent network issue — re-run). Document the call in the SUMMARY. |
| `breached: true`                                                                      | SC#4 NOT met. The script exits 1; the session log lists every breaching sample with its `orphanCount`. Inspect: is the breach gradually climbing (writer regression — file follow-up) or spiky (a backfill or migration ran during the soak — acceptable, document)? See Section 4.                                  |
| `kmcoreRestBase != http://localhost:3848`                                              | Soak hit the wrong graph. INVALID. Re-run with the default `KMCORE_REST_BASE`.                                                                                                                                                     |

## Section 4 — What to do on breach

Three escalation paths depending on the breach shape (read the `samples` array in the session log to classify):

1. **Gradual climb** (`orphanCount` increases monotonically across samples) — writer regression. The Phase 59 fixes have eroded. File a fresh todo against `src/live-logging/ObservationConsolidator.js` and/or `src/live-logging/ObservationWriter.js`; the soak data is the evidence. Phase 59 stays closed; the writer regression is a separate bug-fix phase.

2. **Sudden spike** (one or two samples spike, then return to baseline) — external event. Check the obs-api / km-core REST logs for the spike window — a backfill job, a sub-agent burst, a container restart. Often acceptable; operator decides. Document the spike timestamp and cause in the SUMMARY.

3. **Persistent floor above 10** (`orphanCount` stays in the 11–50 range for the whole soak) — ORPHAN-FLOOR's `<=10` target is too tight for the current population. File a discussion phase to either tighten the writer further OR relax the threshold; do NOT silently re-run the soak with a relaxed threshold (that defeats the measurement).

## Section 5 — Lifecycle

Per CONTEXT.md D-04.1 this script is ONE-SHOT. After the SC#4-meeting soak completes:

- Retain `.data/orphan-floor-soak-<ts>.json` as evidence — link it from the Phase 59 final SUMMARY. Plans 59-02 / 59-03 / 59-04 are the writer-side / consumer-side / repair-side fixes; this soak is the milestone-close measurement.
- The script `scripts/poll-orphan-floor-soak.mjs` MAY be deleted (operator's call — keeping it is harmless but adds noise to `scripts/`). The deletion is mechanical: `git rm scripts/poll-orphan-floor-soak.mjs && git commit`.
- This runbook stays under `.planning/phases/59-.../` as historical record. Future operators auditing why ORPHAN-FLOOR passed should be able to read it.

No new permanent infrastructure is provisioned for orphan-count observability — no launchd plist, no dashboard widget. If long-term orphan monitoring becomes a requirement, file a separate phase (per CONTEXT.md `<deferred>` "Permanent orphan-count observability"). The ONE-SHOT lifecycle is deliberate: the milestone proves the writer fixes hold; sustained observability is a different problem with different trade-offs.
