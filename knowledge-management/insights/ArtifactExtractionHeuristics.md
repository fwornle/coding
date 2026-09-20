# ArtifactExtractionHeuristics

**Type:** Detail

[Code References] src/ontology/heuristics/EntityPatternAnalyzer.ts:constructor - hardcoded teamDirectories Map and artifactPatterns array; src/ontology/heuristics/EntityPatternAnalyzer.ts:analyzeEntityPatterns() - two-step checkLocalArtifact()/matchArtifactPattern() resolution with early return; src/ontology/heuristics/EntityPatternAnalyzer.ts:extractArtifacts() - four regex patterns accumulated into a Set; src/ontology/heuristics/EntityPatternAnalyzer.ts:inferEntityClass() - teamMappings record duplicating entityClassMap logic; scripts/knowledge-management/verify-patterns.sh:CONSOLE_LOG_COUNT/PASSED_CHECKS - compliance scoring via rg counts and arithmetic; scripts/knowledge-management/verify-patterns.sh:CLAUDE_REPO - three-tier environment variable fallback for repo root; scripts/knowledge-management/verify-patterns.sh:PATTERNS - jq-driven read of $SHARED_MEMORY feeding a hardcoded case statement; integrations/graphify/tests/fixtures/xaml_viewmodel/Views/DesignView.xaml:d:DataContext - cross-file binding to DesignViewModel.cs

# ArtifactExtractionHeuristics: Technical Insight Document

## What It Is

ArtifactExtractionHeuristics is the heuristic classification layer implemented primarily in `src/ontology/heuristics/EntityPatternAnalyzer.ts`, with a secondary, structurally analogous instance in `scripts/knowledge-management/verify-patterns.sh`. At its core, this entity is responsible for taking raw artifact strings (file paths, npm package names, class names) and resolving them into team ownership and entity-class classifications with an associated confidence score. The primary mechanism lives in `analyzeEntityPatterns()`, which orchestrates a two-tier resolution strategy — a high-confidence local artifact match (0.9) followed by a lower-confidence regex pattern match (0.75) — over artifacts accumulated by `extractArtifacts()`. A parallel, independently-implemented version of this "extract-then-classify" concept exists in verify-patterns.sh, which performs compliance scoring by counting pattern occurrences via `rg`/`grep` rather than TypeScript regexes.

This component sits under the parent ConfigDrivenFeatureFlags concept but represents an inversion of that pattern's stated intent: rather than externalizing classification rules to something like `config/feature-profiles.yaml`, the rules are embedded directly as executable TypeScript and shell logic.

## Architecture and Design

The dominant architectural pattern is "rules-as-data," but critically undermined by the fact that the data is not actually data — it's TypeScript object literals and shell conditionals baked into control flow. This is most visible in the constructor of EntityPatternAnalyzer.ts, which builds the `teamDirectories: Map<string, string[]>` (detailed by sibling HardcodedTeamDirectoryMap) and `artifactPatterns: ArtifactPattern[]` (detailed by sibling ArtifactPatternRegistry) as in-memory literals rather than parsed external configuration.

The confidence-tiered fallback chain — local artifact match first, regex match second — is a deliberate design choice for prioritizing precision, but it introduces a subtle architectural risk: match confidence is order-dependent rather than computed as a global maximum. Since `extractArtifacts()` accumulates artifacts into a `Set` in a fixed sequence (file paths, npm packages, Service/Agent/Manager-suffixed class names, then bare directory prefixes), and `analyzeEntityPatterns()` iterates with early `return`, the classification outcome for a string matching multiple regex categories depends on insertion order rather than any explicit priority ranking. This is an undocumented coupling between four independent regexes and the final output.

verify-patterns.sh echoes this same tension at the shell-script level: it has one genuinely dynamic extensibility point — iterating `PATTERNS` read via `jq -r` from `$SHARED_MEMORY` — but that dynamism collapses into a hardcoded two-branch `case` statement (`*Logging*`, `*Redux*|*State*`), meaning the declarative JSON input is largely decorative for any pattern name outside those substrings.

## Implementation Details

Within EntityPatternAnalyzer.ts, `checkLocalArtifact()` and `matchArtifactPattern()` are the two resolution primitives called from `analyzeEntityPatterns()`. The former does prefix matching against `teamDirectories` entries; the latter iterates `artifactPatterns` and tests each `RegExp`. Both ultimately need to resolve an entity class, but they do so via two independently maintained maps: each `ArtifactPattern`'s embedded `entityClassMap` (e.g., Coding's `{ LSL: 'LSLSession', Constraint: 'ConstraintRule', ... }`), and the separate `teamMappings` record inside `inferEntityClass()` (with prefix keys like `LSL`, `Constraint`, `Kubernetes`, `Virtual`, `Agent`, `Lambda`). These are structurally parallel but not code-shared, so adding a new artifact type requires synchronized edits in both places — a duplication hazard flagged explicitly as a maintenance risk.

Compounding this, the four-team taxonomy (Coding, RaaS, ReSi, UI) encoded across `teamDirectories` and `artifactPatterns` is already inconsistent with `inferEntityClass()`'s `teamMappings`, which references an 'Agentic' team absent from the other two structures — direct evidence that the catalog has drifted internally even without external config changes.

