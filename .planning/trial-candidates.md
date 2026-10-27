# Trial candidates — let a trial find the cheapest model that still does the job

Living plan. Update the status and the session log at the end of every session.

Status: **Step 1 done 2026-10-27** (coding on main; rapid-llm-proxy `feat/trial-candidates`, PR open, running live from that branch). Next: Step 2.

## Why

A savings suggestion today names exactly one target, `ROUTE_TARGET = claude-haiku-5.5`
(`integrations/system-health-dashboard/src/components/cost/cost-model.ts`), and a trial
(rapid-llm-proxy `proxy-bridge/model-trials.mjs`) takes exactly one candidate, named by
band (`candidateComplexity`), so only a provider's band model can ever be tried. The
first real trial (consolidator-insight, Sonnet 5 → Haiku 5.5, started 2026-10-26) is
heading for a fail: 56 % of pairs at least as good (needs 90 %), 87 % of details kept
(needs 90 %). Cheaper models that might pass were never on the menu:

| Account | Cheaper than claude-sonnet-5 ($2.50 in / $10 out per MTok on Copilot) |
|---|---|
| gh-copilot (`available_models`) | gpt-4o-mini (included, $0), gpt-5.6-luna ($0.25 / $1.20), claude-haiku-4.5 ($1.24 / $5), claude-haiku-5.5 (no rate-card row — priced by family today) |
| gh-copilot (answered the 2026-09-18 probe, not listed) | gpt-5-mini, gemini-3.8-flash |
| qwen-local (on-prem cluster), qwen-laptop | $0 — own hardware, when reachable |

Prices differ by token mix (background calls are mostly cache reads), so a candidate is
ranked by what the process's own last 7 days of tokens would have cost on it, not by
list price.

## The idea

A trial no longer needs a model picked up front. **Automatic** (the default) gives the
trial a list of candidates, cheapest first; the trial tries them all on real traffic and
reports the cheapest one that passes. A dedicated model from the same list can still be
chosen instead.

The quality bar is unchanged — the blind, both-orders judge and the thresholds per
candidate (`minSamples`, `passRate`, `minRetention`, format match). The workshop data
(bmw.ghe.com FG-4-ETA/llm-router-evaluation-workshop) is a prior for what to try, never
the verdict: its tasks are benchmark Q&A on the BMW LLM API catalogue, ours are
summaries and extractions on Copilot / the cluster.

## Design

### Candidates (coding dashboard, `cost-model.ts`)

`trialCandidates(rows, cfg, process, catalogue)` — for one background process:

- **Where from:** `GET /api/llm/routing` → `providers[].availableModels`. Eligible:
  the incumbent's own account (a downgrade stays on the same bill) plus local accounts
  (`on-prem`, `on-device`) whose impl is in `runtime.availableImpls`. Other metered
  accounts (private OpenAI / Anthropic keys) and the flat Claude Max subscription are
  not offered — a different bill, not a downgrade.
