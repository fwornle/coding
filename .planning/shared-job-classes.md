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
| **P4 — per-class replay trials + evidence** | Whole-turn replays of sampled real turns in a sandbox, incumbent vs candidate, judged blind; `evidence/` in the team package; the class-aware floor for agents the proxy routes. Design below | Replays of one answer-only class reach a verdict, and the A/A noise floor is measured |
| **P5 — glass** | For machines without coding: opt-in live labelling with the user's Copilot account, the Classes tab, a team taxonomy from a git URL, and the measurement over the agents' own transcripts. Design below | Independent of coding's gate. Done when a glass-only user with labelling on sees the same class as coding for the same prompt and taxonomy, and with it off glass sends nothing new |

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
filter misses. They are noise to the teacher, not prompts. Fixed in fb36222f
(`lib/job-classes/noise.mjs`, used by the measurement and by `propose`).

## P5 — glass, for machines without coding (design, revised 2026-10-30)

The first version of this section (2026-10-28) put glass behind coding: it
waited for coding's gate, left the measurement out because it reads coding's
session logs, and made the team taxonomy "later". Most of the people this is
for will only ever run glass, so that design gave them nothing. Revised:

- **No dependency on coding's gate.** Labelling in shadow changes nothing; the
  gate only guards what may later act on a class. A glass user's gate is
  computed from their own teacher sample.
- **The model is the user's own Copilot account** (decided 2026-10-30), called
  with the token of the user's `gh` login for the host glass already uses for
  the quota (enterprise hosts first). The token is read from `gh` per use and
  never stored. A free plan may not offer the student model; the settings say
  so instead of failing quietly. Student `claude-haiku-5.5`, teacher
  `claude-sonnet-5`, as in coding. Off until the user switches it on.
- **The measurement runs in glass**: its prompts come from the agents' own
  transcripts (glass already reads them for tokens), not from coding's session
  logs. Corpus extraction is the only new part; noise filter, teacher passes,
  reference set and student score are coding's code, shared.

**What a glass-only machine gets:**

1. **Live labelling, opt-in** — Token Usage → Settings, with the "what leaves
   your machine" wording of offload. The daemon creates the tagger
   (`job-class.mjs`, shipped) and passes its hook to both forwards (Anthropic
   wire and OpenAI wire). Redacted before sending, with glass's patterns.
   Labels in glass's token DB.
2. **The read side** — the three `/api/job-classes` endpoints from shared proxy
   code, and the Classes tab (gate, tree, map, by class) in glass's tab list.
