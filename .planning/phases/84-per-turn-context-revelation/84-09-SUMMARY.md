---
phase: 84-per-turn-context-revelation
plan: 09
subsystem: live-e2e-gate
tags: [live-proof, proxy-redeploy, context-turns, raw-bodies, redaction, read-apis, cache-explainer, human-verify, wave-4]

# Dependency graph
requires:
  - "84-03 — retention sweeper (age-based .gz cleanup)"
  - "84-04 — proxy write hook + GET /api/context-turns route"
  - "84-05 — span-close gzip + observation-ref enrichment"
  - "84-06 — flag-gated redacted raw-body capture"
  - "84-07 — vkb-server read pass-through + dashboard mirror"
  - "84-08 — honest per-turn cache explainer (N/A + caching copy)"
provides:
  - ".planning/phases/84-per-turn-context-revelation/84-LIVE-GATE.md — recorded live end-to-end evidence"
  - "redeployed proxy (build b1e0a49) with the 84-04/06 write hooks LIVE"
  - "activated dashboard /api/context-turns mirror (84-07 deferred container restart performed)"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Live measured span driven by startMeasurement({meta:{capture_raw_bodies:true}}) + real POST /api/complete, closed via the real scripts/measurement-stop.mjs so the 84-05 gzip-at-close fires"
    - "Redaction proven on live traffic by embedding synthetic fake secrets in a real request and asserting <SECRET/TOKEN/JWT_REDACTED> markers with zero unredacted survivors"

key-files:
  created:
    - .planning/phases/84-per-turn-context-revelation/84-LIVE-GATE.md
    - .planning/phases/84-per-turn-context-revelation/evidence/84-09-live-explainer.png
    - .planning/phases/84-per-turn-context-revelation/evidence/84-09-live-perturn-table.png
    - .planning/phases/84-per-turn-context-revelation/evidence/84-09-divider-aligned.png
    - .planning/phases/84-per-turn-context-revelation/evidence/84-09-reconciliation-note.png
    - .planning/todos/pending/2026-07-08-timeline-per-turn-intent-fallback.md
  modified:
    - integrations/system-health-dashboard/src/components/performance/context-cache-explainer.tsx

key-decisions:
  - "Coordinator network.location=open + proxy.networkMode=public + 0 strong-network failures were confirmed BEFORE the kickstart (T-84-09-02 / Pitfall 6); post-kickstart re-confirmed still open — no corporate mis-detect."
  - "capture_raw_bodies rides on span.meta (D-05); injected via startMeasurement meta, read at the proxy through the single-reader getActiveMeasurement() — no new flag surface invented."
  - "/api/complete emits wire:'openai' lines regardless of the auto-routed backend provider, so all three live turns are OpenAI-wire with cache_write:null — exactly the N/A path the gate must demonstrate; a real Anthropic-wire cell was not required (and the anthropic/claude-code HTTP providers were unavailable at run time anyway)."
  - "The dashboard /api/context-turns mirror (84-07) was activated here via a full docker-compose restart coding-services — the container restart 84-07 explicitly deferred to 84-09 (Pitfall 5: full restart invalidates the VirtioFS cache)."

requirements-completed: []

# Metrics
duration: ~18min
completed: 2026-07-08
---

# Phase 84 Plan 09: Live End-to-End Gate Summary

