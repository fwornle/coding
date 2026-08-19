# Resume: work blocked on the copilot quota

> **RESOLVED 2026-08-19.** The quota is back and the work this file was holding is done.
> Kept because §1 (the gate), §3 and §4 remain true and useful, and because two of its
> conclusions turned out to be WRONG in a way worth recording — see "What resuming found".
>
> | § | was | now |
> |---|---|---|
> | 0 | quota blocked everything | **open** — copilot serves tools-bearing requests; judge is on `gh-copilot/claude-sonnet-5` |
> | 2.1 | tool telemetry missing | **done, then twice fixed in production** — see 2.1 |
> | 2.2 | opencode hang, cause unknown | **root-caused** — inherited **stdin**, NOT the quota. The harness was never affected |
> | 2.4 | `COPILOT_MODEL` untested | still untested |
> | 2.5 | `enableFileHooks` rejected | **still reproduces** on copilot 1.0.80 |
> | 2.3, 2.6, 2.7, 2.8 | open | still open |
> | **2.9 (new)** | — | **the `replication` set is unanswerable** — its subject code is in a submodule the sandbox cannot see |
> | **2.10 (new)** | — | **the exclude list mirrored `docs/`→`docs-content/` only for measurement docs** — fixed |
>
> **A benchmark ran end to end and is published**: `docs/benchmarks/coding-v1/RESULTS.md`
> (128 cells, 4 arms × 3 agents, corpus `7924e45bd`). Commits `7924e45bd` `ad89caf88`
> `0c5abdf15` `d55a76cf3` `819bb6ec6`.

## What resuming found

**The quota was never opencode's problem.** §2.2 attributed the hang to the quota gate and
listed nine eliminated causes. The real cause is none of them: `opencode run` blocks on
**inherited stdin**. With stdin left attached it hangs forever and writes zero bytes; with
stdin closed it succeeds in seconds.

```bash
opencode run 'say ok' -m rapid-proxy/claude-sonnet-5 --dangerously-skip-permissions
#   -> hangs until killed, 0 bytes                      (exit 124)
opencode run 'say ok' -m rapid-proxy/claude-sonnet-5 --dangerously-skip-permissions < /dev/null
#   -> "ok"                                             (exit 0)
```

It reproduces with **no flags at all** (`opencode run 'say ok'`), on the direct
`github-copilot/*` leg as well as the proxy leg, and with `mcp: {}`. So it is not the
proxy, not the model, not MCP, and not the quota. `opencode models` works throughout,
which is why the binary looked healthy.

**Why this cost two sessions:** every reproduction was a manual CLI probe from an
interactive shell, which inherits stdin. The kgbench harness spawns with
`stdio: ['ignore', 'pipe', 'pipe']` (`runner.mjs:337`) — stdin already `/dev/null` — so
the harness path never had this bug. The sessions were diagnosing an artefact of the probe
method and attributing it to the system under test. **A manual CLI reproduction of a
harness spawn must close stdin**, exactly as §1's trap says a curl reproduction of an
agent call must include `tools[]`. Same class of error, different tool.

---

## 0. First: confirm the quota is actually back

Two probes. Both must pass; the first alone is not sufficient.

```bash
# (a) the CLI — look for statusCode / quota in model.call_failure
copilot -p "say ok" --output-format json 2>&1 | grep -oE "quota_exceeded|402|call_failure"
#   expect: NO output.  Any hit means still blocked.

# (b) the proxy, tools-bearing — this is the one that matters for agents
TOOLS='[{"type":"function","function":{"name":"read_file","description":"Read",
  "parameters":{"type":"object","properties":{"path":{"type":"string"}}}}}]'
curl -s -X POST http://localhost:12435/v1/chat/completions \
  -H 'Content-Type: application/json' -H 'x-agent: opencode' \
  -H 'Authorization: Bearer rapid-proxy-no-auth-placeholder' \
  -d "{\"model\":\"claude-sonnet-5\",\"tools\":$TOOLS,
       \"messages\":[{\"role\":\"user\",\"content\":\"hi\"}]}"
#   blocked → {"error":"QUOTA_EXHAUSTED: ...","type":"QUOTA_EXHAUSTED"}
#   back    → a normal chat.completion body
```

Also worth checking the judge route, which fails *silently* rather than loudly:

```bash
curl -s -X POST http://localhost:12435/api/complete -H 'Content-Type: application/json' \
  -d '{"process":"kgbench-judge","messages":[{"role":"user","content":"say ok"}]}'
```