3. **Taxonomies** — the shipped default, or a team's: `glass job-classes join
   <git-url>` clones the team's learning repo (only its `job-classes/`) and
   labels every project with it; `glass job-classes pull` updates it.
4. **Measurement** — `glass job-classes measure`: teacher twice and the student
   once over the user's recent prompts from the transcripts, writing the
   reference set the coverage map reads.

Proposing and folding new classes stays with the taxonomy's maintainer (coding);
routing by class comes when glass routes at all.

**Checks:** the extract is closed and deny-clean on both targets; a daemon test
with labelling off makes no model call; one with a stub Copilot endpoint stores
a label row; the public tree carries no internal taxonomy or examples.

## P4 — per-class replay trials (design, 2026-10-28)

**Why not the live trials.** A live trial judges one call against one call. A
background process's call is its whole job; a human turn's first call is
usually a plan or a first tool call, and the job happens in the tool loop
after it. A cheaper first call that looks as good says little about the turn.
Decided (2026-10-28): **replay whole turns** in a sandbox (option b), for a few
high-volume classes. Reporting by class (the Classes tab) is the fallback for
the rest.

**Meanwhile, the P1 gate is fed faster:** `teacher_sample_pct` is 1.0 from
2026-10-28 for about two weeks (it was 0.3; about 13–30 labelled turns a day,
spread over 11 classes, would have taken months), then back to 0.3.

**The loop:**

1. **Capture at turn start.** A `UserPromptSubmit` hook records a light
   snapshot of the turn's repo: HEAD, a capped dirty patch and the list of
   untracked files (the `lib/repro/git-state.mjs` primitives, no KB, no env),
   keyed by the turn identity the proxy labels with. When the label arrives,
   retention keeps the snapshot only for a sampled turn of a target class; the
   rest are deleted within the day.
2. **Replay.** `lib/repro/restore-snapshot.mjs` builds an isolated worktree at
   the captured state. The session transcript is copied and cut just before the
   turn, and the agent resumes from the copy with the turn's prompt, headless,
   once with the **incumbent** model and once with the **candidate**. The
   sandbox denies outward actions (push, PR, merge, release, writes outside the
   worktree) and points the agent at a sandbox proxy data dir, as the
   experiment harness does.
3. **Judge.** The trials judge, blind and twice with the order swapped: the
   final answer (and, later, the diff) of incumbent vs candidate. The A/A floor
   is the incumbent's replay against what really happened in the turn, so
   replay noise is not mistaken for a worse model.
4. **Verdict.** The trials' rule (≥ 20 judged pairs, at least as good in
   ≥ 90 %), per class and candidate. An accepted verdict is written to the
   team package's `evidence/<class>.json` (model, agent, pairs, judge, date;
   no prompt text), proposed and folded like a class.
5. **Use.** For agents whose model the proxy routes (opencode, pi, copilot via
   offload), the evidence sets the class's lowest allowed band on that member's
   route. For Claude Code, whose main model the proxy does not choose, it is a
   recommendation in the Classes tab ("status turns: Haiku 5.5 was as good in
   23 of 24 replays").

**First slice: answer-only classes.** `status` and `explain` end in an answer,
not a change, so the outcome is the final text and the sandbox only needs the
repo at the turn's state. Classes that change things (`fix`, `build`,
`cleanup`) need the diff judged and a test signal, and `ship` / `run` act on
the outside world: later, if at all. `reply` is excluded, since its job is
whatever the previous turn proposed.

**Cost.** A replay is a whole agent turn, about 0.5–1 M cache-read tokens for a
status turn today; two replays per sample (incumbent and candidate), 20
samples per class and candidate. The replays are logged under their own
process (as `model-trial-shadow` is) so their cost is visible.

**Risks to settle in the spike:**
- Does a resumed, truncated transcript reproduce the turn's context closely
  enough? The A/A floor answers this; if the incumbent replay often disagrees
  with the real turn, the method fails and P4 stops at reporting.
- Live reads during a replay (a `curl` to a local service) see today's state,
  not the turn's. Answer-only classes are the most exposed to this, so the
  judge must be told that live figures may differ.
- Headless termination differs per agent (see the experiment harness notes);
  the spike uses Claude Code only.

## P4 spike results (2026-10-28)

Five real turns, two `explain` and three `status` (by the live labels), each
replayed twice from a cut copy of its Claude transcript in a worktree at the
commit of the turn's time: once with the incumbent (Opus 5.5, as in the real
turn) and once with Haiku 5.5. Read-only tools only, user settings (and so all
hooks) off, through the proxy. Judged by the trials judge route (Opus 5),
blind, twice with the order swapped.

**The mechanics work.** All ten replays finished (4–70 s each), resumed from
the cut transcript with 120–250 k tokens of context, and nothing escaped the
sandbox (coding, glass and the proxy checkouts unchanged). Replays of turns
that already had a label were skipped by the tagger (`seen`); the two older
turns were labelled again and those rows were deleted.

| Pair | as good in both readings |
|---|---|
| floor: real answer vs incumbent replay | 1 of 5 |
| trial: incumbent replay vs Haiku replay | 0 of 5 |
| direct: real answer vs Haiku replay | 0 of 5 |

**The floor fails, mostly for reasons of the instrument:**
- *Sandbox fidelity.* A `status` turn about files in the git-ignored `.data/`
  could not see them in a worktree; a turn that had run git was blocked by the
  read-only rule. The replay then answers a different question. Answer-only
  classes that look at local state cannot be replayed from a commit.
- *Judge position bias.* 7 of the 15 pairs split (one reading "better", the
  swapped one "worse"), almost always for whichever answer was shown second.
  Only consistent pairs carry a verdict.
- *Genuine variance.* On an advisory turn, the incumbent's own replay
  recommended a different repo layout and a different sharing rule than the
  real turn. An answer with no single right content has no stable reference.

**What the consistent verdicts say about Haiku:** on both `explain` turns it
gave the same core answer (same steps, same settings path) and was judged
worse in both readings for leaving out rationale, caveats and fallbacks. Under
the trials' rule ("at least as good") it fails; under a "same core answer, no
contradiction" rule it would pass. Which rule is right is a product decision,
not a measurement one. On the longest `status` turn it needed 18 agent turns
and about 2.5× the cache reads of the incumbent's 7, so a cheaper model per
token was not obviously cheaper per turn.

**Conclusion.** Whole-turn replay is cheap and safe to run, but as measured
here it cannot tell model quality from replay noise. Before more samples:
(1) restrict replays to turns whose inputs are all in the snapshot (`explain`
on code and docs, no live state, no ignored data), (2) a judge rubric for
"same core answer, no contradiction" plus completeness as a separate score,
and a judge checked for position bias on known-equal pairs, (3) then rerun the
floor; at ≥ 4 of 5 consistent "same" it is worth sampling 20 per class.
Otherwise P4 settles on option (c): reporting by class, routing only
background processes.

Spike scripts (not committed): `locate.mjs`, `replay.mjs`, `judge.mjs` in the
session scratchpad.

## P4 fixes and the second run (2026-10-29)

The four fixes from the spike, then the floor again.

1. **Turns whose inputs are all in the snapshot.** A scan of a month of this
   repo's Claude transcripts for question-like turns whose tool calls only read
   tracked files in the repo found **five**; almost every question touches live
   state (curl, gh, docker, env), the web, another repo or ignored data. The
   second run uses five such turns (install steps and update steps from the
   docs, two "what's next" from a plan, one features question from code).
   Replayable answer-only turns are rare in real use: at this rate a class
   gathers 20 samples in months, not weeks, for one member.
2. **Judge rubric.** "Which is better" is replaced by: *same core answer* (would
   a user act the same way or understand the same thing), *contradictions*
   that would change what they do, and *completeness* 1–5 per answer, scored
   apart and averaged over both orders so position cancels.
3. **Position bias, measured.** On ten paraphrase pairs and ten identical pairs
   the judge shows **no** position bias, under either rubric (old: 9 of 10
   "same" in both readings, no split; new: 20 of 20 core-equivalent, mean
   second-shown completeness bonus −0.05). The spike's splits were on answers
   that really differed.
4. **The floor again**, with a sandbox that holds. The first rerun still read
   today's state, two ways: the agent's own habit from the history
   (`cd <live repo>; …`, also in a redacted spelling of the path), and a git
   worktree, which shares the live repo's commits and refs (`git log main`
   showed the future). The replay now runs in a standalone shallow repo fetched
   at the turn's commit, with every spelling of the repo path in the cut
   transcript rewritten to it, under `sandbox-exec` denying reads of
   `~/Agentic`, `~/.coding` and `~/.specstory`.

| Pair (5 turns) | same core, both readings | and no contradiction |
|---|---|---|
| incumbent replay vs incumbent replay (A/A) | 5 | 3 |
| real turn vs incumbent replay (two runs) | 4 and 4 | 3 and 1 |
| incumbent replay vs Haiku replay | 2 | 1 |
| real turn vs Haiku replay | 2 | 1 |

**Reading it.** On "same core answer" the floor passes (4 of 5 against the real
turn, 5 of 5 replay against replay); the one miss is a turn whose answer
depended on a PR's live status. "No contradiction at all" is too strict: the
same model on the same snapshot disagrees with itself on side points (is a
file dead code, does an update restart a daemon). The verdict should be the
core, with contradictions listed for a reader rather than counted.

**Haiku** gave the same core answer in 2 of 5 (the two lookups from a doc) and
a different one on the analytical turns and the update steps, with less
detail (completeness −1.1 against the replay, −2.0 against the real turn). It
used about as many tokens per turn as the incumbent (0.27–0.9 M per replay).
On this evidence, Haiku is not as good for answer turns that need analysis;
for a lookup it may be.

**What P4 needs beyond this:**
- Replay traffic must be marked so the tagger skips it: rewriting paths gave
  each replay a new conversation key and six replay turns were labelled (the
  rows were deleted).
- The `UserPromptSubmit` capture, so a turn's untracked inputs are in the
  snapshot; without it, only turns over tracked files qualify, and they are
  rare.
- Volume: sampling per class across a team, not one member, or the 20-pair
  verdict never arrives.

Spike scripts (not committed): `scan.mjs`, `replay.mjs` (shallow repo,
path rewrite, sandbox profile `replay.sb`), `judge2.mjs` in the session
scratchpad.

## P4 build: on the existing isolation code, not beside it (2026-10-29)

The spike re-discovered, by trial and error, controls that kgbench and the
`/experiment` harness already have and document
(`docs-content/_tiers/measurement/kgbench-experimental-design.deep.md`). The
P4 replay is built on them; only what is specific to replaying a past turn is
new.

**Reused as is:**

| Need | Existing code |
|---|---|
| Agent env: keys stripped, proxy pinned, knowledge injection off, inherited agent config dropped | `agentEnv()`, `assertProxyReachable()` (`lib/kgbench/runner.mjs`) |
| Outcomes that cannot rank: timeout, no result, escape, starved host | `OUTCOMES` incl. `tool_escape`, `host_stalled` (same file) |
| Audit what executed, not what was attempted; an unknown call counts as executed | the kgbench tool audit (`toolViolations`, `mergeToolTraces`) |
| Capture at turn start: HEAD, dirty patch, untracked files | `lib/repro/capture-snapshot.mjs`, `git-state.mjs` |
| Restore into a sandbox, `PWD` pinned, `OLDPWD` dropped | `lib/repro/restore-snapshot.mjs`, the experiment runner's cell env |
| Proof that incumbent and candidate replays start identically | `digestRestoredState()`, `assertRepeatsIdentical()` (`lib/experiments/experiment-restore.mjs`) |
| Record the served model, not the requested one | the kgbench judge's provenance rule |

**Changed for replays,** because the threat is different. kgbench hides an
answer key and equalises context across arms; a replay must hide *the future*
and *reproduce* the turn's context.
- *No git worktree.* A worktree shares the live repo's objects and refs, so
  `git log main` or `git show main:<file>` shows what happened after the turn.
  The snapshot is a standalone shallow fetch at the turn's commit, plus the
  captured dirty patch and untracked files.
- *Rewrite paths, do not strip inputs.* `neutralizeSandboxRules` and
  `neutralizeSandboxKnowledge` delete `CLAUDE.md`, `.planning/` and the like;
  for a replay those are the turn's inputs ("remove the answer key, never the
  answers"). The cut transcript and the rule files get every spelling of the
  live repo path (absolute, redacted, `~`) rewritten to the snapshot instead.
- *An OS sandbox under the permission rules.* `sandbox-exec` denying reads of
  the live repos and data dirs held where permission patterns failed (a prefix
  rule matches at a word boundary only). The tool audit stays as the record.
- *Knowledge injection off, as a recorded parity gap.* The real turn got that
  day's knowledge digests; today's would hand the replay the future. The
  replay runs without, and the report says so.

**New code, small:** the transcript cut and path rewrite; a pre-run
"no future" check (no commit after the turn's time reachable in the snapshot,
no line after the cut in the transcript copy; refuse to run otherwise, as
kgbench refuses a leaked tree); a replay marker the job-class tagger skips
(replays were labelled as new turns: the self-reinforcing channel kgbench
documents); the "same core answer" judge with completeness scored apart.

**Found on the way, for kgbench itself:**
- Its run tree is a git worktree too, and its leak scan skips `.git`. From
  inside a tree, `git show HEAD:config/kgbench/questions/coding-v1.json`
  returns the whole answer key the sandbox removed (probe, 2026-10-29). Claude
  arms cannot run git (`Glob`/`Grep`/`Read`); copilot (`--allow-all-tools`,
  built-ins not gated, no tool trace), opencode and pi have a shell. The
  scoring backstop catches an answer that *cites* the ground truth, not one
  that used it silently. Fix: a tree without the live `.git` (an export of the
  commit, or a standalone shallow fetch).
- kgbench refuses to build a run tree today: the leak scan finds a question's
  prompt verbatim in `tests/fixtures/prompt-classifier-labels.json`, a fixture
  added after the last run. The guard works; the exclude list needs the file.

## Taxonomy v2: the run/status line (2026-10-29)

The live P1 gate fills slowly (a few teacher-checked turns a day), so the next
gain came from the offline sets instead. A per-class breakdown of Haiku against
the teacher on the dev set showed that the confusions named in the P0 results
were not the large ones. The weakest class was **run** (half its prompts went to
status or ship), then configure (few prompts, mostly mixed requests).

The cause was the taxonomy's own wording: run said "verify end to end" and
status said "check / look at". "Check that it shows up now" was both. v2 draws
the line by what finding out takes:

- trying the thing (use the feature, render the page, re-run the check) is **run**;
- reading what is already recorded (a log, a release, a diff) is **status**;
- pulling, syncing or upgrading a local copy is run, not ship;
- pointing the agent at something to study ("look into X") is explain.

The examples added for this are written for the file, not taken from the dev set.

The measurement also stopped scoring harness noise. The dev and test sets were
sampled before `lib/job-classes/noise.mjs` existed and still held skill
expansions and bash-mode lines (about one prompt in twenty-five). They are still
labelled, so the checkpoints stay valid, but are left out of every score.

| | v1 dev | v2 dev | v1 test | v2 test |
|---|---|---|---|---|
| teacher pass 1 vs 2 | 0.920 | 0.956 | 0.937 | 0.960 |
| claude-haiku-5.5 (kappa) | 0.781 | 0.793 | 0.770 | 0.833 |
| claude-haiku-5.5 (agree) | 81% | 82% | 80% | 86% |

v1 is shown re-scored without the noise. Run went from 50% to 88% on dev. The
test set, which nobody read while tuning, gained more than the dev set, so the
edit generalises rather than fitting the prompts it was tuned on. What remains
on dev: build↔docs and build↔cleanup on short follow-ups ("do the other ones
too"), which need the conversation rather than the prompt.

`config/job-classes.yaml` is only the default taxonomy, for projects in no team.
coding's projects are bound to the coding team's package (P2), which still held
the v1 wording, so the live labels of 2026-10-29 were all `job-classes-coding-v1`.
The package took the same wording as its v2 on 2026-10-30 (only its `name`
differs, so it was not measured again). The live tagger reads both files by
mtime. Labels made under v1 stay readable under their own tag. The P1 gate
counts `job-classes-coding-v2` labels from 2026-10-30.

## The P1 gate, made concrete (2026-10-30)

The plan named the gate "per-class precision" without a number. It is now
the band classifier's: a class passes when the teacher agrees with at least
90% of the student's labels for it, over at least 20 teacher-checked turns.
It is counted over every label made under one taxonomy version, so a new
version starts from zero. "none" has no gate. Token Usage → Classes shows
the gate per class (`GateProgress.tsx`).

Two things keep the count clean:
- the tagger skips automated runs (rapid-llm-proxy PR #75): a task-bound
  request, or Claude Code's headless entrypoint (`sdk-cli`), which is how
  replays and tool probes arrive;
- the teacher checks every turn (`teacher_sample_pct: 1.0`, PR #74) until each
  class has a verdict.

At about 15 to 30 labelled turns a day, the common classes (fix, ship, status,
build) reach 20 checks in one to two weeks. The rare ones (relay, configure,
reply) take longer, and a class that never collects 20 drives nothing.

## Open questions (yours to decide)

1. **What is the class primarily for**: routing savings, or reporting plus trial
   evidence? For Claude Code users it can only be the latter, and that changes how
   much P4 is worth.
2. **Group = coding team?** This would reuse `teams.yaml` membership. The alternative
   is a separate group concept, for people who use glass and no coding.
3. **glass's role.** Proposed in P5 (2026-10-28): opt-in live labelling and a read-only
   team taxonomy (P5); no `init`, `propose` or `fold` in glass. The MiniLM
   concern is gone, since P0 dropped the KNN model.
4. **Maintainer model.** Single maintainer (simple, one writer), or every member's
   machine folding proposals deterministically? The second is possible but needs the
   dedup to be reproducible, and teacher LLM calls are not.
5. **Real exemplars on bmw.ghe.** Allowed opt-in, or synthetic-only everywhere for
   one rule instead of two?
