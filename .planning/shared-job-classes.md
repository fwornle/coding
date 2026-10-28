# Shared job classes — a group-learned prompt classifier

Status: **proposal** (2026-10-27). Nothing below is built.

## The idea in one paragraph

A group of users (a coding *team*) shares one **job-class definition** in a git repo
on bmw.ghe.com or github.com. The first member creates it, with coding/glass doing
the work. A strong model (the *teacher*) writes and maintains the definition. A cheap
or local model (the *student*) runs the classifier on every eligible prompt and names
the job's class. Each class gathers its own evidence from **model trials** ("for
`docs` jobs, haiku keeps 94% of the details"), so the band the router may downgrade to
comes from measurements on that kind of work, not from a three-line rubric. A
configured cap on the number of classes keeps the taxonomy small and stable. Everyone
in the group pulls the definition, contributes labelled examples back, and benefits
from trials anyone in the group ran.

## What exists today (and what it implies)

| Piece | Where | What this proposal reuses |
|---|---|---|
| Band classifier: downgrade-only, attributed (`band_source='classifier'`), reproducible via `/resolve?classified=true`, `from-caller` routes only | `rapid-llm-proxy/proxy-bridge/prompt-classifier.mjs`, `classifier-client.mjs` | Every safety property stays. The class is a second output beside the band, not a replacement for the rules |
| Eligibility cascade: MID_LOOP gate (74% of turns), cheap veto, 20 KB cap; the turn's band is remembered for its tool loop | `prompt-classifier.mjs`, `turn-band.mjs` | The class is decided once per turn on the first call, then inherited, the same way the band is |
| Classifier **service** :12437: strategies `llm`/`knn`/`hybrid`/`shadow`, MiniLM embeddings, abstains below similarity/margin thresholds, network-following backends | `scripts/prompt-classifier-service.mjs`, `config/prompt-classifier.yaml`, `scripts/lib/prompt-classifier-knn.mjs` | **The student already exists** as a 3-class KNN. It becomes an N-class KNN trained on the group's examples |
| Training: labels from *least-capable-success* scores, group-wise folds, per-band precision gate ≥ 0.90 | `scripts/prepare-prompt-classifier-labels.mjs`, `train-prompt-classifier-knn.mjs`, `docs/architecture/prompt-classifier-training.md` | Same trainer, same gate, run **per class** |
| Model trials: shadow-sample a share of calls to candidates, blind double-order judge, retention/format checks, verdict = recommendation only, keyed by **process** | `rapid-llm-proxy/proxy-bridge/model-trials.mjs` (the Trials tab in the screenshot) | Key by `(route, class)` as well as by process |
| Taxonomy derivation with a measured cap: **kappa 0.77 at cap 14–20**, 0.49 at 8–12; at 16–24 the model reproduces module names | `scripts/derive-intent-spine.mjs`, `config/intent-taxonomy.json` | The method and the cap default. Categories are `{name, test}`, i.e. a definition plus an inclusion/exclusion rule |
| Closed-6 task taxonomy (refactor, bugfix, new-feature, migration, debug, docs) | `config/task-taxonomy.yaml`, `lib/experiments/taxonomy.mjs` | **Seed v0** for a new group, so nobody starts from an empty file |
| Teams = sets of repos; shared learning repos cloned read-only under `<data home>/var/shared/`; `coding sync` pull at launch, push only on request; kb merge driver | `lib/teams/*`, `lib/history/sync.mjs`, `docs/architecture/teams.md`, `knowledge-sharing.md` | Distribution, sync cadence and the merge-driver pattern. A group *is* a team |
| `token_usage.band_source`, `conversation_key`, `turn_index` | `rapid-llm-proxy/src/token-usage.ts` | Add `job_class` (+ `job_class_source`) next to them |

Constraints the code imposes, which the plan must respect:

1. **`fg-chat/claude` can never be rerouted.** It is an Anthropic passthrough pinned
   to `claude-code-max`, so for Claude Code the class is **reporting and evidence
   only**. Routing benefits reach opencode, pi and (once it declares) copilot, plus
   any background caller that opts in.