**The whole per-turn-context-revelation pipeline was proven honestly end-to-end on one live measured span: the proxy was redeployed (build `e72666a` -> `b1e0a49`) after confirming the coordinator `location=open`, a single measured span with `capture_raw_bodies=true` fired three real `/api/complete` requests, span close produced real `context-turns.jsonl.gz` + `raw-bodies.jsonl.gz`, both read APIs (proxy + vkb-via-dashboard, plus the newly-activated dashboard mirror) served the three OpenAI-wire turns, the live raw bodies redacted three embedded synthetic secrets to `<SECRET/TOKEN/JWT_REDACTED>` with zero unredacted survivors, and the cache explainer rendered the live per-turn split with "N/A (provider reports no cache-creation)" for every OpenAI-wire turn — captured in gsd-browser screenshots. The phase-gate human-verify checkpoint (Task 3) was APPROVED by the operator, who requested three post-approval UI refinements (#1 divider visibility+alignment and #2 an honest Timeline reconciliation note — both applied; #3 a Timeline per-turn intent fallback — assessed and deferred to Phase 86). Phase 84 is COMPLETE (9/9 plans).**

## Performance

- **Duration:** ~18 min
- **Completed (autonomous tasks):** 2026-07-08
- **Tasks:** 3 (2 autonomous PASS + 1 human-verify checkpoint APPROVED with refinements)
- **Files created:** 5 (evidence md + 4 screenshots) + 1 follow-up; **modified:** 1 in-repo component (`context-cache-explainer.tsx` refinements) + the live-gate + deferred-items docs. The proxy runtime edits live in the `_work/rapid-llm-proxy` repo from 84-04/06.

## Accomplishments

- **Task 1 — redeploy + live span (PASS).** Confirmed coordinator `network.location=open` / `proxy.networkMode=public` / `consecutive_strong_network_failures=0`, then `launchctl kickstart -k gui/$(id -u)/com.coding.llm-cli-proxy` (server.mjs is runtime JS — **no build**). Build flipped `e72666a` -> `b1e0a49`, `networkMode` stayed `public`, and `GET /api/context-turns` flipped from `{"error":"Not found"}` to graceful-empty (route now live). Opened one measured span (`task_id=ctx-live-84-09--copilot-openai--r0`) with `meta.capture_raw_bodies=true`, fired three real `POST /api/complete` requests (all 200), and closed via `scripts/measurement-stop.mjs --headless`. Produced real `context-turns.jsonl.gz` (540 B) + `raw-bodies.jsonl.gz` (473 B), plaintext removed, `active-measurement.json` gone.
- **Task 2 — read APIs + redaction (PASS).** Proxy `GET :12435/api/context-turns?task_id=` -> 3 turns with the separate `usage.{input,output,cache_read,cache_write:null}` split + `wire` + `preview`. vkb-via-dashboard `GET :3032/api/experiments/runs/<tid>/context-turns` -> same 3 turns (the explainer's data source). Activated the dashboard `/api/context-turns` mirror via `docker-compose restart coding-services` (84-07's deferred restart) -> 3 turns; both routes graceful-empty on a nonexistent id. Redaction on live traffic: request #2 embedded three synthetic fake secrets; the gunzipped `raw-bodies.jsonl.gz` had **0** unredacted secret substrings, with `<SECRET_REDACTED>` / `<TOKEN_REDACTED>` / `<JWT_REDACTED>` markers proving the shared 27-pattern applier ran (fail-closed, T-84-09-01).
- **Task 3 — phase-gate human-verify: APPROVED WITH REFINEMENTS.** Drove the explainer open for the REAL live task_id (Redux `setExplainTaskId`; runs KB empty for this ad-hoc span, so no "Explain" button — the DATA is pulled live by `fetchContextTurns` through the read route, not a fixture). Live DOM + gsd-browser screenshots confirmed the honest render (per-turn table all `openai`, cache-write "N/A (provider reports no cache-creation)", real varying input, verdict + caching copy). The operator **approved** the gate and requested three refinements before phase close, all handled in this continuation:
  - **#1 (APPLIED)** — Cache-boundary divider now bold **3px dashed, theme-aware `border-foreground`** (crisp in light+dark), and the band + `◀ cacheable prefix / new this turn ▶` label row share one relative wrapper so the divider spans both and lands on the label split. Evidence: `evidence/84-09-divider-aligned.png`.
  - **#2 (APPLIED)** — Honest reconciliation note by the per-turn table. A parallel edit had also added a Phase-75 wall-clock note; the two were consolidated into ONE block (commit `19f066f5e`) that shows the measured grand total AND, when the raw token-usage timeline lists more rows than the measured context-turns, names the operator-verified root cause: the extra turns are ones the context-turns write hook never sees (e.g. claude-code CLI adapter turns) plus Phase-75 wall-clock concurrent traffic. No fabricated rows. Live-verified on run-b: "3 measured requests … timeline may list 5 rows — the extra 2 …". Evidence: `evidence/84-09-reconciliation-note.png`.
  - **#3 (ASSESSED → DEFERRED to Phase 86)** — `timeline.tsx` already has the D-07 correlation machinery and renders per-turn intents when observations exist; `0 intents` is genuine for a synthetic span. The user-input-preview fallback is Phase-86 "Timeline v2 + declutter" scope → follow-up `.planning/todos/pending/2026-07-08-timeline-per-turn-intent-fallback.md`.

## Task Commits

1. **Live-gate evidence + 2 screenshots** — `b7c083e6d` (docs)
2. **Explainer redesign fixes (make-up band + per-turn narrative + secret scrub)** — `cd5fb9cbe` (feat)
3. **Refinements #1 divider + #2 reconciliation note + #3 follow-up** — `6f72052f0` (feat)
4. **Consolidate the reconciliation note (merged a parallel Phase-75 note + this plan's write-hook note into one; dynamic N-vs-M row count)** — `19f066f5e` (feat)

## Files Created

- `.planning/phases/84-per-turn-context-revelation/84-LIVE-GATE.md` — full recorded evidence (commands, task_id, paths, curl outputs, gunzip grep, screenshot paths, redaction segment).
- `.planning/phases/84-per-turn-context-revelation/evidence/84-09-live-explainer.png` — explainer header + real-data verdict.
- `.planning/phases/84-per-turn-context-revelation/evidence/84-09-live-perturn-table.png` — per-turn chart + stat cards (N/A) + per-turn table + caching copy.

## Deviations from Plan

**1. [Planned-here] Activated the dashboard `/api/context-turns` mirror via full container restart.**
- **Found during:** Task 2.
- **Issue:** The mirror (84-07) returned `Cannot GET /api/context-turns` — 84-07 explicitly deferred its `docker-compose restart coding-services` to this plan.
- **Fix:** Ran the full restart (Pitfall 5 — invalidates the VirtioFS cache); the mirror then served 3 turns. Not a scope change — this restart is 84-09's documented job. The two REQUIRED read surfaces (proxy + vkb-via-dashboard) already passed before the restart.

**2. [Environment] Live turns are OpenAI-wire only (no Anthropic-wire cell).**
- **Found during:** Task 1.
- **Issue:** The proxy's `anthropic` + `claude-code` HTTP providers reported `available:false` at run time; only OpenAI-wire `/api/complete` traffic was routable. A dedicated `/v1/messages` Anthropic-wire cell would have failed.
- **Fix:** Ran the span through `/api/complete`, which emits `wire:'openai'` lines — precisely the `cache_write:null` -> N/A path the gate must prove. The must-have ("N/A for OpenAI-wire") is fully satisfied; the real Anthropic-wire cache-write render was already operator-approved on the 84-08 fixture. No blocker.

## Threat Surface

- **T-84-09-01 (Information Disclosure — live secrets in raw-bodies)** mitigated + PROVEN: 0 unredacted secrets survived; synthetic fakes masked to `<…_REDACTED>`.
- **T-84-09-02 (Tampering — proxy kickstart corporate mis-detect)** mitigated + PROVEN: `location=open` confirmed before AND after kickstart; `networkMode=public` throughout.
- **T-84-09-SC (npm installs)** N/A: no package installs; proxy is runtime JS (no build).

## Verification

- `context-turns.jsonl.gz` + `raw-bodies.jsonl.gz` present under `.data/measurements/ctx-live-84-09--copilot-openai--r0/` after close.
- Proxy read count=3; vkb-via-dashboard count=3; dashboard mirror count=3; graceful-empty on nonexistent.
- `grep -Eic 'sk-ant…|ghp_…|eyJ…'` on gunzipped raw-bodies -> 0 unredacted; redaction markers present.
- gsd-browser screenshots confirm honest explainer on the live task_id (N/A per OpenAI-wire turn).

## Next Phase Readiness

- **Phase 84 (per-turn-context-revelation) is COMPLETE (9/9 plans).** Task-3 human-verify APPROVED (with the three refinements applied/assessed above). The full write -> close -> read -> explainer path is proven live end-to-end and operator-signed-off. Downstream: Phase 86 (Timeline v2 + declutter) consumes these per-turn context-turns AND picks up the deferred per-turn intent fallback (`.planning/todos/pending/2026-07-08-timeline-per-turn-intent-fallback.md`).

## Self-Check: PASSED

- `context-cache-explainer.tsx` modified, tsc-clean, live-rendered (turns-capture-banner + timeline-reconciliation-note both present via gsd-browser DOM assertions).
- Evidence screenshots `84-09-divider-aligned.png` + `84-09-reconciliation-note.png` exist on disk.
- Follow-up `.planning/todos/pending/2026-07-08-timeline-per-turn-intent-fallback.md` created.
- Commits `b7c083e6d`, `cd5fb9cbe`, `6f72052f0` in git history.

---
*Phase: 84-per-turn-context-revelation*
*Completed: 2026-07-08; human-verify APPROVED with refinements — Phase 84 COMPLETE (9/9)*