- **Cost:** the process's rows in the last 7 complete days, repriced on the candidate
  (`cellCostUsd` with the candidate's provider + model), scaled to a month. A price that
  only resolves by family is marked an estimate.
- **Kept:** cheaper than the incumbent on that mix, and not the incumbent itself.
  Ordered cheapest first; local ($0) first. At most 4 go into an automatic trial.

### Savings suggestion

One per process: "Try cheaper models for X" — the candidates with their monthly cost,
the saving range, and one action: start a trial (automatic by default). It replaces
"Route X to Haiku 5.5".

### Trial config (Token Usage → Trials, and the suggestion's button)

Candidates select: **Automatic — cheapest that passes (n models)** first and default,
then each candidate with its estimated monthly cost. POST
`/api/trials { process, mode: 'auto'|'single', candidates: [{provider, model}] }`.

### Multi-candidate trial (rapid-llm-proxy `model-trials.mjs`, `server.mjs`)

- `createTrial` takes `candidates[]` (order = preference: cheapest first, set by the
  caller, which owns prices) and `mode`. Each model must be in its provider's
  `available_models`. Old trials (`candidate`) read as a one-entry list.
- **Sampling:** a sampled call goes to EVERY active candidate (changed 2026-10-27 at the
  user's request, from one candidate per call): their answers to the same request sit side
  by side, sharing a `requestId`, the request stored once. One candidate call per candidate
  per sampled call; every candidate collects as fast as a one-model trial.
- **Per candidate:** `maxSamples` is per candidate. A candidate is **done** when it has
  `minSamples` judged pairs; **out** when its failures (worse + inconsistent) exceed
  `(1 − passRate) · minSamples` — it can no longer pass. A candidate dearer than one
  that has already passed is stopped (automatic wants the cheapest that passes).
- **Length:** 3 days by default, automatic or not. The trial completes when no candidate
  is active, or at `endsAt`.
- **Summary:** `summarize()` per candidate (unchanged rules) plus `winner` = the first
  candidate in list order whose verdict is pass. Trial verdict: pass with a winner,
  pending while any candidate is active, else fail / insufficient.
- **Accept:** `POST /api/trials/:id/accept { candidate? }` (default: the winner; force
  as today). Writes the route: provider, and either the band whose model it is or a
  model pin.

### Route model pin (rapid-llm-proxy `routing-config.mjs`)

`routes.<key>.model` — optional, must be in the provider's `available_models`
(validated at load like the band table). Applies only while the call stays on that
provider: a semantic offload or a fallback hop gets its own band model, as today.
Refused on `from-caller` routes. PATCH `/api/llm/routing` accepts `model` (null
deletes). `/resolve` and the Routing tab show the pin.

## Steps

1. **Candidates + automatic trial** — everything above: candidate ranking, suggestion,
   trial config with Automatic as default, multi-candidate trial, route model pin.
   Tests on both sides. Proxy on a branch → PR; coding on main.
2. **The cluster as a real candidate** — latency recorded per candidate already (sample
   `latencyMs`); add a latency threshold for local candidates (a background process
   with a deadline must not move to a model that misses it) and offer the cluster only
   while its health probe passes.
3. **Prior from the router dataset** — show the workshop's overall accuracy beside
   each candidate where the model overlaps (gpt-5.6-luna 71.8 %, gpt-5-mini 71.4 %,
   claude-sonnet-5 72.5 %); optionally order equal-cost candidates by it.
4. **Catalogue + rates** — add `claude-haiku-5.5` to `COPILOT_RATE_CARD` once its rate
   is confirmed (until then it is priced as Haiku 4.5 by family); re-probe gpt-5-mini
   and gemini-3.8-flash and list them if they answer.
5. **glass** — ship the read-only Trials view of multi-candidate trials and the new
   suggestion text after the proxy PR merges.

## Session log

- **2026-10-27** — plan written. Running trial consolidator-insight-20261026-1515-2643
  (Haiku 5.5) at 16 / 20 judged, 56 % ok, 87 % retention — will fail; its successor is
  an automatic trial.
- **2026-10-27 (Step 1)** — proxy `feat/trial-candidates`: `candidates[]` + `mode`, per-candidate
  states (active / passed / failed / out / skipped / short), `nextCandidate` (fewest pairs,
  skips an unreachable provider), winner = first passed; route `model` pin (parse, resolve,
  PATCH, `modelPin` on /resolve); `impl` in the provider catalogue. 591 node + 35 vitest green.
  coding: `trialCandidates` / `autoTrialCandidates` / `failedTrialModels` in cost-model.ts,
  suggestions "Try cheaper models for X" with a saving range, Trials form (Automatic default,
  or one model), per-candidate table + accept per candidate. Test loader now bundles a module
  that imports `@/` (cost-model's price suite had failed to load since 2026-10-24). Verified
  live with gsd-browser on :3032; smoke trial on `trial-smoke` started (auto, 2 candidates,
  6 days), refused an unserved model and an accept without a pass, rejected. Under the new
  rules the Haiku 5.5 trial resolved to complete / fail (Haiku "out": 7 of 16 pairs failed).
  Not done: no automatic trial started on a real process — the user's call.
- **2026-10-27 (fan-out)** — PR #69 opened; automatic trial consolidator-insight-20261027-0642-4e2d
  started (gpt-4o-mini, gpt-5.6-luna, claude-haiku-4.5; 9 days under the old default). Then,
  at the user's request, each sampled call goes to every active candidate
  (`candidatesToSample`, `requestId`, `requestRef`), default 3 days; dashboard pairs table
  one row per call with a column per candidate, column 2 of an opened pair steps through
  the candidates.