2. **A foreground agentic turn cannot be *shadowed* live**, because a candidate's
   tool calls would act on the user's real tree. It **can be replayed offline**,
   kgbench-style (`docs-content/measurement/kgbench-guide.md`): one replay is a
   *cell* (class × candidate × prompt × rep). It runs in a worktree at the commit
   the prompt was given on, and the incumbent's real outcome (the session's diff
   and final answer) is the reference. kgbench's controls carry over as they are:
   - verify containment. The later commit, the LSL of that session and kb
     injection are exactly the leak channels kgbench found, the injection hook
     above all.
   - closed outcome set: timeout, host_stalled, tool_escape and so on. A failure is
     a row, never dropped.
   - store raw outputs so grading can be revised.
   - grade with a deterministic checklist where one exists (tests pass, the same
     files touched), plus a judge whose job is to disagree.

   Live sampling stays for single-call jobs (`bg-*`) and the **first call of a
   foreground turn**. Replays are the per-class evidence for whole turns. Both need
   the class, because "`docs` jobs" is a population that can be measured and
   "all foreground turns" is not: kgbench reports per question class for the same
   reason.
3. **The judge sits in front of the call it is trying to make cheaper**, so the
   student must be local/unmetered and within the proxy's 6 s classifier budget
   (bimodal ~4.7 s / 11 s on the cluster). KNN verdicts take milliseconds, so the
   LLM is the fallback, not the main path.
4. **Providers are accounts.** A trial verdict ("`gh-copilot/claude-haiku-4.5` passes
   for `docs`") transfers only to members who have that account. Shared evidence must
   be stored per model *and* per provider, and every member resolves it against their
   own `llm-routing.yaml`.

## Design

### 1. The definition package (what lives in the shared repo)

```
<group-repo>/job-classes/
  taxonomy.yaml        version, maxClasses, classes{id: {label, definition, test,
                       aliases[], maxBand?, tombstone?}}
  exemplars/<id>.jsonl teacher-written SYNTHETIC exemplars, + redacted real ones
                       (bmw.ghe only, opt-in per member), {text, group, source}
  evidence/<id>.json   per (provider/model): trial verdicts with n, pass rate,
                       retention, date, contributor hash
  model.json           OPTIONAL prebuilt KNN artifact; members can rebuild locally
  CHANGELOG.md         one line per taxonomy version: added/merged/retired
```

- **Class ids are stable slugs.** A rename adds an alias, and a merge leaves a
  tombstone `{mergedInto: x}`, so historical `token_usage.job_class` rows keep
  resolving. This follows the `kmTombstones` lesson: a deletion without a tombstone
  comes back to life on the next merge.
- **Privacy is enforced in the format.** On a public github.com repo only synthetic
  exemplars are allowed, and the sync step refuses to stage real ones. On bmw.ghe
  real exemplars still pass the same redaction as observations
  (`config/redaction/redaction-patterns.json` plus the `<USER_ID_REDACTED>` rules).
  Synthetic exemplars are also the better definition: they are written to sit
  squarely inside the `test`, and the teacher can produce them in bulk.

### 2. Teacher and student

| Role | Model | When | Output |
|---|---|---|---|
| **Teacher** | strong (sonnet-5 / opus via `bg-job-class-teacher`, budgeted, AFK-gated like other background LLM work) | bootstrap; nightly over a sample of the day's eligible first-call prompts; on any proposal to add or merge a class | taxonomy edits, labels for real prompts, synthetic exemplars |
| **Student** | the :12437 service, `strategy: hybrid`: N-class KNN over exemplar embeddings, abstain → closed-set LLM pick on the local backend (as `MentionsClassifier` picks from a list) | every eligible prompt | `{band, class, classConfidence, classSource: knn\|llm\|abstain}` |

"Learned to be classified" is a distillation loop: teacher labels → exemplars → KNN
retrain (the trainer already hot-loads the artifact by mtime) → shadow agreement with
the teacher on the next sample → per-class precision gate. A class whose student
precision is below the gate still **exists** (it is reported, and its rows are
labelled by the teacher offline) but does not **drive routing**. Today's gate does the
same per band.

### 3. Dedup and the class cap

`maxClasses` defaults to **16**, inside the measured stable range of 14–20. Each
teacher run may *propose* a new class. The proposal is decided in this order:

1. **Absorb**: if the proposal's exemplar centroid is within cosine θ (start at 0.80,
   tuned on held-out data) of an existing class, the teacher checks it against that
   class's `test`. If it fits, the proposal's exemplars join that class. Most
   proposals should end here.
