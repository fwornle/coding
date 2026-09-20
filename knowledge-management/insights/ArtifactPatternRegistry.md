# ArtifactPatternRegistry

**Type:** Detail

# ArtifactPatternRegistry — Technical Insight Document

## What It Is

ArtifactPatternRegistry refers to the collection of hardcoded, in-memory classification tables that drive team-ownership inference in `src/ontology/heuristics/EntityPatternAnalyzer.ts`, along with a parallel compliance-scoring mechanism in `scripts/knowledge-management/verify-patterns.sh`. At its core, the registry consists of the `teamDirectories: Map<string, string[]>` and `artifactPatterns: ArtifactPattern[]` structures built inside `EntityPatternAnalyzer`'s constructor, which together encode a four-team ownership taxonomy (Coding, RaaS, ReSi, UI). These are consumed by `checkLocalArtifact()` (prefix matching) and `matchArtifactPattern()` (regex matching) respectively, both invoked from the orchestrating method `analyzeEntityPatterns()`. A structurally similar but functionally disconnected pattern registry exists in `verify-patterns.sh`, where a dynamically loaded `PATTERNS` list (sourced via `jq` from `$SHARED_MEMORY`) coexists with hardcoded compliance checks.

As the Detail-level entity under parent ConfigDrivenFeatureFlags, ArtifactPatternRegistry is best understood as the concrete embodiment (and inversion) of that parent's declarative-config philosophy — expressed here as TypeScript object literals and shell variables rather than YAML/JSON.

## Architecture and Design

The dominant architectural pattern is a **confidence-tiered fallback chain**: direct/prefix matches via `checkLocalArtifact()` yield 0.9 confidence, while regex matches via `matchArtifactPattern()` fall back to 0.75. This tiering is implemented as sequential method calls inside `analyzeEntityPatterns()`, which short-circuits on the **first** artifact that satisfies either check — a first-match-wins design that never considers whether a later candidate would produce a higher-confidence or more relevant team match.

Feeding this fallback chain is `extractArtifacts()`, which merges four independently-built regexes (`filePathPattern`, `npmPattern`, `classPattern`, `dirPattern`) into a single `Set<string>`. Because V8 preserves insertion order in `Set` iteration and the four `content.match()` calls run sequentially, `filePathPattern` matches are always tried first downstream — an implicit ordering dependency baked into extraction order rather than an explicit priority scheme.

This is a classic **rules-as-data** pattern, but critically the "data" lives inside TypeScript literals rather than an external file — as sibling components HardcodedTeamDirectoryMap and ArtifactExtractionHeuristics both note. This directly inverts the declarative-config convention attributed to OntologyClassifier and SensitivityClassifier under parent ConfigDrivenFeatureFlags, where behavior changes are supposed to ship via config PRs rather than code+rebuild cycles.

In `verify-patterns.sh`, the analogous architectural idea is a shell-based compliance auditor that partially reads pattern definitions dynamically (via `jq` against `$SHARED_MEMORY`) but computes its numeric score from a separate, hardcoded set of four checks — an incomplete realization of the config-driven ideal.

## Implementation Details

`EntityPatternAnalyzer`'s constructor builds two structurally divergent lookup tables for the same conceptual data (team ownership): a flat `Map<string, string[]>` of path prefixes, and an array of `{team, patterns: RegExp[], entityClassMap}` objects. `checkLocalArtifact()` iterates `teamDirectories.entries()` using `Array.prototype.some(dir => artifact.startsWith(dir))`, while `matchArtifactPattern()` iterates `artifactPatterns` running `pattern.test(artifact)` per regex — two different traversal and matching strategies over what should be one source of truth.

A third, orphaned table lives inside `inferEntityClass()`: its own `teamMappings: Record<string, Record<string, string>>` literal defines an `Agentic` team branch (`Agent: 'AgentFramework'`, `RAG: 'RAGSystem'`, etc.) that has no corresponding entry in `teamDirectories` or `artifactPatterns`. Since `checkLocalArtifact()` only calls `inferEntityClass(artifact, team)` with a `team` already sourced from `teamDirectories`, this branch is unreachable dead code — clear evidence, per ArtifactExtractionHeuristics, that the catalog has already drifted internally.

