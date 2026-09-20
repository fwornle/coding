# BaseAgent

**Type:** SubComponent

[LLM] The parent observation describing BaseAgent's template-method execute() pipeline (process() → calculateConfidence() → detectIssues() → generateRouting() → applyCorrections() → buildMetadata()) is not directly visible in the provided code files, but the surrounding config/agents/*.sh scripts (copilot.sh, opencode.sh, pi.sh) reveal a parallel template-method philosophy at the shell layer: each agent definition file sources common hooks (agent_check_requirements, agent_pre_launch, agent_cleanup) that are called uniformly by launch-agent-common.sh, mirroring the same 'implement the hooks, let the orchestrator drive the sequence' pattern that BaseAgent enforces in TypeScript. This suggests the project applies the template-method pattern consistently across both its LLM-agent pipeline and its CLI-agent launch pipeline.

# BaseAgent — Technical Insight Document

## What It Is

BaseAgent is a SubComponent of the SemanticAnalysis system, and while its own TypeScript template-method pipeline (`execute()` sequencing `process()` → `calculateConfidence()` → `detectIssues()` → `generateRouting()` → `applyCorrections()` → `buildMetadata()`) is not directly visible in the provided code files, its architectural philosophy is richly evidenced through the sibling and child artifacts that surround it. Notably, the shell-based agent launch layer — `config/agents/copilot.sh`, `config/agents/opencode.sh`, and `config/agents/pi.sh` — implements a parallel template-method structure: each agent definition sources common lifecycle hooks (`agent_check_requirements`, `agent_pre_launch`, `agent_cleanup`) that are invoked uniformly by `launch-agent-common.sh`. BaseAgent should be understood as the canonical TypeScript expression of a "define the hooks, let the orchestrator drive the sequence" pattern that recurs at multiple layers of this codebase.

![BaseAgent — Architecture](images/base-agent-architecture.png)

## Architecture and Design

The defining architectural trait of BaseAgent's ecosystem is **deterministic-first, LLM-as-fallback** design — a philosophy inherited from its parent SemanticAnalysis, where OntologyClassificationAgent's hard-root-guard bypasses the LLM classifier entirely for structurally critical ontology names. This same escape-hatch pattern reappears in `opencode.sh`'s `agent_pre_launch`, where `CODING_OPENCODE_MODEL` lets an operator override network-based/routing-based model selection outright, and in the child component NoUnboundedFsScanGuard, where `no-unbounded-fs-scan.ts` installs a hardcoded, non-probabilistic `tool_call` gate rather than trusting an LLM agent's own judgment about safe filesystem operations.

A second consistent theme is **single-source-of-truth consolidation**: `opencode.sh` explicitly retires a "second routing mechanism" (`CODING_OPENCODE_NO_PROXY` plus network-based model pinning) in favor of `llm-routing.yaml` and rapid-llm-proxy's `semantic_routing`, mirroring how sibling L2SubsystemClassifier restricts its entire output vocabulary to what's declared in `coding.lower.json`. Both designs eliminate competing decision-making authorities that could silently disagree, consolidating control into one canonical config artifact.

Third, **graceful degradation over hard failure** pervades the surrounding subsystems: `extractL2FromLLMResponse()` falls back to L1 classification rather than erroring, `batch-provenance.mjs`'s `selectBatchesForReport()` returns an empty array rather than guessing at missing timestamps, and `pi.sh`'s `_pi_write_models_json()` implements `thinkingLevelMap`/`reasoning_effort` banding so agent behavior degrades to coarser, cheaper levels instead of failing outright.

![BaseAgent — Relationship](images/base-agent-relationship.png)

## Implementation Details

Since BaseAgent's own source is not present in these observations, its implementation is best understood through its two children. OpenCodeVariantBandSplicing, realized as `_oc_splice_config()` in `config/agents/opencode.sh`, centralizes JSON-fragment composition to fix a trailing-comma bug that occurred whenever multiple splice call sites independently inlined config fragments — enforcing the "always-valid JSON" invariant once rather than re-deriving it at each of four-plus call sites. NoUnboundedFsScanGuard, implemented in `config/agents/pi-extensions/no-unbounded-fs-scan.ts`, decomposes its PreToolUse-style interception into three pure, testable functions: `unboundedRoots()` (the static deny-list of whole-machine paths), `findRoots(argv)` (a `find`-argv parser respecting positional-then-flag conventions), and `offendingRoot(command, cwd)` (the orchestrator splitting shell command chains on `||`, `&&`, `;`, `|`, and subshell markers). Its catch block is deliberately empty and commented as "fail OPEN," reflecting the same non-fatal auxiliary-logging philosophy as SemanticAnalysisAgent's trace-file mechanism — an optional safety net that must never block the primary task.

## Integration Points

BaseAgent sits beneath SemanticAnalysis and alongside siblings Ontology, Pipeline, Insights, and L2SubsystemClassifier, sharing with L2SubsystemClassifier the closed-vocabulary, config-driven decision philosophy (`coding.lower.json` for ontology classes, `llm-routing.yaml` for routing). Its children, OpenCodeVariantBandSplicing and NoUnboundedFsScanGuard, both operate within the `config/agents/` shell-scripting layer, showing that BaseAgent's influence extends beyond pure TypeScript into the CLI agent launch infrastructure. `copilot.sh` further reflects this integration, gating BYOK environment variables behind a health check in its own `agent_pre_launch`.