`"fallbackFrom":"copilot"` with `provider: claude-code, model: claude-haiku-*` means the
judge has been downgraded without erroring. **Do not grade a benchmark in that state** —
a haiku-graded column is not comparable to a sonnet-graded one. Run `--no-judge` instead.

---

## 1. The gate — why one quota blocks everything

`proxy-bridge/server.mjs` (~line 3105), Phase 82-03 tool-capability gating:

```js
const PROVIDER_FUNCTION_CALLING = { copilot: true };
```

**copilot is the only tool-capable provider.** claude-code is spawned with `--tools ''`
and cannot serve tool calls, so any request carrying `tools[]` has its provider chain
reduced to copilot alone. Agents always send tools. Therefore:

- every agent request goes to copilot, whatever the routing says;
- **repointing the `opencode` processOverride at claude-code is a no-op.** The log shows
  `prefer claude-code` and then `provider chain [opencode, public]: [copilot]` — the gate
  drops the tool-incapable provider. This was tried and confirmed;
- non-agent traffic (plain completions, no `tools[]`) still falls back to claude-code and
  works fine, which is why the system looks half-healthy.

**Single-variable proof** — same model, same route, same `x-agent` header:

| request | result |
|---|---|
| with `tools[]` | instant `QUOTA_EXHAUSTED` |
| without `tools[]` | 200 via claude-code fallback, ~1s |

> **Trap that cost two sessions:** a curl reproduction that omits `tools[]` is NOT
> equivalent to an agent call. It succeeds, which makes the agent's failure look like an
> independent agent-side bug. It is not one. Always include `tools[]`.

**Standing design question** (not urgent, but this is a single point of failure for all
agent traffic): should a second provider be made tool-capable, or should claude-code stop
being spawned with `--tools ''`? Right now one exhausted quota stops every agent.

---

## 2. Open points

### 2.1 Tool telemetry for copilot and opencode — DONE, after two production fixes (2026-08-19)

> **Shipped, then found broken twice by running it.** The unit tests passed at every stage;
> both defects were only visible in real cells. Recording the sequence because the SHAPE of
> the mistake repeated, and it is the kind that survives a green test suite:
>
> 1. `toolTraceFrom()` for copilot and opencode + `--output-format json` on copilot's argv
>    (commit in the telemetry merge). Correct as far as it went.
> 2. **Undercount #1 — the merge.** `runWithContinuations` returns `{...last}`, so a
>    continued cell reported its LAST leg only. `wall_s` was already summed across legs for
>    exactly this reason and the code says so; the trace was added with the same defect.
>    Fixed by `mergeToolTraces()` (`0c5abdf15`), the counterpart of `spanOfParts()`.
> 3. **Undercount #2 — nothing to merge.** The re-run staged to PROVE fix 2 still reported
>    1.0 tool calls/cell. `readAnswerFile`'s `no_result` branch returned no tool fields at
>    all, so the investigating leg had `tools_executed: undefined`, the merge filtered it
>    out, and summed the recovery leg alone. Fixed by `d55a76cf3`.
>
> **Why the tests kept passing.** Step 2's tests exercised `mergeToolTraces()` on
> hand-built legs — and a unit test of a merge cannot catch a leg that never carries
> anything to merge. The stubs had the fields the real legs lacked, so the test encoded the
> assumption instead of checking it. The tests added in step 3 drive the REAL spawn path
> (`runAgent` → `readAnswerFile`) with a stub adapter that emits a real-shaped event stream
> and, like the real CLI, does not write the answer file.
>
> **Scale of what was wrong**, same 16 questions, same pinned corpus:
>
> | | broken | fixed |
> |---|--:|--:|
> | grep/opencode tool calls | 20 | **66** |
> | grep/opencode content tokens | 678 | **129,717** |
> | tool mix | `write 16, read 2, grep 1, bash 1` | `bash 40, write 16, read 7, grep 2` |
>
> Both numbers were wrong in the same direction — they made opencode look nearly free. It
> is in fact the second most expensive configuration measured, after graphify. **Four
> separate claims made from this instrument during the session had to be retracted**, every
> one flattering opencode. If you extend it to `pi`, assume the same bias until a real cell
> disproves it.
>
> **What is NOT measured, and why the audit state is three-valued.** `tool_audit` is
> `observed` for copilot and opencode, not `audited`. Their tool names are their own
> (`view`/`create`, `read`/`write`, `bash`) and arms are written in claude's vocabulary, so
> feeding `tools_executed` to `toolViolations()` marks EVERY such cell `tool_escape` —
> verified, not assumed: it returns `[view, create, task_complete]` and `[read, write]` on
> real traces. The production run then justified this concretely: opencode runs `bash`
> inside a `grep` arm, which is expected capability on an ungated agent, not a violation.
>
> `task_complete` is copilot's autopilot sentinel, counted but reported separately as
> `tool_control_calls`; claude has no equivalent, so subtract it before comparing tool
> counts across agents.

