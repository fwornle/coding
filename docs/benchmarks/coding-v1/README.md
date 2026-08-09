# Code-retrieval benchmark: coding-v1

Question set `coding-v1` (16 questions, 3 reps/arm) against 4 arms.
Repo at `ebd7da004`, model `claude-sonnet-5`, generated 2026-08-09T06:02:29.733Z.

Secondary scorer: `claude-haiku-4-5-20251001`, `claude-opus-5` via `claude-code`. **Requested `claude-opus-5` — the proxy served something else; the served model is what graded these cells.**

Arms searched a sandboxed worktree of `ebd7da004` with 26 path(s) removed (answer key, telemetry exports, agent rule files), verified to contain no question prompt or provenance note.

Assembled across 2 commits (`48c9206d1`, `ebd7da004`) — later passes added reps to a subset of questions. Cells are not all from one tree state.

> **Partial run: only `claude` cells are reported here.** 192 cell(s) from `copilot`, `opencode` are excluded and every number below is over the kept subset alone. Reason: the copilot and opencode cells read a previous cell's stale answer file — see PARTIAL-VOID.md in the run directory

## Overall

| Arm | ranked | correctness (median) | content tokens (median) | total tokens (median) | tool calls | latency s | hard-fail | hallucination |
|---|--:|--:|--:|--:|--:|--:|--:|--:|
| grep | 48/48 | 1.00 | 74872 | 97308 | 4.0 | 17.8 | 0% | 2% |
| graphify | 48/48 | 1.00 | 180527 | 203562 | 8.0 | 36.5 | 0% | 0% |
| codegraph | 48/48 | 1.00 | 133001 | 154838 | 6.0 | 33.4 | 0% | 0% |
| hybrid | 48/48 | 1.00 | 83081 | 108940 | 4.0 | 20.1 | 0% | 0% |

**content tokens** = total minus that arm's measured empty-run baseline. Whole-session totals are dominated by a fixed floor of system prompt + tool schemas, which compresses every ratio; content tokens are what separate retrieval strategies.

## Winner by question class

| Class | grep | graphify | codegraph | hybrid | winner |
|---|--:|--:|--:|--:|---|
| abstain | 1.00 | 1.00 | 1.00 | 1.00 | tie — tie (ratio 1.00x < 1.25x) |
| arch | 1.00 | 1.00 | 1.00 | 1.00 | tie — tie (ratio 1.00x < 1.25x) |
| blast | 1.00 | 1.00 | 1.00 | 1.00 | tie — tie (ratio 1.00x < 1.25x) |
| lookup | 1.00 | 1.00 | 1.00 | 1.00 | tie — tie (ratio 1.00x < 1.25x) |
| structural | 1.00 | 1.00 | 1.00 | 1.00 | tie — tie (ratio 1.00x < 1.25x) |

A winner is declared only at a ≥1.25x median gap with non-overlapping IQR. Anything weaker prints "tie" — at these sample sizes a 1.3x gap is not a result.

## Reliability

| Arm | runs | ranked | ungraded | failed | retry rate | hard-fail rate |
|---|--:|--:|--:|--:|--:|--:|
| grep | 48 | 48 | 0 | 0 | 0% | 0% |
| graphify | 48 | 48 | 0 | 0 | 0% | 0% |
| codegraph | 48 | 48 | 0 | 0 | 0% | 0% |
| hybrid | 48 | 48 | 0 | 0 | 0% | 0% |

Failed runs are counted, never dropped. An arm that stalls is not cheap — it is unavailable, and averaging only its successes would report the opposite.

## Checklist vs judge disagreements

| Question | Arm | checklist | judge | note |
|---|---|--:|--:|---|
| A4 | grep | 0.33 | 0.00 | checklist_higher |
| L2 | graphify | 1.00 | 0.50 | checklist_higher |
| A1 | graphify | 1.00 | 0.50 | checklist_higher |
| B2 | codegraph | 1.00 | 0.50 | checklist_higher |
| A2 | codegraph | 1.00 | 0.57 | checklist_higher |
| A4 | codegraph | 0.33 | 0.00 | checklist_higher |
| A4 | codegraph | 0.33 | 0.00 | checklist_higher |

`judge_higher` usually means the checklist matcher is too strict (the answer paraphrased a path) — fix the matcher and re-grade offline. `checklist_higher` usually means correct strings were padded into a wrong narrative, which is a real quality signal.

**This table is an alarm, not a diagnosis.** It says two graders differ; it does not say which is wrong, and the answer has not once been the obvious one. Across every investigation on this set the causes were a judge rubric, a false answer key, a regex, a shared match token, and a matcher that was too loose and too narrow at the same time — *never* a badly written question. Twice the arms were right and the key was wrong. And the detector is blind to the most common defect of all: because the judge's prompt is built from the same checklist, a WRONG KEY makes both graders agree and produces zero disagreements. See [Measurement and judging lessons](../measurement-lessons.md) before concluding a question is at fault.

## Limitations

- 3 reps per cell on one repository with one scorer and one model.
- Arms other than `hybrid` are FORCED onto a single retrieval strategy, which is not how an agent works in practice. Read them against `hybrid`, not against each other.
- Indexing cost is excluded from per-query numbers; it is reported separately per backend.
- Corpus scope differs between backends (graphify indexes docs and PDFs; code-only backends do not), so node/edge counts are not comparable at face value.
