# OpenCodeVariantBandSplicing

**Type:** Detail

# OpenCodeVariantBandSplicing

## What It Is

OpenCodeVariantBandSplicing is the mechanism, implemented entirely in `config/agents/opencode.sh`, that translates opencode's agent-native `--variant cheap|standard|deep` selector into the OpenAI-wire `reasoning_effort` field consumed downstream by the proxy's `resolveCallerComplexity()`/`EFFORT_TO_BAND` classifier. It lives inside `agent_pre_launch()` and is built from two coupled pieces: `_oc_variants`, which is repeated per model, and `_oc_models`, a deliberately constrained list (`claude-sonnet-5`, `claude-haiku-4.5`, `gpt-4o`, `gpt-4o-mini`) that must remain a validated subset of the proxy's `available_models`. As a component under the parent **BaseAgent**, it exemplifies the same "implement hooks, let the orchestrator drive sequencing" philosophy that BaseAgent's TypeScript pipeline enforces, but expressed at the shell layer through `agent_check_requirements` / `agent_pre_launch` / `agent_cleanup`.

## Architecture and Design

The defining architectural move is treating variant-band splicing as a JSON-composition problem first and a routing problem second. The helper `_oc_splice_config()` centralizes an invariant — every splice must produce syntactically valid JSON regardless of accumulator state — that was previously re-derived (and gotten wrong) at each of four-plus call sites, producing a trailing-comma bug whenever the accumulator was still the empty `{}` seed. This is a single-writer JSON accumulator pattern: rather than trusting each call site to reason about prepend-vs-wrap, the decision is made once and reused for provider, command, plugin/compaction, and variant fragments alike.

A second, related design decision is the single provider-fragment construction: `_oc_provider_entries` is built once and spliced once, specifically to avoid a duplicate top-level `"provider"` key that would silently drop data during JSON merge (a class of bug that produces no error, only quietly discarded configuration). This is defensive architecture — structuring code so a hazard is structurally impossible rather than documented-and-hoped-against.

Structurally, this variant-band logic is a direct analogue of pi.sh's `thinkingLevelMap` / `_pi_write_models_json()`. Both agent files independently converge on the same proxy-side contract (an effort field mapped to routing bands) using different agent-native vocabularies, without sharing an abstraction layer between the two shell files — a case of philosophical convergence without code reuse.

## Implementation Details

`_oc_splice_config()` encodes the rule: if the current accumulator equals `{}` or is empty, wrap the new fragment as the seed object; otherwise, prepend the fragment with a comma into the existing object body. Every subsequent splice call (provider, command, plugin, variant) routes through this one function, so JSON validity is enforced once rather than at each of the historically-buggy call sites.

The variant list itself is gated by cross-validation: `scripts/audit-agent-model-catalogue.mjs` fails CI if `_oc_models` diverges from the proxy's available models, and this coupling is called out as matching CLAUDE.md's "Model ids are validated in TWO places" discipline — model IDs added here without updating the catalogue script either break the build or get silently discarded during the proxy's model-rewrite step. The list also documents its own pruning: `claude-sonnet-4.6` was dropped after retirement from the Copilot catalogue.

The correctness of the effort-mapping itself was empirically verified, not just code-reviewed: the comment history records a measured production regression (770 `high` rows vs 4 `small` since a given date) traced to opencode sending no `reasoning_effort` field on a bare run, causing permanent fallback to `defaults.fg-chat`. The fix was validated against a capture endpoint (confirming `--variant cheap` sends `"low"` while a bare run sends nothing) and again through the live proxy producing a `route_band=small` result on `gh-copilot/claude-haiku-4.5` before being trusted.

## Integration Points