2. **Add**: if it is distinct and `count < maxClasses`, it becomes a class with
   `status: candidate` and is shadow-only until it has enough exemplars to pass the
   gate.
3. **Merge to make room**: if it is distinct and the cap is reached, the teacher looks
   at the closest existing pair (by centroid) and either merges them, which frees a
   slot, or rejects the proposal into the nearest class. It is told explicitly not to
   name classes after modules, the failure seen at cap 16–24.
4. **Stability check before publishing.** Re-label a fixed held-out set under old and
   new taxonomy. A version bump whose kappa against the previous version falls below
   0.7 on the unchanged classes is refused. That would be churn, not learning.

Every merge, add or retire is a taxonomy `version` bump with a CHANGELOG line, and
nothing changes silently.

### 4. Distribution: who writes what

- **Binding**: a team entry gains `jobClasses: { repo: <url>, path: job-classes }` in
  `config/teams.yaml` or `~/.coding/teams.yaml`. A session's repo → its teams → that
  binding, through the same resolution `/api/retrieve` uses. A repo in two teams with
  two bindings is refused at load, so there is no guessing which taxonomy applies.
- **Bootstrap** (the first member): `coding job-classes init --team <id> --repo <url>`
  (with the same action in the dashboard's Teams tab) seeds from
  `config/task-taxonomy.yaml`. It then runs the teacher over that member's last N
  days of captured first-call prompts to propose classes up to the cap, writes
  synthetic exemplars, commits and asks before pushing.
- **Members**: the repo is cloned like a shared learning repo
  (`<data home>/var/shared/…`) and pulled by `coding sync` at launch. The service
  rebuilds its KNN from the exemplars when `taxonomy.yaml` or the exemplars change.
- **Contributions** (new exemplars, evidence, class proposals) never edit the shared
  files directly. They go to `proposals/<member-hash>/<ts>.json` and are pushed only
  through `coding sync --push`, keeping the "nothing else ever pushes" rule. A
  **maintainer** run (by whoever holds the role, by default the creator) applies the
  dedup procedure above and folds proposals into a new version. Only one writer
  changes the taxonomy, so there are no taxonomy merge conflicts. Proposal files never
  conflict either, because each member writes only their own directory.

### 5. Using the class

- **Routing** (opt-in per team, after the gate): `taxonomy.classes.<id>.maxBand` is
  replaced by a **per-member derived floor**. A class may be downgraded to band B for
  this member only if `evidence/<id>.json` holds a passing trial for the model that B
  resolves to on *this member's* route. The existing downgrade-only, `allowedBands`
  and fail-open rules then apply unchanged. The class only decides which downgrades
  the evidence permits.
- **Trials**: `createTrial` accepts `jobClass`. Sampling filters on the turn's class
  (first call only for `fg-*`), and the one-running-trial rule becomes per
  `(process, jobClass)`. Accepted verdicts are written to `evidence/` as a proposal,
  so one member's trial spares everyone else from running it.
- **Reporting**: a `job_class` column on `token_usage`. The Token Usage page gains
  "by class": cost, calls, and band actually used against the band the evidence
  allows, which is the *potential saving* per class. This works for Claude Code too.
  glass shows it read-only, as it shows trials today.

## Phases

| # | Deliverable | Gate to the next |
|---|---|---|
| **P0 — measure** | Offline script: teacher labels ~2 weeks of captured first-call prompts from `context_turns`, at cap 16, twice | kappa ≥ 0.7 between the two derivations, and a class distribution not dominated by one bucket. **If this fails, stop: there is no stable taxonomy to share** |
| **P1 — local class, shadow** | Service returns `class` (KNN + closed-set LLM fallback); `job_class`/`job_class_source` columns; "by class" view; no routing effect | Student vs teacher per-class precision on held-out data |
| **P2 — shared repo, read side** ✅ | Package format + validator, `teams.yaml` binding, `job-classes init`, pull via `coding sync`, local KNN rebuild | Two machines resolve the same class for the same prompt |
| **P3 — contributions + dedup** ✅ | `proposals/`, maintainer fold with absorb/add/merge/stability check, versioned CHANGELOG, tombstones | A forced cap overflow merges correctly and keeps old rows resolvable |
| **P4 — per-class trials + evidence routing** | `jobClass` on trials; fg first-call sampling; `evidence/` publishing; evidence-derived band floor per member | One accepted class trial changes a routing decision on a second member's machine and is visible in `/resolve` |
| **P5 — glass** | glass reads the binding and shows classes, evidence and "by class" read-only. Whether glass gets `init` depends on question 3 below | — |

Touch points: coding (service, trainer, teacher, sync, teams, dashboard),
rapid-llm-proxy (`job_class` column, trial keying, class-aware band floor in
`offload.mjs`), glass (manifest additions, UI). Three new feature-flag mappings under
`classifier`/`llm-proxy` must be declared in the four places
`tests/features/*.test.mjs` checks.

## P0 results (2026-10-27)

Script: `scripts/measure-job-classes.mjs`. Reports in `.data/job-classes/p0/` (not committed).

**Derived taxonomies fail the gate.** Two derivations from the same 876 prompts,
both capped at 18 classes, agree at kappa 0.54 (ARI 0.44). The teacher applies one
taxonomy consistently (0.84 when it labels the same prompts twice), so the
instability is in the derivation itself. A core covering 37% of prompts is stable
(bug fixing, docs, cleanup, features, session relays). The git, status and
troubleshooting splits are redrawn on every run. MiniLM KNN reproduces the
teacher on 25%, so it is no student.

**A committed taxonomy passes** (`config/job-classes.yaml`, 11 classes with
examples, a precedence order and a "none" rule). v1 was tuned on the 300
held-out prompts, so it is also scored on a test set of 300 pool prompts nobody
read while tuning. Teacher and students label one prompt per call with the same
request.

| | dev (tuned on) | test (unseen) |
|---|---|---|
| teacher pass 1 vs 2 | 0.921 | 0.928 |
| claude-haiku-5.5 | 0.795 | 0.776 |
| gpt-5.6-luna | 0.799 | 0.773 |
| gpt-5.6-terra | 0.784 | 0.772 |
| gpt-4o-mini | 0.666 | 0.711 |

The same students under the derived taxonomy A scored 0.59–0.71, and under the
first hand-written draft (v0) 0.54–0.70. Students agree with the teacher on about
80% of unseen prompts. The remaining confusions are build↔docs, fix↔status and
explain↔status, plus none↔status on fragments.

**What this changes in the design:**
- Section 3 (automatic derivation and dedup up to a cap) does not survive as
  designed. A group shares a taxonomy someone wrote and versions. Proposals
  (P3) become edits to that file and are scored with this script on dev and
  test before they are merged.
- Section 2: the student is a closed-set LLM call on the `bg-job-class-student`
  route (rapid-llm-proxy), not KNN. A cheap cloud model reaches kappa ≈ 0.78.
  Local Qwen is not yet measured (the cluster was unavailable).
- A student's agreement with the teacher is scored by exact label match, with
  no judge, so the per-class trial in P4 is cheaper than a model-trial pair.

## P2 results (2026-10-28)

Built, the read side. Decisions: the package lives in a team member's
existing learning repo (no new repo), a group is a coding team, and no prompt
leaves the machine (the reference set stays in `<data home>/var/job-classes/`).

What changed against the design above, and why:
- **No exemplars and no KNN.** P0/P1 made the student an LLM reading the
  taxonomy's own prompt, so the package is only `job-classes/taxonomy.yaml`
  (with a `name`, so labels are tagged `<name>-v<version>`) and `CHANGELOG.md`.
- **The folder is fixed at `job-classes/`**, not configurable: any other
  top-level entry of a learning checkout is moved into `history/` by
  `restructure` (`lib/history/repo-link.mjs`, where `job-classes` is now a
  layout entry).
- **The proxy does not learn about teams.** coding resolves project → team →
  taxonomy into `<data home>/var/job-classes/bindings.json`
  (`lib/job-classes/package.mjs`), rewritten by `init`/`join`/`status` and after
  every `coding sync pull`; the tagger reads it by mtime. No index or no entry =
  the default taxonomy. A project two teams bind to different taxonomies is
  **not labelled** (skip reason `taxonomy-conflict`).
- `coding job-classes init|join|validate|status` (`lib/job-classes/cli.mjs`).
  `init` writes into the member's OWN learning checkout and commits locally;
  `join` clones a teammate's repo under `var/shared/` (pull-only). Pushing stays
  `coding sync --push`.
- `/api/job-classes` lists every taxonomy in use; `summary` and `coverage` take
  `?taxonomy=<tag>`. The dashboard's Classes tab has a taxonomy picker.

Gate: simulated with a second home that joined from a clone of the committed
package. Both machines resolved project `coding` to `job-classes-coding-v1`
(same file hash) and the real student gave the same class on 5/5 prompts. A
real second machine is still to do, after `coding sync --push`.

Team `coding` is bound on this machine (`coding-history`, committed locally,
not pushed). Its reference set does not exist yet: the measurement has to be
run under the team taxonomy's tag
(`measure-job-classes.mjs --team=coding --taxonomy=<package file>`).

## P3 results (2026-10-28)

Built: `coding job-classes propose|fold` (`lib/job-classes/evolve.mjs`).

- **Proposals live in the proposer's OWN learning repo**, under
  `job-classes/proposals/<team>/<member>-<time>.json`, not in the package
  repo: a teammate's package clone is pull-only. The maintainer already pulls
  every member's repo, which is where `fold` finds them. A member is a
  10-character pseudonym, never a user or host name.
- **No prompt is shared.** The teacher reads the member's gaps (reference
  prompts labelled none or labelled two ways, live `none` turns) and writes
  synthetic examples. An example that shares a run of 6 words with any real
  prompt is dropped, and a class must hold at least 3 of the gaps it was shown.
