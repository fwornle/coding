---
phase: 88-experiment-harness-agent-invocation-alignment-and-pre-flight
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - lib/experiments/agent-routing.mjs
  - lib/experiments/experiment-runner.mjs
  - lib/experiments/agent-headless.mjs
  - scripts/launch-agent-common.sh
  - config/experiments/compare-avenues-help-v1.yaml
  - config/experiments/compare-fizzbuzz.yaml
  - tests/experiments/agent-routing.test.mjs
autonomous: true
requirements: [ALIGN-01]
must_haves:
  truths:
    - "An opencode experiment cell resolves its model to an id that appears in the live `opencode models` catalog (the dogfood 'Model not found: rapid-proxy/claude-haiku-4-5' was a dash-vs-dot typo, not a phantom provider)"
    - "A copilot experiment cell resolves 'auto' to the same catalog default the interactive measured path uses (no 500 from an unknown model — verified live: model 'auto' → HTTP 500 'model is not supported')"
    - "Cell model resolution and the interactive-shell model defaults read from ONE source of truth (no third hand-duplicated copy)"
    - "The recorded variant name / composite task_id are UNCHANGED by resolution (task_hash stays constant for comparability)"
  artifacts:
    - path: "lib/experiments/agent-routing.mjs"
      provides: "resolveCellModel + buildAgentRoutingEnv single source of truth for per-agent launch model + routing env"
      exports: ["resolveCellModel", "buildAgentRoutingEnv"]
    - path: "tests/experiments/agent-routing.test.mjs"
      provides: "node:test coverage of the model-resolution + env-map contract"
  key_links:
    - from: "lib/experiments/experiment-runner.mjs"
      to: "lib/experiments/agent-routing.mjs"
      via: "runCell resolves launchModel once, passes it to argvForAgent + configureRouting"
      pattern: "resolveCellModel"
    - from: "scripts/launch-agent-common.sh"
      to: "lib/experiments/agent-routing.mjs"
      via: "copilot model default sourced from the helper CLI (fail-soft literal)"
      pattern: "agent-routing"
---

<objective>
Make each experiment cell invoke its agent through the SAME proxy-routing/env/model setup that
`bin/coding --<agent>` establishes, so the opencode and copilot cells stop failing for harness
reasons. The failing dogfood run proved the routing ENV is already applied (`configureProxyRoutingEnv`
is wired into `runCell`), but the per-agent MODEL is wrong:

- opencode's spec model `rapid-proxy/claude-haiku-4-5` is a DASH-vs-DOT TYPO. `rapid-proxy` is a REAL
  working provider in `~/.config/opencode/opencode.json` (baseURL `http://localhost:12435/v1`) and
  `opencode models` lists the DOTTED id `rapid-proxy/claude-haiku-4.5`. The fix is `4-5`→`4.5`, KEEPING
  the `rapid-proxy/` prefix — NOT a provider swap.