<details><summary>Original text (what was open)</summary>


> Implemented. `lib/kgbench/agents.mjs` gained `toolTraceFrom()` on the copilot and opencode
> adapters plus `--output-format json` on copilot's argv; `readAnswerFile()` takes a
> `toolTrace` and the runner's audit block gained a third state. Event names were captured
> from real runs, and the fixtures under `tests/fixtures/kgbench/` are those streams trimmed
> to the events the parsers read — so a CLI changing shape breaks a test rather than
> silently zeroing a column. 22 tests in `tests/integration/kgbench-tool-telemetry.test.js`;
> the kgbench suite is 265/265.
>
> **Observed vocabularies** — copilot `view`, `create`, `bash`, `task_complete`; opencode
> `read`, `write`, `bash`, `grep`, `glob`.
>
> **`tool_audit` now has THREE states, and the third is the point.** Wiring the trace
> straight into the existing check marks EVERY copilot and opencode cell `tool_escape`,
> because not one of those names appears in any arm's `allowedTools` — arms are written in
> claude's vocabulary. That would have read as a finding ("non-claude agents escape their
> arm constantly") and been an artefact of naming alone. So:
>
> - `unavailable` — no trace (pi, or a stream with no events)
> - `observed` — trace exists, but names are the agent's own, so arm conformance is **not
>   decidable**; what ran is recorded, no verdict is claimed
> - `audited` — trace exists AND names are the arm's, so conformance is decided (claude)
>
> This is the same principle as the "do not guess event names" warning below: an unverified
> mapping presents an unchecked cell as a checked one. Establishing the copilot name mapping
> empirically (§ enforcement note in `agents.mjs`) would promote copilot to `audited`.
>
> **`task_complete` is reported separately** as `tool_control_calls`. It is copilot's
> autopilot sentinel; claude has no equivalent, so counting it plainly makes every copilot
> cell read one tool busier than a comparable claude cell — and this benchmark compares tool
> counts.



`tools_executed`, `tool_calls` and `tool_audit` are `null` for these two agents, so their
cells are unauditable. `runner.mjs:827` sets `tool_audit = 'unavailable'` when
`tools_executed == null`, and `agents.mjs:~89` records why: the answer-file elicitation
these CLIs need produces no tool trace.

Steps, in order:

1. Get **one successful cell from each agent**. Nothing below can be done without it.
2. Capture the real event shapes:
   - **copilot** `--output-format json` — JSONL, envelope
     `{type, data, ephemeral, id, timestamp, parentId}`. Observed types so far include
     `session.mcp_servers_loaded`, `session.mcp_server_status_changed`,
     `mcp.tools.list_changed`. Tool *execution* types have not been observed, because that
     needs a completion that runs tools.
   - **opencode** `--format json`.
3. Implement `toolTraceFrom()` per adapter in `lib/kgbench/agents.mjs`, and wire it into
   `readAnswerFile()` (`lib/kgbench/runner.mjs:551`).

> **Do not guess event names.** The harness's own comment at `agents.mjs:~89` warns that
> claiming an audit that cannot be performed is worse than claiming none. An unverified
> name mapping presents an unchecked cell as a checked one.

Note: the harness **does not currently pass `--output-format json` to copilot** — its argv
is `-p / --allow-all-tools / --no-ask-user / --model` (`agents.mjs:142-145`). opencode
already runs with `--format json`, but only the session id is parsed out of it
(`agents.mjs:160`).

</details>

### 2.2 opencode end-to-end — ROOT-CAUSED (2026-08-19)

> **Cause: inherited stdin.** Not the quota, and not any of the nine causes eliminated
> below. See "What resuming found" at the top for the reproduction. A full opencode run now
> completes end-to-end: reads a file, writes the answer file, exits 0, emits a parseable
> `--format json` stream. The harness spawns with stdin already closed, so kgbench itself
> was never affected.
>
> Add to the eliminated list, now tested: `mcp: {}` (hangs identically), the direct
> `github-copilot/*` leg (hangs identically), no-flags invocation (hangs identically).

