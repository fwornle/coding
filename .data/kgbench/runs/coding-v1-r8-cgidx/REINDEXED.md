# coding-v1-r8-cgidx — what changed, and what did not

This run exists to re-measure two arms whose code-graph backend was, in every earlier run,
answering about the wrong repository.

## The defect this run was made to remove

`r8` and everything before it served the `codegraph` arm an index of the **main working
tree**, never of the sandboxed corpus the arms were told to search. Two causes:

- The MCP server was launched as `docker exec -i coding-services codegraph serve --mcp` with
  no project flag, so it resolved to the container's working directory `/coding` — which
  holds no index and answers `⚠ Not initialized`.
- The arms' worktree is built under `os.tmpdir()`, and the container mounts only
  `${HOME}/Agentic`. No container-side index could have covered it even if one had been asked
  for.

The visible consequences in `r8`: at least 30 of 172 CodeGraph cells said in their own words
that no index was reachable, and five `L2` cells refused outright and were scored 0.00 for it.

## What this run changes — exactly one thing

The index is built over a **second worktree of the same commit with the same exclusions**, at
`.data/kgbench/trees/<runId>/index`, and the server is pinned to it with `-p`. Everything else
is held: same question set, same reps, same agent, same model, same judge, same continuation
budget, and the same searched corpus commit (`f4f13e86a`, pinned with `--commit`).

`run.json` records both commits separately — `commit` is the harness that ran, and
`sandbox.tree_commit` is what the arms searched. They differ here **by design**: the harness
had to change for the corpus to be held still.

## Where the index actually lives, and why not on the bind mount

The first attempt built the index on `/coding/.data`, a Docker bind mount. It ran ~47x slower
than the 36 s baseline — 57 MB after fourteen minutes — and then died with *"Failed to open
SQLite ... unable to open database file"*.

That is the failure this repository documents at `docker/docker-compose.yml:82-86`, where
`.observations` is deliberately not bind-mounted because SQLite's WAL/SHM cannot survive
concurrent access across the boundary. **It is what question A1 of this benchmark asks about.**
The harness reproduced the bug its own question set describes.

So the swept corpus is staged on the host as a worktree (for provenance and identical
exclusions) and copied into the container's own filesystem at `/tmp/kgbench-index-<runId>`,
where the index is built. One large sequential read is what VirtioFS is good at; the thousands
of small synchronous SQLite writes that follow land on overlayfs. **52 s in the smoke run,
149 s here**, against a fourteen-minute failure.

It strengthens containment as a side effect: the index is now out of the arms' reach on two
independent axes — a different tree *and* a different filesystem.

## Why a second tree rather than indexing the arms' own

CodeGraph always writes its database to `<project>/.codegraph/`, and that path cannot be
relocated. The database stores `file_path`, `qualified_name` and `docstring` for every symbol
— so for `L2`, whose question is *which file implements `summaryStats`*, the index file is
itself an answer key, and the `hybrid` arm has `Grep`. Putting the index in the searched tree
would have traded one contamination channel for another, and the containment scanner would
not have caught it: it greps with `-I`, which skips binaries.

Both trees come from the same `createRunTree` call path, so they are identical by
construction rather than by care.

## The reindex is deliberate, and it is an asymmetry

`x2`'s `REPAIRED.md` declined to rebuild its graph index, on the grounds that *"reindexing
would have given the repaired half a fresher backend than the half it is compared against."*
That reasoning is right and does not apply here, because nothing in this run is being compared
against a half of itself. The comparison is **between runs**, and the index is the variable
under test.

It does mean this run's index and `r8`'s index describe different corpora — `r8`'s covered the
main tree including files the sandbox removes, this one covers only what the arms can see.
That is the fix, not a confound, but it is the reason these two runs' CodeGraph numbers may
not be differenced naively against a third run built on either footing.

## What must NOT be read out of this run

- **No comparison with `r8`'s `grep` or `graphify` arms as a same-run baseline.** Those arms
  were not re-run: neither was affected (grep has no MCP; graphify's server is HTTP and
  url-addressed), so re-running them would spend an hour re-measuring known-good numbers. When
  this run's arms are set beside them, they are being set beside *another run's* cells.
- **No splicing into `r8`.** `r8` stays published exactly as it was, caveat intact.
- **Sub-0.03 shifts in a 48-cell mean are not effects.** Two runs of identical configuration
  (`r8-cont2`, `r8-cont2b`) differ by that much on single questions. The result this run is
  entitled to claim is the categorical one — whether cells still report an unreachable index —
  not a decimal improvement.