- copilot's `auto` is not a proxy-copilot catalog id (verified live: `POST /api/complete
  {provider:copilot, model:auto}` → HTTP 500 "The requested model is not supported"; the resolved
  `claude-haiku-4-5`→`claude-haiku-4.5` returns 200). The interactive measured path defaults to a real id.

Purpose: converge the cell launch model + env onto ONE source of truth shared with the interactive
shell path, killing the drift that made a 3-way experiment a one-horse race.
Output: `lib/experiments/agent-routing.mjs` (model resolution + canonical env map), the cell path
wired to it, the shell's copilot model default sourced from it, and the two shipped specs corrected.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/88-experiment-harness-agent-invocation-alignment-and-pre-flight/88-CONTEXT.md

<interfaces>
<!-- The live opencode catalog (verified 2026-07-22 via `~/.opencode/bin/opencode models`):
     rapid-proxy/claude-haiku-4.5, rapid-proxy/claude-opus-4.5, rapid-proxy/claude-opus-4.6,
     rapid-proxy/claude-opus-4.8, rapid-proxy/claude-sonnet-4.5/4.6, rapid-proxy/claude-sonnet-5,
     rapid-proxy/gpt-4o, rapid-proxy/gpt-4o-mini. The rapid-proxy provider is defined in
     ~/.config/opencode/opencode.json → baseURL http://localhost:12435/v1. OPENCODE_CONFIG_CONTENT
     MERGES over that file (the dogfood run still saw the rapid-proxy catalog under a partial splice),
     so the file's rapid-proxy provider + model map survive. -->

From scripts/launch-agent-common.sh configure_proxy_routing() (the WORKING interactive reference):
- claude    → ANTHROPIC_BASE_URL=${base}; unset ANTHROPIC_API_KEY; ANTHROPIC_CUSTOM_HEADERS="x-task-id: ${TASK_ID}"
- opencode  → ANTHROPIC_BASE_URL=${base} (KEEP key); OPENCODE_CONFIG_CONTENT provider splice
- copilot   → COPILOT_PROVIDER_BASE_URL=${base}/v1/copilot/t/${TASK_ID}; COPILOT_PROVIDER_TYPE=openai;
              COPILOT_PROVIDER_API_KEY=<placeholder>; COPILOT_MODEL=${COPILOT_MODEL:-claude-haiku-4-5}  (measured-span default, line 478; proxy resolveCopilotModel maps the dash alias → claude-haiku-4.5)

From lib/experiments/experiment-runner.mjs:
export async function configureProxyRoutingEnv(agent, baseEnv, { port, probe, route, taskId, model }): Promise<object>
export function cellName(cell): string          // agent-model-framework-env (identity — DO NOT change)
export function composeTaskId(expId, cell, rep): string

From lib/experiments/agent-headless.mjs:
export function argvForAgent(agentName, goal, { model }): string[]   // emits --model/-m <model>
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Create agent-routing.mjs — model resolution + canonical env map (single source of truth)</name>
  <read_first>
    - ~/.config/opencode/opencode.json (the REAL rapid-proxy provider: baseURL localhost:12435/v1 + its dotted model map — proof rapid-proxy is not phantom)
    - `~/.opencode/bin/opencode models` output (the live catalog to validate the resolved id against — run it during this task)
    - lib/experiments/experiment-runner.mjs (configureProxyRoutingEnv switch, lines ~223-313 — the env logic to factor out)
    - scripts/launch-agent-common.sh (configure_proxy_routing() lines ~400-502 — the WORKING reference values: copilot COPILOT_MODEL default line 478, opencode OPENCODE_CONFIG_CONTENT)
    - tests/experiments/experiment-runner.test.mjs (existing configureProxyRoutingEnv assertions lines ~366-406 — the env-map behavior to preserve verbatim)
  </read_first>
  <behavior>
    - resolveCellModel('opencode','rapid-proxy/claude-haiku-4-5') → 'rapid-proxy/claude-haiku-4.5' (dash-version → dot-version; the rapid-proxy/ PROVIDER PREFIX is KEPT — no swap)
    - resolveCellModel('opencode','rapid-proxy/claude-haiku-4.5') → 'rapid-proxy/claude-haiku-4.5' (already-dotted passthrough, idempotent)
    - resolveCellModel('opencode','rapid-proxy/claude-opus-4-6') → 'rapid-proxy/claude-opus-4.6'
    - resolveCellModel('copilot','auto') → the copilot measured default constant (COPILOT_MEASURED_DEFAULT_MODEL, value 'claude-haiku-4-5' to match launch-agent-common.sh:478; the proxy maps the dash alias → claude-haiku-4.5)
    - resolveCellModel('copilot','claude-opus-4.8') → 'claude-opus-4.8' (already-valid passthrough)
    - resolveCellModel('claude','opus') → 'opus' (claude CLI aliases pass through untouched)
    - resolveCellModel('claude','sonnet') → 'sonnet'
    - buildAgentRoutingEnv('copilot', baseEnv, {taskId:'t1', model:'claude-haiku-4-5', port:12435}) sets COPILOT_PROVIDER_BASE_URL=http://127.0.0.1:12435/v1/copilot/t/t1, COPILOT_PROVIDER_TYPE=openai, COPILOT_MODEL=claude-haiku-4-5
    - buildAgentRoutingEnv('opencode', baseEnv, {taskId:'t1', model:'rapid-proxy/claude-haiku-4.5', port}) sets ANTHROPIC_BASE_URL + splices OPENCODE_CONFIG_CONTENT provider options (anthropic/openai/github-copilot baseURL + x-task-id/x-agent headers) VERBATIM as today — it does NOT redefine the rapid-proxy provider (the file config supplies it; the cell's rapid-proxy traffic attributes via the sequential global-span, D-09)
    - buildAgentRoutingEnv('claude', baseEnv, {taskId:'t1', port}) sets ANTHROPIC_BASE_URL + ANTHROPIC_CUSTOM_HEADERS='x-task-id: t1'
    - buildAgentRoutingEnv returns a COPY (never mutates baseEnv, never touches LLM_PROXY_DATA_DIR)
  </behavior>
  <action>
    Create `lib/experiments/agent-routing.mjs` as a PURE, side-effect-free module (no fs/network/spawn).
    Export a named constant COPILOT_MEASURED_DEFAULT_MODEL ('claude-haiku-4-5' — the launch-agent-common.sh:478
    measured-span default) so the copilot default lives in exactly ONE place. Export resolveCellModel(agent, specModel)
    returning the catalog-valid LAUNCH model per the behavior table: for OPENCODE, normalize ONLY the trailing
    dash-version to a dot-version while KEEPING the full provider prefix — regex `/-(\d+)-(\d+)$/` → `-$1.$2` (turns
    `rapid-proxy/claude-haiku-4-5`→`rapid-proxy/claude-haiku-4.5`, leaves already-dotted ids unchanged); do NOT strip
    or swap the `rapid-proxy/` provider (it is real — see ~/.config/opencode/opencode.json). For COPILOT map `auto`
    (and empty) → COPILOT_MEASURED_DEFAULT_MODEL else passthrough; for claude/mastracode passthrough unchanged.
    Export buildAgentRoutingEnv(agent, baseEnv, {taskId, model, port}) = the per-agent env map lifted VERBATIM from
    experiment-runner.mjs configureProxyRoutingEnv's switch body (opencode OPENCODE_CONFIG_CONTENT splice for the
    anthropic/openai/github-copilot providers exactly as today, claude ANTHROPIC_CUSTOM_HEADERS, copilot BYOK
    COPILOT_* incl COPILOT_MODEL=model). buildAgentRoutingEnv does NOT do health/route/opt-out gating (stays in
    configureProxyRoutingEnv, Task 2) and does NOT resolve the model (caller passes the already-resolved model).
    Add a minimal CLI entry so `node lib/experiments/agent-routing.mjs default copilot` prints
    COPILOT_MEASURED_DEFAULT_MODEL to stdout (consumed by the shell in Task 3); unknown args exit 2. Author
    tests/experiments/agent-routing.test.mjs (node:test) covering every behavior-table row FIRST (RED).
  </action>
  <verify>
    <automated>node --test tests/experiments/agent-routing.test.mjs && node -e "import('./lib/experiments/agent-routing.mjs').then(m=>{const r=m.resolveCellModel('opencode','rapid-proxy/claude-haiku-4-5');if(r!=='rapid-proxy/claude-haiku-4.5'){console.error('bad resolve: '+r);process.exit(1)}})" && ~/.opencode/bin/opencode models 2>/dev/null | grep -qx "rapid-proxy/claude-haiku-4.5" && echo "resolved id present in live opencode catalog"</automated>
  </verify>
  <acceptance_criteria>
    - `node --test tests/experiments/agent-routing.test.mjs` exits 0 with every behavior-table case asserted
    - `grep -nE "export (function|const) (resolveCellModel|buildAgentRoutingEnv|COPILOT_MEASURED_DEFAULT_MODEL)" lib/experiments/agent-routing.mjs` returns all three exports
    - The resolved opencode id `rapid-proxy/claude-haiku-4.5` appears verbatim in real `~/.opencode/bin/opencode models` output (the verify command greps `-qx` for it) — NOT merely a unit-test of a hardcoded expectation
    - resolveCellModel KEEPS the `rapid-proxy/` prefix (no `anthropic/` swap): `node -e "import('./lib/experiments/agent-routing.mjs').then(m=>process.exit(m.resolveCellModel('opencode','rapid-proxy/claude-haiku-4-5').startsWith('rapid-proxy/')?0:1))"` exits 0
    - `node lib/experiments/agent-routing.mjs default copilot` prints `claude-haiku-4-5` (exit 0)
  </acceptance_criteria>
  <done>agent-routing.mjs exports the resolver + env builder + shared default; the opencode resolution is the evidence-backed dash→dot fix validated against the live catalog; all node:test cases pass; CLI default subcommand works.</done>
</task>

<task type="auto">
  <name>Task 2: Wire the cell path — resolve model once in runCell; delegate env-map to agent-routing.mjs</name>
  <read_first>
    - lib/experiments/experiment-runner.mjs (runCell lines ~499-649: the agentEnv build at ~602 + argvForAgent call at ~610; configureProxyRoutingEnv lines ~223-313)
    - lib/experiments/agent-headless.mjs (argvForAgent lines ~86-114 — the --model/-m emission)
    - lib/experiments/agent-routing.mjs (Task 1 exports)
    - tests/experiments/experiment-runner.test.mjs (existing configureProxyRoutingEnv + runCell routing assertions lines ~366-406 — must still pass)
  </read_first>
  <action>
    In lib/experiments/experiment-runner.mjs, import resolveCellModel + buildAgentRoutingEnv from ./agent-routing.mjs.
    Refactor configureProxyRoutingEnv so it keeps its EXISTING signature and gating (CODING_PROXY_ROUTE opt-out +
    the /health probe fail-soft), but for the routed case DELEGATES the per-agent env map to
    buildAgentRoutingEnv(agent, env, { taskId, model, port }) instead of the inline switch — the switch body moves
    to agent-routing.mjs (Task 1). Preserve the exact returned env for every existing test assertion (opencode
    ANTHROPIC_BASE_URL + keep key + OPENCODE_CONFIG_CONTENT splice; claude ANTHROPIC_CUSTOM_HEADERS; copilot BYOK).
    In runCell, resolve the LAUNCH model exactly once BEFORE launch: `const launchModel = resolveCellModel(cell.agent, cell.model)`.
    Pass launchModel to BOTH configureRouting (as `model: launchModel`) AND argvForAgent (as `{ model: launchModel }`).
    CRITICAL: do NOT change composeTaskId, cellName, the recorded `--variant`, or the measurement-start `--model`
    (those stay keyed off the ORIGINAL cell.model so task_hash + the variant identity are byte-unchanged — D-05
    comparability). Only the actual agent CLI arg + COPILOT_MODEL/opencode `-m` use launchModel. argvForAgent itself
    needs no change beyond receiving launchModel from runCell.
    Add a runner test asserting: (a) a copilot cell with model 'auto' spawns with argv containing 'claude-haiku-4-5'
    (not 'auto') and COPILOT_MODEL='claude-haiku-4-5'; (b) an opencode cell with model 'rapid-proxy/claude-haiku-4-5'
    spawns with `-m rapid-proxy/claude-haiku-4.5`; (c) the composed task_id + recorded variant still use the ORIGINAL
    model string.
  </action>
  <verify>
    <automated>node --test tests/experiments/experiment-runner.test.mjs tests/experiments/agent-headless.test.mjs</automated>
  </verify>
  <acceptance_criteria>
    - `node --test tests/experiments/experiment-runner.test.mjs` exits 0 (all prior configureProxyRoutingEnv assertions still pass)
    - `grep -nE "resolveCellModel|buildAgentRoutingEnv" lib/experiments/experiment-runner.mjs` shows both imported and used
    - `grep -n "launchModel" lib/experiments/experiment-runner.mjs` shows the model resolved once and passed to BOTH argvForAgent and configureRouting
    - The new runner test proves task_id/variant use the ORIGINAL model while the spawned argv + COPILOT_MODEL use the RESOLVED model
    - `grep -vE '^\s*//' lib/experiments/experiment-runner.mjs | grep -c "case 'copilot'"` shows the per-agent env switch is no longer duplicated in the runner (delegated to agent-routing.mjs)
  </acceptance_criteria>
  <done>runCell resolves the launch model from the single source of truth and passes it to both the CLI argv and the routing env; identity fields unchanged; existing + new tests green.</done>
</task>

<task type="auto">
  <name>Task 3: Close shell↔cell drift + correct the two shipped specs</name>
  <read_first>
    - scripts/launch-agent-common.sh (configure_proxy_routing() copilot branch line ~478 `COPILOT_MODEL:-claude-haiku-4-5`)
    - lib/experiments/agent-routing.mjs (the `default copilot` CLI subcommand from Task 1)
    - config/experiments/compare-avenues-help-v1.yaml (opencode model `rapid-proxy/claude-haiku-4-5`, copilot model `auto`)
    - config/experiments/compare-fizzbuzz.yaml (same stale model strings)
  </read_first>
  <action>
    In scripts/launch-agent-common.sh configure_proxy_routing(), replace the hard-coded copilot measured-span default
    literal at line ~478 (`${COPILOT_MODEL:-claude-haiku-4-5}`) with a fail-soft source from the single helper:
    `${COPILOT_MODEL:-$(node "${CODING_REPO}/lib/experiments/agent-routing.mjs" default copilot 2>/dev/null || echo claude-haiku-4-5)}`
    — the `|| echo` guarantees the interactive path NEVER breaks if node/helper is unavailable (byte-identical
    behavior on the happy path, no regression to the working launcher). Do NOT touch the ambient branch (line ~490)
    or any other agent branch. This closes the "third copy" concern: the copilot measured default lives ONLY in
    agent-routing.mjs, consulted by both the cell path (Task 2) and the shell here.
    Then correct the two shipped specs to emit catalog-valid ids directly (belt-and-suspenders with resolveCellModel):
    in BOTH config/experiments/compare-avenues-help-v1.yaml and config/experiments/compare-fizzbuzz.yaml, change the
    opencode `model:` from `rapid-proxy/claude-haiku-4-5` to `rapid-proxy/claude-haiku-4.5` (dash→dot, KEEP the
    rapid-proxy/ prefix — the real catalog id), and add a trailing comment on the copilot `model: auto` line noting
    `auto` resolves to the copilot measured default via resolveCellModel. Keep the copilot value as `auto`
    (resolveCellModel maps it) so the alias path stays exercised.
  </action>
  <verify>
    <automated>bash -n scripts/launch-agent-common.sh && node -e "const y=require('js-yaml');const fs=require('fs');for(const f of ['config/experiments/compare-avenues-help-v1.yaml','config/experiments/compare-fizzbuzz.yaml']){const s=y.load(fs.readFileSync(f,'utf8'));const oc=s.variants.find(v=>v.agent==='opencode');if(oc.model!=='rapid-proxy/claude-haiku-4.5'){console.error('bad opencode model in '+f+': '+oc.model);process.exit(1)}}console.log('specs ok')"</automated>
  </verify>
  <acceptance_criteria>
    - `bash -n scripts/launch-agent-common.sh` exits 0 (no syntax regression)
    - `grep -n "agent-routing.mjs" scripts/launch-agent-common.sh` shows the copilot default sourced from the helper with a `|| echo` fail-soft fallback
    - Both specs parse and their opencode variant model is `rapid-proxy/claude-haiku-4.5` (verify command prints `specs ok`)
    - `grep -c "rapid-proxy/claude-haiku-4-5" config/experiments/compare-avenues-help-v1.yaml config/experiments/compare-fizzbuzz.yaml` returns 0 for both files (no dash-typo left)
    - The shell ambient branch (line ~490 `claude-opus-4.8`) is UNCHANGED (`git diff scripts/launch-agent-common.sh` touches only the measured-span copilot default line)
  </acceptance_criteria>
  <done>The copilot measured default lives in one place (agent-routing.mjs), consulted by both the shell and the cell path; both shipped specs carry the catalog-valid dotted opencode id; the interactive launcher remains fail-soft and unregressed.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| spec YAML → runner | operator-authored model strings cross into argv/env construction |
| runner → shared host llm-proxy | cell LLM traffic + resolved model id cross to the proxy on :12435 |
| shell launcher → node helper | configure_proxy_routing() shells out to agent-routing.mjs for a model default |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-88-01-01 | Tampering | resolveCellModel model normalization | mitigate | pure string mapping (dash→dot / alias map) over a closed set; unknown → passthrough; fixed-argv only, never a shell string |
| T-88-01-02 | Injection | shell `$(node ... default copilot)` command substitution | mitigate | fixed subcommand args (no interpolated user input); `2>/dev/null || echo <literal>` fail-soft so an absent/compromised helper degrades to the known-good literal |
| T-88-01-03 | Info-disclosure | COPILOT_PROVIDER_API_KEY placeholder | accept | literal non-secret placeholder against the localhost no-auth proxy (T-82-05-01 precedent) |
| T-88-01-SC | Tampering | npm/pip/cargo installs | accept | NO package installs — pure JS + shell edits over existing deps (js-yaml already present) |
</threat_model>

<verification>
- `node --test tests/experiments/agent-routing.test.mjs tests/experiments/experiment-runner.test.mjs tests/experiments/agent-headless.test.mjs` all green
- The resolved opencode id is present in live `opencode models` output
- `bash -n scripts/launch-agent-common.sh` clean; both specs parse with `rapid-proxy/claude-haiku-4.5` for opencode
- No new production copy of the per-agent env-string literals outside agent-routing.mjs
</verification>

<success_criteria>
- opencode + copilot cells resolve a catalog-valid launch model (validated against the live opencode catalog + the live copilot /api/complete round-trip) derived from ONE source of truth
- The recorded variant name / composite task_id are byte-unchanged (task_hash constant)
- The interactive shell launcher remains fail-soft and unregressed
</success_criteria>

<output>
Create `.planning/phases/88-experiment-harness-agent-invocation-alignment-and-pre-flight/88-01-SUMMARY.md` when done
</output>