`extractArtifacts()`'s four regexes have distinct shapes: `filePathPattern` requires a two-segment lowercase-hyphen prefix before an extension, `npmPattern` matches scoped npm packages (`@[a-z-]+/[a-z-]+`), `classPattern` suffix-matches common class-name endings (Service, Agent, Manager, Engine, Handler, Analyzer, Classifier, Filter, Monitor), and `dirPattern` matches bare two-segment directory prefixes. Their results are unioned into a `Set` and iterated in `analyzeEntityPatterns()`'s `for (const artifact of artifacts)` loop with first-match short-circuiting — creating a two-layer ordering dependency (extraction order, then team/pattern iteration order in `matchArtifactPattern`'s nested loop) invisible from the public `LayerResult` API.

On the shell side, `verify-patterns.sh` computes `CONSOLE_LOG_COUNT`, `LOGGER_COUNT`, `USESTATE_COUNT`, `REDUX_COUNT`, `NETWORK_CHECK`, and `UNDOCUMENTED_FUNCTIONS` inside conditionally-guarded blocks (`if [ -f package.json ]`, `if [ -f install.sh ]`), then references them later in a `case` statement gated by `$SHARED_MEMORY` availability — risking an unbound-variable abort under `set -euo pipefail` (`nounset`) if invoked in a repo lacking those files. Separately, `((PASSED_CHECKS++))` post-increment evaluates to the pre-increment value as exit status, meaning the first invocation with `PASSED_CHECKS=0` returns exit code 1, which under `set -euo pipefail` (line 5) can abort the entire script on the very first, fully-compliant check.

## Integration Points

`EntityPatternAnalyzer` has no external dependencies beyond `../types.js` (`LayerResult`, `ArtifactMatch`) — it is self-contained but code-coupled, since all classification data is constructed inline rather than loaded from configuration. This makes it structurally distinct from — yet thematically part of — the parent ConfigDrivenFeatureFlags grouping, which frames OntologyClassifier and SensitivityClassifier as the config-file-driven norm this entity deviates from.

Within its own file, the two sibling structures (teamDirectories, artifactPatterns) and the orphaned `teamMappings` inside `inferEntityClass()` must be manually kept in sync — there is no shared schema or single source of truth enforcing consistency across the three.

`verify-patterns.sh` integrates with an external `$SHARED_MEMORY` JSON store via `jq -r '.entities[] | select(.entityType == "TransferablePattern" and .significance >= 8) | .name'`, plus a three-tier environment-variable fallback (`CLAUDE_REPO="${CODING_TOOLS_PATH:-${CODING_REPO:-$DEFAULT_REPO}}"`) for repo-root resolution, itself dependent on the script's fixed location two levels under the repo root within `scripts/knowledge-management/`.

Note: files under `integrations/graphify/tests/fixtures/xaml_viewmodel/` (`DesignViewModel.cs`, `DesignView.xaml`) appear alongside these observations but are unrelated WPF design-time fixtures — a retrieval-precision artifact, not a genuine integration point.

## Usage Guidelines

Developers extending team coverage in `EntityPatternAnalyzer` must edit **both** `teamDirectories` and `artifactPatterns` to guarantee correct classification at the high-confidence (0.9) tier; editing only one risks silent fallback to the lower-confidence (0.75) regex tier or no match at all. Any new "Agentic"-style team should be added consistently across all three tables (`teamDirectories`, `artifactPatterns`, and `inferEntityClass`'s `teamMappings`) to avoid reintroducing dead branches.

Because `analyzeEntityPatterns()` short-circuits on first match, and `extractArtifacts()`'s regex-run order deterministically biases which candidate is tried first, ambiguous content referencing multiple teams' artifacts will resolve unpredictably without reading the implementation — this should be treated as a known limitation, not a bug to route around at the call site.

For `verify-patterns.sh`, maintainers should treat the dynamically-loaded `PATTERNS` list as reporting-only; it currently has no effect on `SCORE`, so relying on it to enforce compliance is a misunderstanding of current behavior. The `((PASSED_CHECKS++))` pattern should be considered unsafe under `set -euo pipefail` and rewritten (e.g., `PASSED_CHECKS=$((PASSED_CHECKS+1))`) to avoid spurious script aborts. Similarly, any invocation environment lacking `package.json` or `install.sh` should be treated as untested/risky given the unguarded later reference to conditionally-set shell variables.


## Hierarchy Context

### Parent
- [ConfigDrivenFeatureFlags](./ConfigDrivenFeatureFlags.md) -- [LLM] The EntityPatternAnalyzer class in src/ontology/heuristics/EntityPatternAnalyzer.ts embodies the config-driven feature flags idea from the parent context, but inverted: instead of an external YAML/JSON file like config/feature-profiles.yaml, the classification rules are hardcoded as in-memory data structures (`teamDirectories: Map<string, string[]>` and `artifactPatterns: ArtifactPattern[]`) built inside the constructor. This is a notable deviation from the declarative-config convention described for OntologyClassifier and SensitivityClassifier elsewhere in the codebase — here the 'declarative catalog' is TypeScript object literals rather than a parseable file, meaning changes to team ownership (e.g., adding a new team or artifact pattern) require a code change and rebuild rather than a config PR, undermining the stated goal of behavior changes shipping without TypeScript/JS edits.

### Siblings
- [HardcodedTeamDirectoryMap](./HardcodedTeamDirectoryMap.md) -- [LLM] EntityPatternAnalyzer's constructor (src/ontology/heuristics/EntityPatternAnalyzer.ts) hardcodes team ownership as a `Map<string, string[]>` (`teamDirectories`) mapping four teams — Coding, RaaS, ReSi, UI — to literal directory-prefix strings (e.g. 'src/ontology', 'raas-service', 'virtual-target', 'curriculum-alignment'). This is a compile-time catalog: adding a fifth team, renaming a directory, or moving 'scripts' under a different team requires editing this TypeScript file and rebuilding, in direct contrast to the config/feature-profiles.yaml pattern the parent context attributes to OntologyClassifier and SensitivityClassifier. The component's own name ('HardcodedTeamDirectoryMap') captures this precisely.
- [ArtifactExtractionHeuristics](./ArtifactExtractionHeuristics.md) -- [LLM] EntityPatternAnalyzer.ts's constructor builds two hardcoded structures — `teamDirectories: Map<string, string[]>` and `artifactPatterns: ArtifactPattern[]` — that together encode a four-team ownership taxonomy (Coding, RaaS, ReSi, UI). This is a classic 'rules-as-data' design, but because the data lives in TypeScript literals rather than an external file, the class conflates the declarative catalog with the executable code, meaning the only way to extend team coverage (e.g., adding an 'Agentic' team, which is referenced in `inferEntityClass`'s `teamMappings` but absent from `artifactPatterns` and `teamDirectories`) is to edit and redeploy this file — an inconsistency that itself signals the catalog is already drifting out of sync internally.


---

*Generated from 11 observations*
