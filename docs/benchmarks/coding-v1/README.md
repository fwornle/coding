# Code-retrieval benchmark: coding-v1

Question set `coding-v1` (16 questions, 3-10 reps/arm) against 4 arms.
Repo at `7e08b6a60`, model `claude-sonnet-5`, generated 2026-08-08T05:52:09.523Z.

Arms searched a sandboxed worktree of `7e08b6a60` with 17 path(s) removed (answer key, telemetry exports, agent rule files), verified to contain no question prompt or provenance note.

Assembled across 2 commits (`47928068f`, `7e08b6a60`) — later passes added reps to a subset of questions. Cells are not all from one tree state.

> **2 answer(s) inferred the nature of the question** without citing any ground truth. Scored normally: reaching a conclusion from an empty search is the behaviour under test, not a leak. Counted because a question whose framing telegraphs its own answer measures less than retrieval does.

## Overall

| Arm | ranked | correctness (median) | content tokens (median) | total tokens (median) | tool calls | latency s | hard-fail | hallucination |
|---|--:|--:|--:|--:|--:|--:|--:|--:|
| grep | 76/76 | 1.00 | 53898 | 76016 | 3.5 | 16.8 | 0% | 0% |
| graphify | 76/76 | 1.00 | 96392 | 118955 | 4.0 | 22.5 | 0% | 0% |
| codegraph | 76/76 | 1.00 | 171084 | 192448 | 7.0 | 50.0 | 0% | 0% |
| hybrid | 76/76 | 1.00 | 59993 | 85373 | 4.0 | 16.6 | 0% | 0% |

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
| grep | 76 | 76 | 0 | 0 | 0% | 0% |
| graphify | 76 | 76 | 0 | 0 | 0% | 0% |
| codegraph | 76 | 76 | 0 | 0 | 1% | 0% |
| hybrid | 76 | 76 | 0 | 0 | 0% | 0% |

Failed runs are counted, never dropped. An arm that stalls is not cheap — it is unavailable, and averaging only its successes would report the opposite.

## Checklist vs judge disagreements

| Question | Arm | checklist | judge | note |
|---|---|--:|--:|---|
| B2 | graphify | 1.00 | 0.50 | checklist_higher |
| A1 | graphify | 1.00 | 0.65 | checklist_higher |
| B2 | codegraph | 0.50 | 1.00 | judge_higher |
| B2 | codegraph | 1.00 | 0.65 | checklist_higher |
| A2 | codegraph | 0.50 | 0.15 | checklist_higher |
| A2 | codegraph | 0.50 | 0.15 | checklist_higher |
| L1 | hybrid | 0.50 | 1.00 | judge_higher |
| B2 | hybrid | 0.50 | 1.00 | judge_higher |
| A1 | hybrid | 1.00 | 0.65 | checklist_higher |
| A1 | graphify | 1.00 | 0.65 | checklist_higher |
| A2 | codegraph | 1.00 | 0.50 | checklist_higher |
| A2 | codegraph | 1.00 | 0.65 | checklist_higher |
| A2 | codegraph | 0.50 | 0.15 | checklist_higher |

`judge_higher` usually means the checklist matcher is too strict (the answer paraphrased a path) — fix the matcher and re-grade offline. `checklist_higher` usually means correct strings were padded into a wrong narrative, which is a real quality signal. A question exceeding 10% disagreement across arms is the question's problem, not the arms'.

## Limitations

- 3-10 reps per cell on one repository with one model and one scorer.
- Arms other than `hybrid` are FORCED onto a single retrieval strategy, which is not how an agent works in practice. Read them against `hybrid`, not against each other.
- Indexing cost is excluded from per-query numbers; it is reported separately per backend.
- Corpus scope differs between backends (graphify indexes docs and PDFs; code-only backends do not), so node/edge counts are not comparable at face value.