<details><summary>Original text (what was believed)</summary>


Its default model was changed to `rapid-proxy/claude-sonnet-5` in
`~/.config/opencode/opencode.json`. Verified: valid JSON, MCP servers/providers intact,
`opencode models` lists it, and the name returns `QUOTA_EXHAUSTED` rather than `400 not
supported`. To revert, set that one `"model"` key back to `rapid-proxy/claude-opus-4.8` —
though note §2.3, which is why it was changed. (That file is not version-controlled and
holds live API keys, so no copy of it is kept here.)

**Not verified: a complete opencode run.** That needs the quota. Use an EXECUTION-shaped
goal — headless `opencode run` ends at the first toolless step, so "explain X" yields
narration and exits. A goal that must write a file works.

Symptom to expect if something is still wrong: opencode prints only its
`> build · <model>` banner and hangs until killed (zero bytes under `--format json`); its
own log at `~/.local/share/opencode/log/` stops after `service=vcs … initialized` and
never logs an error. It swallows `QUOTA_EXHAUSTED` rather than surfacing it.

Already eliminated as causes, each by direct test — do not re-test these: proxy down,
proxy hang, proxy streaming, model name, our two custom plugins (`compaction-guard.js`,
`knowledge-injection.js` — hangs with both moved aside), `--format json`,
`--dangerously-skip-permissions`, MCP config, needing a git repo.

</details>

### 2.3 Opus is not reachable by opencode through the proxy

Of the 9 models declared in opencode's config, the copilot leg accepts 5 and rejects 4
with an instant `400 The requested model is not supported`:

| accepted | rejected |
|---|---|
| claude-sonnet-5, claude-sonnet-4.6, claude-haiku-4.5, gpt-4o, gpt-4o-mini | claude-opus-4.8, claude-opus-4.6, claude-opus-4.5, claude-sonnet-4.5 |

The 400 comes from the Copilot API itself. `opencode models` does list
`github-copilot/claude-opus-4.8`, but that is opencode's direct BYOK path, not the proxy
leg — the two catalogues genuinely differ.

Consequence: `lib/experiments/model-resolve.mjs:75` maps any canonical ref to
`rapid-proxy/<dotted>`, so **any experiment or kgbench cell requesting an opus model for
opencode will 400**. It hardcodes nothing and is not itself wrong. Decide which:
extend the proxy's copilot catalogue, or have the harness refuse/substitute opus for
opencode. Also consider pruning the 4 unusable entries from the opencode config so the
failure surfaces at selection rather than at call time.

### 2.4 `COPILOT_MODEL` default — untested

`scripts/launch-agent-common.sh:510` defaults `COPILOT_MODEL` to `claude-opus-4.8`. That
is the copilot CLI's own BYOK path rather than the proxy leg, so it may be entirely fine —
but it is the same string the proxy leg rejects, so it is worth one probe once quota is
back. Not changed on a guess.

### 2.5 copilot 1.0.80 rejects `enableFileHooks` — STILL REPRODUCES (re-checked 2026-08-19)

> Unchanged. Every `copilot` invocation this session opened with:
> `Warning: Ignoring unknown top-level key(s) in user settings file
> "/Users/Q284340/.copilot/settings.json": "enableFileHooks"`. Still its own investigation,
> and still a silent confound for any KB-on/KB-off arm run on copilot.


`copilot` warns: *Ignoring unknown top-level key(s) in user settings file
`~/.copilot/settings.json`: "enableFileHooks"*. The key is present and `true`. This likely
makes the copilot KB-injection hook config inert. Injection is version-adaptive
(`postToolUse` ≤1.0.71 / `userPromptSubmitted` 1.0.72+ per
`reference_copilot_filesystem_hooks_no_injection`); the installed CLI is 1.0.80 and no
longer recognises the enabling key at all. Needs its own investigation — it silently
disables KB injection for copilot, which would confound any KB-on/KB-off experiment arm.

### 2.6 Secrets in the opencode config

