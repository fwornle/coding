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
| **P2 — shared repo, read side** | Package format + validator, `teams.yaml` binding, `job-classes init`, pull via `coding sync`, local KNN rebuild | Two machines resolve the same class for the same prompt |
| **P3 — contributions + dedup** | `proposals/`, maintainer fold with absorb/add/merge/stability check, versioned CHANGELOG, tombstones | A forced cap overflow merges correctly and keeps old rows resolvable |
| **P4 — per-class trials + evidence routing** | `jobClass` on trials; fg first-call sampling; `evidence/` publishing; evidence-derived band floor per member | One accepted class trial changes a routing decision on a second member's machine and is visible in `/resolve` |
| **P5 — glass** | glass reads the binding and shows classes, evidence and "by class" read-only. Whether glass gets `init` depends on question 3 below | — |

Touch points: coding (service, trainer, teacher, sync, teams, dashboard),
rapid-llm-proxy (`job_class` column, trial keying, class-aware band floor in
`offload.mjs`), glass (manifest additions, UI). Three new feature-flag mappings under
`classifier`/`llm-proxy` must be declared in the four places
`tests/features/*.test.mjs` checks.

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
