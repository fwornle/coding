# Resume: work blocked on the copilot quota

Everything in this file is blocked by one thing — the copilot monthly quota. Read
"The gate" first; it explains why unrelated-looking things all stop at the same wall,
and why several plausible workarounds cannot work.

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

### 2.1 Tool telemetry for copilot and opencode — the main task

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

### 2.2 opencode end-to-end — unverified

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

### 2.5 copilot 1.0.80 rejects `enableFileHooks`

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

## 4. Diagnostic traps worth remembering

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