`~/.config/opencode/opencode.json` embeds live `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`,
`GROQ_API_KEY` and `GROK_API_KEY` in its `mcp.*.environment` blocks. Beyond plaintext
storage, handing `ANTHROPIC_API_KEY` to those MCP servers is the proxy-bypass pattern
`reference_headless_agent_proxy_bypass` warns about — they can egress directly, outside
the proxy and outside Max. Rotate and move to a secret store.

### 2.7 Description A/B follow-up

The tool-description A/B is complete and reported. The one arm that would separate
*description quality* from *tool identity* in the intra-category shift has not been run: a
**swap** — Graphify aggressive, CodeGraph terse — not another additive arm. See
`docs/benchmarks/coding-v1/tool-selection.md`.

### 2.8 Residual from the vkb-server OOM fix

`auto-measure-foreground` (launchd, 120s) persists on every cycle whether or not it wrote
anything, so the experiment store sawtooths between a ~1 MB floor and ~10 MB. Bounded and
harmless at this size — compaction keeps pace. A dirty-flag in `close()` would remove the
churn but changes persistence semantics for every km-core consumer, so it was deliberately
not done. Revisit only if the floor starts climbing.

---

### 2.9 The `replication` question set is UNANSWERABLE in the sandbox — NEW, not fixed

`kgbench-run.mjs` defaults to `--set replication` (`opt('set', 'replication')`), and that set
cannot be answered in the run tree. Its subject code lives in the `graphify` git submodule,
and `git worktree add` — how `createRunTree` builds the sandbox — does not populate
submodules. A fresh worktree has **0 entries** in `integrations/graphify`,
`integrations/mcp-server-semantic-analysis` and `lib/km-core`.

L1 asks which file defines `_corpus_signature`. It is at
`integrations/graphify/graphify/detect.py:1252` in the live repo and appears NOWHERE in the
sandbox. A pilot cell confirms the shape: the grep arm answered *"No matches for
`_corpus_signature` anywhere in this repository"* and scored 0. That is the correct answer to
the question it was actually able to ask.

**The ugly part, and the reason this was invisible until now.** Before the exclusion added in
`7924e45bd`, `docs/benchmarks/graphify-vs-grep/` was IN the tree — carrying both the prompts
(`queries.json`) and 54 rows of `{id, answer, score}` (`results.jsonl`). An arm grepping for
`_corpus_signature` found the answer key and scored well. **The set's apparent runnability
depended on the contamination.** Fixing the leak is what made the submodule gap visible.

Not fixed because the choice is a real one and not the fixer's to make:

- populate submodules per run tree (`git submodule update --init` in the worktree) — slow,
  and it changes what every prior run searched, so old runs stop being comparable;
- retarget the replication questions at non-submodule code — cheapest, loses the point of the
  set, which was to replicate the ancestor benchmark;
- retire the set in favour of `coding-v1`, whose only submodule question (T2) is already
  disabled, and which ran 128/128 cleanly.

Until then: **do not run the bare default.** `kgbench-run.mjs` with no `--set` produces zeros
that say nothing about retrieval arms. Pass `--set coding-v1`.

### 2.10 The exclude list mirrored `docs/` → `docs-content/` for measurement docs only — FIXED

mkdocs builds from `docs-content/` (`docs_dir: docs-content`), so every published benchmark
doc exists TWICE. `DEFAULT_EXCLUDES` had the mirror-pair discipline for measurement docs —
`docs/measurement/kgbench*.md` AND `docs-content/measurement/kgbench*.md` — and it was never
extended to `benchmarks/`. So excluding `docs/benchmarks/coding-v1` removed half a leak and
the run still refused on `term:T3` in
`docs-content/benchmarks/coding-v1/analysis/tool-selection-data.md`.

Fixed in `ad89caf88`, both mirrors listed. **When you add a benchmark exclusion, add its
mirror in the same commit** — and note the containment error prints only `leaks.slice(0, 6)`,
so fixing whichever file it happens to name walks you through them one 1-minute tree build at
a time. Enumerate them all first with the harness's own scanner:

```js
import { scanTreeForLeaks, classifyLeaks } from './lib/kgbench/sandbox.mjs';
classifyLeaks(scanTreeForLeaks(dir, questions), questions);   // needs qs.questions, not qs
```

Do NOT glob `docs/benchmarks/**` — `docs/benchmarks/kgbench-replication/README.md` is A2's
ground truth and a glob makes A2 unanswerable, scoring every arm 0 on it.

## 3. Already done — do not redo