- **The decisions without embeddings.** The plan's centroid distance needed the
  KNN that P0 dropped. Instead: absorb = the teacher labels the proposal's
  examples under the current taxonomy and most land in one class; merge-to-make-room
  = the pair the two teacher passes disagree on most in the maintainer's
  reference set (at least 3 disagreements), the larger class surviving.
- **Tombstones**: `retired: [{id, mergedInto, version, test}]`. The validator
  requires every chain to end at a current class. rapid-llm-proxy counts the
  labels of every version of a taxonomy, each resolved to today's class
  (`resolveClass`, `versionTags`), in `summary` and live `coverage`.
- **Stability**: 40 reference prompts under the old and the new taxonomy,
  kappa ≥ 0.7 on the classes the fold did not touch, at least 10 compared;
  otherwise refused and nothing is written.
- `job-classes/folded.json` records every decision, absorbs and rejects
  included, so a proposal is folded once.

Gate: the forced cap overflow is a test (`tests/teams/job-classes-evolve.test.mjs`):
at maxClasses 3 a distinct proposal merges the most-confused pair, the
survivor's test is rewritten, the old label resolves to the survivor, and
the proxy counts the old version's labels under it.

Real run on team coding: the teacher proposed `investigate-discrepancy` from 34
gaps (one call earlier proposed nothing: the teacher is not deterministic);
the fold **absorbed** it into `fix` (its examples all landed there, matching v1's
"why did X go wrong is fix"). No new version.

Found on the way: the reference set's gaps include harness text (a skill's
loader text, "Base directory for this skill"), which the measurement's noise
filter misses. They are noise to the teacher, not prompts.

## Open questions (yours to decide)

1. **What is the class primarily for**: routing savings, or reporting plus trial
   evidence? For Claude Code users it can only be the latter, and that changes how
   much P4 is worth.
2. **Group = coding team?** This would reuse `teams.yaml` membership. The alternative
   is a separate group concept, for people who use glass and no coding.
3. **glass's role.** Today glass is read-only and ships no classifier service.
   Bootstrapping from glass means shipping the service (and MiniLM) in glass, which
   breaks its "no heavy deps" stance in `manifest.yaml`'s `forbidden` list.
4. **Maintainer model.** Single maintainer (simple, one writer), or every member's
   machine folding proposals deterministically? The second is possible but needs the
   dedup to be reproducible, and teacher LLM calls are not.
5. **Real exemplars on bmw.ghe.** Allowed opt-in, or synthetic-only everywhere for
   one rule instead of two?