## Usage Guidelines

Developers extending BaseAgent-derived behavior should preserve its layered defensive posture: prefer hardcoded escape hatches (like `CODING_OPENCODE_MODEL` or the hard-root-guard) over trusting probabilistic paths for structurally critical decisions, and route configuration decisions through a single canonical source rather than introducing parallel mechanisms that can drift out of sync. When adding auxiliary safety or logging behavior, follow the fail-open/non-fatal pattern demonstrated in `no-unbounded-fs-scan.ts` — auxiliary checks should never prevent the primary task from completing. Finally, when composing JSON or config fragments across multiple call sites, centralize the invariant-enforcement logic (as `_oc_splice_config()` does) rather than duplicating validation at each call site.


## Hierarchy Context

### Parent
- [SemanticAnalysis](./SemanticAnalysis.md) -- [LLM] The classification pipeline in OntologyClassificationAgent embodies a deliberate 'deterministic-first, LLM-as-fallback' philosophy that recurs throughout SemanticAnalysis. Before any LLM call is made, classifySingleObservation() checks the observation's name against the hard-root-guard set (CollectiveKnowledge, Coding, DynArch, Timeline, Normalisa) imported from @fwornle/km-core's HIERARCHY_ROOTS. If matched, the method immediately assigns classificationMethod='hard-root-guard' and returns without ever invoking classifier.classify() or touching the LLM. This is a defensive engineering decision: because these 5 names anchor the entire hierarchy, any LLM-driven misclassification of them would cascade corruption through the whole ontology tree, so the developers chose to hardcode an escape hatch rather than trust probabilistic classification for structurally critical nodes.

### Children
- [OpenCodeVariantBandSplicing](./OpenCodeVariantBandSplicing.md) -- [LLM] opencode.sh's `_oc_splice_config()` (config/agents/opencode.sh) exists solely to fix a JSON-composition bug: the two former call sites inlined `{${frag},${OPENCODE_CONFIG_CONTENT#\{}}`, which produces a syntactically invalid trailing-comma object (`{frag,}`) whenever the accumulator was still the empty `{}` seed. The fix centralizes the check (`if "$_cur" = '{}' or empty, then wrap; else prepend with comma`) into one function used by every later splice call (provider, command, plugin/compaction fragments), so the invariant — always-valid JSON regardless of call order — is enforced once rather than re-derived at each of the four+ splice sites in the file.
- [NoUnboundedFsScanGuard](./NoUnboundedFsScanGuard.md) -- [LLM] no-unbounded-fs-scan.ts (config/agents/pi-extensions/no-unbounded-fs-scan.ts) implements its guard as a PreToolUse-style interception on pi's `tool_call` event, filtering specifically for `bash` invocations via `isToolCallEventType('bash', event)` before extracting `event.input?.command`. The core detection logic is split into three pure, independently testable functions — `unboundedRoots()` (returns the static deny-list of whole-machine roots: `/`, `/Users`, `/home`, `/System`, `/Volumes`, `/private`, `/var`, `/opt`, `/Applications`, plus `os.homedir()`), `findRoots(argv)` (parses `find`'s positional-then-flag argv convention, stopping at the first `-`-prefixed token, `(`, or `!` so predicates like `-name /foo` are never misread as paths), and `offendingRoot(command, cwd)` (the orchestrator, exported for unit testing, that splits the shell command on `||`, `&&`, `;`, `|`, newlines, `$(`, and backticks to catch scans hidden inside command chains or subshells). This decomposition mirrors a classic lexer→parser→policy pipeline compressed into ~80 lines, prioritizing testability of the security-relevant boundary logic over runtime performance.

### Siblings
- [Ontology](./Ontology.md) -- [CGR] ontology (variable) in knowledge-management.json
- [Pipeline](./Pipeline.md) -- [CGR] pollKnowledgePipeline (function) in health-coordinator.js
- [Insights](./Insights.md) -- [CGR] INSIGHTS (class) in kb-ab-sample-tasks.mjs
- [L2SubsystemClassifier](./L2SubsystemClassifier.md) -- [LLM] L2SubsystemClassifier's refinement step, as implemented via loadL2Classes() in ontology-classification-agent.ts, is architected as a closed-vocabulary lookup rather than an open classification task. It derives its candidate set by filtering registry.classCatalog to entries whose `extends` field resolves to one of REFINABLE_L1_PARENTS ('Component','SubComponent','Detail'), sourced from .data/ontologies/coding.lower.json. This means the classifier's entire universe of possible outputs (currently 10 L2 classes such as EtmDaemon, RapidLlmProxy, ConstraintMonitor) is defined declaratively in a JSON ontology file rather than being inferable or extensible by the LLM itself — a new SubComponent type cannot be classified into existence, it must first be registered in the ontology.


---

*Generated from 10 observations*
