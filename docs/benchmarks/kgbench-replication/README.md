# Code-retrieval benchmark: replication

Question set `replication` (9 questions, 3 reps/arm) against 2 arms.
Repo at `3fd7d40de`, model `claude-sonnet-5`, generated 2026-08-05T18:29:38.114Z.

## Overall

| Arm | ranked | correctness (median) | content tokens (median) | total tokens (median) | tool calls | latency s | hard-fail | hallucination |
|---|--:|--:|--:|--:|--:|--:|--:|--:|
| grep | 27/27 | 1.00 | 145649 | 217042 | 2.0 | 11.6 | 0% | 0% |
| graphify | 27/27 | 1.00 | 148299 | 220992 | 2.0 | 17.0 | 0% | 0% |

**content tokens** = total minus that arm's measured empty-run baseline. Whole-session totals are dominated by a fixed floor of system prompt + tool schemas, which compresses every ratio; content tokens are what separate retrieval strategies.

## Winner by question class

| Class | grep | graphify | winner |
|---|--:|--:|---|
| arch | 1.00 | 1.00 | tie — tie (ratio 1.00x < 1.25x) |
| blast | 1.00 | 1.00 | tie — tie (ratio 1.00x < 1.25x) |
| lookup | 1.00 | 1.00 | tie — tie (ratio 1.00x < 1.25x) |
| structural | 1.00 | 1.00 | tie — tie (ratio 1.00x < 1.25x) |

A winner is declared only at a ≥1.25x median gap with non-overlapping IQR. Anything weaker prints "tie" — at these sample sizes a 1.3x gap is not a result.

## Reliability

| Arm | runs | ranked | ungraded | failed | retry rate | hard-fail rate |
|---|--:|--:|--:|--:|--:|--:|
| grep | 27 | 27 | 0 | 0 | 0% | 0% |
| graphify | 27 | 27 | 0 | 0 | 7% | 0% |

Failed runs are counted, never dropped. An arm that stalls is not cheap — it is unavailable, and averaging only its successes would report the opposite.

## Limitations

- 3 reps per cell on one repository with one model and one scorer.
- Arms other than `hybrid` are FORCED onto a single retrieval strategy, which is not how an agent works in practice. Read them against `hybrid`, not against each other.
- Indexing cost is excluded from per-query numbers; it is reported separately per backend.
- Corpus scope differs between backends (graphify indexes docs and PDFs; code-only backends do not), so node/edge counts are not comparable at face value.

---

## Why this run exists

This is not a new finding. It is the harness's own correctness test: the same 9
questions and the same two arms as `docs/benchmarks/graphify-vs-grep/`, re-run through
kgbench. Until these numbers line up, a difference between backends cannot be
distinguished from a bug in the measurement.

| Metric | graphify-vs-grep (bench.py) | kgbench | verdict |
|---|--:|--:|---|
| grep median tool-calls | 2 | 2.0 | exact |
| graph median tool-calls | 2 | 2.0 | exact |
| grep median total tokens | 218,828 | 217,042 | −0.8% |
| graph median total tokens | 221,970 | 220,992 | −0.4% |
| graph/grep token ratio | 1.014× | 1.018× | reproduced |
| grep correctness | 1.00 | 1.00 | exact |
| graph-arm instability | 2/27 (7%) hard-fail | 2/27 (7%) retried | same rate |

Token counts reproduce within 1% and tool-call medians are exact, so the harness
measures what its predecessor measured.

**The one metric that did not reproduce is cost** ($0.157→$0.141 grep, $0.188→$0.152
graph). That is expected rather than alarming: kgbench routes through the LLM proxy
onto the Max subscription, where cost is notional, while the original run billed a
different path. Cost should not be compared across the two reports.

**The instability reproduced exactly, and is worth reading carefully.** The original
report recorded 2/27 graph-arm runs as hard failures. Here the same 2/27 stalled and
were recovered by a retry, so they appear as a 7% retry rate with a 0% hard-fail rate.
Same underlying flakiness in the graphify MCP path; the difference is that this harness
retries and reports both numbers separately. Reading the 0% hard-fail rate alone would
understate it.

## What this run does NOT show

Both arms score 1.00 on every class. That is not evidence that the two backends are
equivalent — it means **this question set cannot tell them apart**. Nine questions, most
answerable from a single well-chosen grep, with graders that accept a bare path. The
original report's apparent graph advantage came almost entirely from the stalls being
scored as failures, not from better answers.

So this set is fit for its purpose (validating the harness) and unfit for the actual
evaluation. The real set needs harder multi-hop questions, an abstention/trap class, and
first-party evidence rather than graphify submodule internals — 6 of these 9 cite
`integrations/graphify/`, which CI cannot verify and which would become meaningless if
graphify were ever swapped out.

## Standing costs

Measured empty-run baselines: grep 71,393 tokens, graphify 72,693. Registering
graphify's six MCP tools therefore costs **~1,300 tokens on every call**, paid whether
or not the graph is consulted. At these question sizes that is roughly half the median
tool-result payload, and it is a cost the grep arm never pays.
