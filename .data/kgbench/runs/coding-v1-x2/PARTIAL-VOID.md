# PARTIAL VOID — the non-claude cells read stale answer files

384 cells. The **192 claude cells are valid**. The **192 copilot and opencode cells are not.**

## What happened

Cells share one sandbox worktree and the answer file has a fixed name
(`.kgbench-answer.md`). The runner never removed it between cells, and `readAnswerFile` only
asked "is this file non-empty?". So an agent that exited without writing left the PREVIOUS
cell's answer in place, and it was read, recorded as `ok`, and graded against the wrong
question.

Evidence from this run:

    agent      cells   distinct answers   texts reused across DIFFERENT questions
    claude       192            191         0     <- stream-json, no answer file
    copilot       96             34         0
    opencode      96             10         5

One opencode answer text was scored against ELEVEN different questions
(S3, B1, B2, B3, A1, A2, A3, A4, T1, T3, T4). opencode's reported median of 0.00 is that
artefact, not a capability finding — its L1 answers, written for the question actually asked,
score 1.00 and correctly identify `install.sh:1322`.

copilot shows no cross-question reuse, but 59 of 64 non-claude (arm, question) groups have all
three repetitions byte-identical. That is either genuine determinism or a stale read, and the
text alone cannot distinguish them — so copilot's repetitions 2 and 3 are unsafe to trust.

## Why this was worse than a plain bug

The answer-file elicitation exists SO THAT an early exit surfaces as `no_result` instead of a
false success. Staleness inverted exactly that: every early exit became a false success with a
plausible answer attached.

## Fixed

`runAgent` now deletes any answer file before the spawn, and `readAnswerFile` rejects a file
whose mtime predates the spawn (`stale_answer_file: true`, outcome `no_result`) — a second
defence for when the delete cannot happen. Two regression tests pin both.

The claude cells in this run were never affected: they use stream-json and no answer file.
