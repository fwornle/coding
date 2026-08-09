# REPAIRED — the non-claude cells were re-run after a stale-answer-file defect

This run was **PARTIAL VOID** between 2026-08-09 00:15 and 2026-08-09 09:20. It is now whole:
384 cells, all four (arm, agent) halves valid. This file records what was wrong and what was
done, because the repaired numbers are only trustworthy if the repair is auditable.

## The defect

Cells share one sandbox worktree and the answer file has a fixed name (`.kgbench-answer.md`).
The runner never removed it between cells, and `readAnswerFile` only asked "is this file
non-empty?". An agent that exited without writing therefore left the PREVIOUS cell's answer in
place, and it was read, recorded `ok`, and graded against the wrong question.

This inverted the elicitation's entire purpose. The answer file exists SO THAT an early exit
surfaces as `no_result` rather than a false success; staleness turned every early exit back
into a false success with a plausible answer attached.

Fixed in `a990d706f`: `runAgent` deletes any answer file before the spawn, and
`readAnswerFile` rejects a file whose mtime predates the spawn (`stale_answer_file: true`,
outcome `no_result`) as a second defence for when the delete cannot happen.

## The repair

The 192 claude cells were **kept** — they use stream-json and never touched an answer file.
The 192 copilot and opencode cells were removed (pre-image: `results.jsonl.pre-stale-repair`)
and re-run under the fix, as pass 4 at commit `56d581a48`.

The graph index was deliberately **not** rebuilt. It was built at `8a3ea3f0f`, an ancestor of
the pass that produced the retained claude cells, so those cells saw exactly this index.
Reindexing would have given the repaired half a fresher backend than the half it is compared
against. Nothing in the measured tree changed between `ebd7da004` and `56d581a48` except
`.gitignore`, and the questions and answer keys are byte-identical across both.

## Evidence the repair held

|                                   | before (void) | after (repaired) |
|-----------------------------------|---------------|------------------|
| copilot distinct answers          | 34 / 96       | **96 / 96**      |
| opencode distinct answers         | 10 / 96       | **12 / 12 answered** |
| answer text reused across DIFFERENT questions | 5 (one across 11 questions) | **0, all agents** |
| (arm, question) groups with all reps byte-identical | 59 / 64 | **0 / 34** |
| `stale_answer_file` flags         | n/a           | 0 — the pre-delete held, the mtime check never had to fire |
| contaminated / tool_escape        | 0 / 0         | 0 / 0            |

## What the repair changed in the findings

opencode's reported median of 0.00 was an artefact and is gone. Its real behaviour is that it
**does not answer**: 84 of 96 cells are `no_result`, an 88% hard-fail rate, and the 12 cells
where it did answer score 1.00. Under the defect each of those 84 non-answers inherited the
previous cell's text and was graded against the wrong question, which is what manufactured a
capability finding out of a termination bug.

copilot answered 96 of 96 and scores 1.00 median in both arms it can faithfully run.

## Caveat that survives the repair

The secondary judge flapped mid-run: `claude-opus-5` served copilot's first 20 cells, then the
proxy fell back to `claude-haiku-4-5` for the remaining 76. This affects the **Checklist vs
judge disagreements** section only — every median and ranking in the report uses the
deterministic checklist score, not the judge. The report discloses both served models.