- **vkb-server OOM crash-loop**: root-caused and fixed. A polled read path was rewriting
  the whole graph on every request; `persistOnClose` now lets read-only opens skip it. The
  store was rebuilt 4.6 GB → 1.1 MB and the bloated copy deleted. Verified: 0 growth over
  20 GETs, no kills across 26 minutes.
- **kgbench launcher question count**: `/api/kgbench/config` filters `enabled !== false`,
  so coding-v1 reports 16 rather than offering retired T2.
- **CLAUDE.md km-core claims**: corrected — `lib/km-core/dist/` is gitignored, and a new
  mandatory rule records that request-scoped reads must open `readOnly`.
- **`/api/kgbench/question-sets`**: not a bug. The route does not exist, so vkb's SPA
  catch-all answers `200 text/html` and the proxy mislabels the parse failure as
  "unreachable". The launcher never calls it — it uses `/api/kgbench/config`.
- **coding-v1 ran end to end and is published** (2026-08-19): 128 cells, 4 arms × 3 agents,
  corpus `7924e45bd`, at `docs/benchmarks/coding-v1/RESULTS.md`. `docs-content/.../RESULTS.md`
  is a SYMLINK to it, so publishing to `docs/` updates the mkdocs mirror automatically —
  do not copy it. `README.md` in that directory is hand-written and the generator refuses to
  overwrite it; **`RESULTS.md` is the generated target**.
- **A report can now declare a merged run.** Its rows came from two runs (claude+copilot from
  `kgv1-telemetry`, opencode from `kgv1-opencode-fixed`). Rows carry arm, agent and task_id
  but not which RUN wrote them, so the merge would otherwise be invisible. Declare
  `merged_from` in the run's own `run.json` and it renders into Measurement provenance —
  in run.json rather than a CLI flag, so regenerating reproduces the block instead of losing
  it. Only pool runs that match on corpus, question set, reps, continuation budget, judge and
  model; all six were checked before merging.
- **The retrieval result, for anyone who just wants the answer.** On coding-v1 at 1 rep,
  correctness across arms is a TIE by the report's own bar (≥1.25× median gap, non-overlapping
  IQR). What separates them is cost: `codegraph 75k ≈ grep 79k ≈ hybrid 82k` content tokens
  vs **`graphify 218k`** — 2.75× for no measurable accuracy gain. Agents prefer grep; nothing
  here says they are wrong to. Do not quote the score differences as findings at n=16.

## 4. Diagnostic traps worth remembering

- **A manual CLI reproduction of a harness spawn must close stdin.** The harness spawns with
  `stdio: ['ignore', …]`; an interactive shell does not. `opencode run` hangs forever on
  inherited stdin, which cost two sessions of diagnosing a probe artefact as a system defect.
  Sibling of the `tools[]` trap in §1 — same class, different tool.
- **A green unit test can hide a broken path when the stubs supply what the real objects
  lack.** `mergeToolTraces()` was tested on hand-built legs that had `tools_executed`; the
  real `no_result` leg did not, so the merge silently dropped it and the fix was a no-op.
  A unit test of a merge cannot catch a leg that never carries anything to merge. When a fix
  targets a defect seen in PRODUCTION data, the test must drive the production path.
- **Suspect a new instrument before believing its striking number.** Every surprising figure
  this session came from telemetry written the same day, and each was wrong in the same
  direction (opencode looks cheap). The tell was an impossible combination — exact file
  paths and line numbers from a cell that recorded one tool call and no search.
- **`file`/`grep` call `lib/kgbench/sandbox.mjs` binary.** It contains 2 deliberate NUL bytes,
  a sentinel in its two-pass `**`→`*` glob translation. Use `grep -a`. Not corruption.

- A curl reproduction of an agent call **must include `tools[]`** (§1).
- **`docker stats` lies** about short allocation spikes — it sampled 280 MB against a 4 GiB
  limit while the process was being OOM-killed. Use `/sys/fs/cgroup/memory.events`
  (`oom_kill`) and `memory.peak`.
- The km-core log line `LEVEL_NOT_FOUND, hydrated from JSON: N nodes` is **misleading
  wording, not an error** — it sits inside `hydrateFromJsonExports`, which runs on every
  open. Absence of the `preferring JSON` line means the LevelDB state won.
- `gsd-browser` fights a running Chrome. Clearing `Singleton*` in its
  `chromiumoxide-runner` profile dir is the documented fix; `pkill -f "Google Chrome
  Helper"` is **too broad** and will kill tabs in the real browser.