In verify-patterns.sh, the implementation mechanics are shell-native: raw counts (`CONSOLE_LOG_COUNT`, `LOGGER_COUNT`, `USESTATE_COUNT`, `REDUX_COUNT`, `NETWORK_CHECK`, `UNDOCUMENTED_FUNCTIONS`) are computed via `rg`/`grep`, folded into `TOTAL_CHECKS`/`PASSED_CHECKS`, and reduced to a single `SCORE=$((PASSED_CHECKS * 100 / TOTAL_CHECKS))`. Each check's gating logic (e.g., the Redux check's `grep -q "react" package.json` guard) is hardcoded inline, mirroring EntityPatternAnalyzer.ts's embedded-rules limitation. The script also implements a three-tier environment-variable fallback (`CODING_TOOLS_PATH` → `CODING_REPO` → computed default) for path resolution — a genuinely 12-factor-style idiom, standing in contrast to the hardcoded classification logic elsewhere in the same file.

## Integration Points

ArtifactExtractionHeuristics depends directly on its two child/sibling structures, HardcodedTeamDirectoryMap and ArtifactPatternRegistry, which supply the raw lookup tables consumed by `checkLocalArtifact()` and `matchArtifactPattern()` respectively. Its behavior is also tightly coupled to `extractArtifacts()`'s regex accumulation order, an implicit rather than explicit dependency.

verify-patterns.sh integrates with `$SHARED_MEMORY` via a `jq` query as its one external-data touchpoint, and with the surrounding repo structure via environment-variable-driven path resolution (`CLAUDE_REPO` fallback chain). Both the TypeScript and shell implementations are conceptually tied to the parent ConfigDrivenFeatureFlags theme, though both deviate from it by keeping enforcement logic imperative and hardcoded rather than externally configurable.

Notably, the graphify XAML/C# fixtures (`DesignViewModel.cs`, `DesignView.xaml`, linked only via the `d:DataContext` binding to `Demo.ViewModels`) have no functional relationship to this entity and should be treated as retrieval noise rather than integration points.

## Usage Guidelines

Developers extending team or artifact coverage must edit `src/ontology/heuristics/EntityPatternAnalyzer.ts` directly and redeploy — there is no config-file PR path today, despite the parent ConfigDrivenFeatureFlags naming suggesting one should exist. Any new artifact type must be added consistently to at least three locations to avoid silent divergence: `teamDirectories`, the relevant `ArtifactPattern.entityClassMap`, and `inferEntityClass()`'s `teamMappings`. The existing 'Agentic' team inconsistency should be treated as a concrete example of what happens when this isn't done.

Because match confidence is implicitly order-dependent rather than globally maximized, developers should not assume the highest-confidence match always wins — sequence in `extractArtifacts()` matters. When modifying verify-patterns.sh, recognize that the `jq`/`$SHARED_MEMORY`-driven `PATTERNS` loop only meaningfully handles `*Logging*` and `*Redux*|*State*` substrings; extending it to new pattern types requires adding new hardcoded `case` branches, not just new JSON entries. Finally, when tracing evidence for this component, exclude the graphify XAML/C# fixtures from architectural reasoning — they are unrelated retrieval artifacts, not design signals.


## Hierarchy Context

### Parent
- [ConfigDrivenFeatureFlags](./ConfigDrivenFeatureFlags.md) -- [LLM] The EntityPatternAnalyzer class in src/ontology/heuristics/EntityPatternAnalyzer.ts embodies the config-driven feature flags idea from the parent context, but inverted: instead of an external YAML/JSON file like config/feature-profiles.yaml, the classification rules are hardcoded as in-memory data structures (`teamDirectories: Map<string, string[]>` and `artifactPatterns: ArtifactPattern[]`) built inside the constructor. This is a notable deviation from the declarative-config convention described for OntologyClassifier and SensitivityClassifier elsewhere in the codebase — here the 'declarative catalog' is TypeScript object literals rather than a parseable file, meaning changes to team ownership (e.g., adding a new team or artifact pattern) require a code change and rebuild rather than a config PR, undermining the stated goal of behavior changes shipping without TypeScript/JS edits.

### Siblings
- [HardcodedTeamDirectoryMap](./HardcodedTeamDirectoryMap.md) -- [LLM] EntityPatternAnalyzer's constructor (src/ontology/heuristics/EntityPatternAnalyzer.ts) hardcodes team ownership as a `Map<string, string[]>` (`teamDirectories`) mapping four teams — Coding, RaaS, ReSi, UI — to literal directory-prefix strings (e.g. 'src/ontology', 'raas-service', 'virtual-target', 'curriculum-alignment'). This is a compile-time catalog: adding a fifth team, renaming a directory, or moving 'scripts' under a different team requires editing this TypeScript file and rebuilding, in direct contrast to the config/feature-profiles.yaml pattern the parent context attributes to OntologyClassifier and SensitivityClassifier. The component's own name ('HardcodedTeamDirectoryMap') captures this precisely.
- [ArtifactPatternRegistry](./ArtifactPatternRegistry.md) -- [LLM] EntityPatternAnalyzer's constructor (src/ontology/heuristics/EntityPatternAnalyzer.ts) builds two parallel but structurally divergent lookup tables: `teamDirectories: Map<string, string[]>` (a flat list of path prefixes per team) and `artifactPatterns: ArtifactPattern[]` (an array of `{team, patterns: RegExp[], entityClassMap}` objects). These are consumed by two different private methods — `checkLocalArtifact()` iterates `teamDirectories.entries()` and does an `Array.prototype.some(dir => artifact.startsWith(dir))` check, while `matchArtifactPattern()` iterates `artifactPatterns` and runs `pattern.test(artifact)` for each regex. Maintaining team-ownership knowledge in two separate, differently-shaped structures (one string-prefix based, one regex based) means a new artifact type belonging to an existing team may need edits in both places to be reliably classified at high confidence (0.9) rather than falling through to the lower-confidence (0.75) regex tier.


---

*Generated from 9 observations*