Downstream, the spliced `reasoning_effort` field is consumed by `resolveCallerComplexity()` and `EFFORT_TO_BAND` on the proxy side, tying this shell-level splicing directly into `llm-routing.yaml` and rapid-llm-proxy's semantic routing. Upstream, `CODING_OPENCODE_MODEL` acts as an explicit override that bypasses variant/routing logic entirely — consistent with the file's broader retirement of a network-based model-pinning branch (`CODING_OPENCODE_NO_PROXY`) that once let INSIDE_CN pin a provider with zero valid model ids, an over-confident failure mode the current design deliberately avoids in favor of explicit, logged defaults.

The scope-gating mechanism (`_oc_scope` / `CODING_AGENT_SCOPE`) is architecturally adjacent: it determines whether wrapper-scoped plugins (`compaction-guard`, `knowledge-injection`) are injected at all, gating on `_oc_scope != global`. This mirrors pi.sh's `_pi_install_extensions` marker-guard pattern and sibling **NoUnboundedFsScanGuard**'s posture of narrow, well-bounded intervention — both treat user-owned global config as untouchable.

Philosophically, this component also aligns with `batch-provenance.mjs`'s `selectBatchesForReport()` "degrade rather than over-include" stance: both prefer an explicit fallback or exclusion over a silent guess.

## Usage Guidelines

Developers adding a new model variant must update `_oc_models` and simultaneously ensure `scripts/audit-agent-model-catalogue.mjs` recognizes it — failing to do so either breaks CI or produces silently-dropped model IDs at the proxy layer. Any new JSON fragment spliced into opencode's config must go through `_oc_splice_config()` rather than inlining accumulator logic, to preserve the always-valid-JSON invariant. When introducing new provider-level configuration, prefer appending into an existing single fragment (as `_oc_provider_entries` does) rather than issuing an additional splice call, to avoid duplicate-key merge hazards. Finally, any change to variant/effort mapping should be verified end-to-end against a capture endpoint or live proxy before being trusted, per the precedent set by the documented regression fix — code-reading confidence alone is treated as insufficient here.


## Hierarchy Context

### Parent
- [BaseAgent](./BaseAgent.md) -- [LLM] The parent observation describing BaseAgent's template-method execute() pipeline (process() → calculateConfidence() → detectIssues() → generateRouting() → applyCorrections() → buildMetadata()) is not directly visible in the provided code files, but the surrounding config/agents/*.sh scripts (copilot.sh, opencode.sh, pi.sh) reveal a parallel template-method philosophy at the shell layer: each agent definition file sources common hooks (agent_check_requirements, agent_pre_launch, agent_cleanup) that are called uniformly by launch-agent-common.sh, mirroring the same 'implement the hooks, let the orchestrator drive the sequence' pattern that BaseAgent enforces in TypeScript. This suggests the project applies the template-method pattern consistently across both its LLM-agent pipeline and its CLI-agent launch pipeline.

### Siblings
- [NoUnboundedFsScanGuard](./NoUnboundedFsScanGuard.md) -- [LLM] no-unbounded-fs-scan.ts (config/agents/pi-extensions/no-unbounded-fs-scan.ts) implements its guard as a PreToolUse-style interception on pi's `tool_call` event, filtering specifically for `bash` invocations via `isToolCallEventType('bash', event)` before extracting `event.input?.command`. The core detection logic is split into three pure, independently testable functions — `unboundedRoots()` (returns the static deny-list of whole-machine roots: `/`, `/Users`, `/home`, `/System`, `/Volumes`, `/private`, `/var`, `/opt`, `/Applications`, plus `os.homedir()`), `findRoots(argv)` (parses `find`'s positional-then-flag argv convention, stopping at the first `-`-prefixed token, `(`, or `!` so predicates like `-name /foo` are never misread as paths), and `offendingRoot(command, cwd)` (the orchestrator, exported for unit testing, that splits the shell command on `||`, `&&`, `;`, `|`, newlines, `$(`, and backticks to catch scans hidden inside command chains or subshells). This decomposition mirrors a classic lexer→parser→policy pipeline compressed into ~80 lines, prioritizing testability of the security-relevant boundary logic over runtime performance.


---

*Generated from 10 observations*
