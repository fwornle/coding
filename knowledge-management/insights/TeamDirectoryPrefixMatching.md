# TeamDirectoryPrefixMatching

**Type:** Detail

# TeamDirectoryPrefixMatching — Technical Insight Document

## What It Is

TeamDirectoryPrefixMatching is the concrete implementation of directory-prefix-based team resolution found in `checkLocalArtifact()` within `src/ontology/heuristics/EntityPatternAnalyzer.ts` (approximately lines 185-197). It works by iterating a precomputed `teamDirectories` Map (constructed in the class constructor, lines 38-63) that associates team names — `Coding`, `RaaS`, `ReSi`, `UI` — with arrays of directory-prefix strings (e.g., `'Coding' → ['src/ontology', 'src/knowledge-management', 'src/live-logging', 'scripts', '.specstory']`). For each artifact string extracted from content, the function tests `dirs.some((dir) => artifact.startsWith(dir))` across each team's directory list, returning the first team whose prefixes match. This is the mechanism that anchors Layer 1 of the ontology heuristics classification pipeline, serving as the fastest and highest-confidence (0.9) matching strategy in its parent component, OntologyHeuristicsLayering.

## Architecture and Design

The design follows a static in-memory lookup table pattern combined with a chain-of-responsibility / ordered-strategy pattern. The `teamDirectories` Map is built once at construction time from hardcoded TypeScript object literals and is never mutated — there's no public API to add, remove, or query prefixes, and no config-file loading path. This is a deliberate (if perhaps unintentional) divergence from the parent component's own convention that "tunable behavior belongs in config/*.yaml".

Within `analyzeEntityPatterns()`, `checkLocalArtifact()` is always tried before the more expensive `matchArtifactPattern()` regex-based strategy — a first-match-wins short-circuit that protects the class's documented "<1ms response time" budget. This ordering choice is explicitly a speed-over-exhaustiveness trade-off: an artifact satisfying both a directory prefix and a regex class-name pattern will always resolve via the cheaper prefix path and never reach the regex evaluation, since the two strategies are not merged or compared for best confidence. This same fixed ordering is documented independently in the sibling entity TieredArtifactMatchOrdering, which further notes that the tiering operates per-artifact within the loop rather than globally — meaning both cheap and expensive checks may be repeated across many low-signal artifacts extracted upstream.

## Implementation Details

The matching itself is a naive O(teams × directories-per-team) linear scan — no trie, no sorted-prefix binary search, no memoization. With only 4 teams and roughly 3-4 directories each (about 12 total prefixes), this cost is negligible, but the implementation re-walks the entire Map on every artifact for every knowledge-content analysis call.

Matching uses plain `String.prototype.startsWith()` rather than path-boundary-aware comparison (e.g., `artifact.startsWith(dir + '/')`). This means a prefix like `'raas-service'` would erroneously match `'raas-service-extended/foo.ts'`, even though no such collision currently exists among the 12 literal prefixes — the vulnerability is structural, not presently realized.

Confidence scoring is a hardcoded constant (0.9) applied uniformly regardless of match specificity: a match against a one-character directory would score identically to a match against a long, highly-specific path. Downstream, the resolved `team` string feeds into `inferEntityClass(artifact, team)`, which consults a `teamMappings` table. Notably, this table contains an orphaned `Agentic` entry that can never be reached through this call path, since `team` is always constrained to the four keys present in `teamDirectories` — confirming that prefix matching's output is the sole gate controlling which entity-class sub-table gets consulted.

The artifacts fed into this matching logic originate from `extractArtifacts()`, documented under the sibling entity ArtifactPatternRegistry, which runs four independent regex passes (`filePathPattern`, `npmPattern`, `classPattern`, `dirPattern`) into a shared `Set<string>`. Because `classPattern` omits "Adapter" from its suffix list, some artifacts (e.g., `TranscriptAdapter`) may never even reach the prefix-matching stage in a recognizable form, though `dirPattern`/`filePathPattern` extraction may still surface them via path references.

## Integration Points

TeamDirectoryPrefixMatching is invoked exclusively from `analyzeEntityPatterns()`, which orchestrates the two-strategy pipeline described in OntologyHeuristicsLayering. It depends on artifacts pre-extracted by `extractArtifacts()` (ArtifactPatternRegistry) and hands its resolved `team` value directly to `inferEntityClass()`, coupling this component tightly to the shape and coverage of the `teamMappings` table. It has no external dependencies, no config loading, and no mutation interface — it is a pure, static, closed lookup embedded in source.

## Usage Guidelines

Developers modifying team-directory mappings must edit the constructor literals directly and redeploy; there is no runtime or config-driven mechanism. Anyone adding new prefixes should be mindful of the missing path-boundary check — new directory names should avoid being literal prefixes of each other's sibling directories to prevent silent misclassification. Because confidence is fixed per strategy rather than derived from specificity, this component should not be relied upon for fine-grained confidence differentiation; it only distinguishes "prefix matched" from "regex matched," not match quality within a strategy. Given the first-match-wins short-circuit, ordering of directory entries and artifact extraction order both matter for which team "wins" when multiple signals are present — this should inform any future refactor toward trie-based or scored/merged matching, especially if team count or directory counts grow beyond the current small, hardcoded scale.


## Hierarchy Context

### Parent
- [OntologyHeuristicsLayering](./OntologyHeuristicsLayering.md) -- [LLM] `EntityPatternAnalyzer` (src/ontology/heuristics/EntityPatternAnalyzer.ts) implements Layer 1 of a multi-layer, confidence-scored classification pipeline: its own docstring labels it 'Layer 1: File/Artifact Detection' with a documented <1ms target. The two public-facing code paths — `checkLocalArtifact()` (returns confidence 0.9 for a direct team-directory prefix match) and `matchArtifactPattern()` (returns confidence 0.75 for a regex-based match against `artifactPatterns`) — are tried in that fixed order inside `analyzeEntityPatterns()`, meaning a cheap `startsWith()` check is always preferred over regex evaluation. This ordering is itself an implicit performance optimization: string-prefix checks over the `teamDirectories` Map are O(1)-ish and run before the more expensive `RegExp.test()` loop over `artifactPatterns`, so the sub-millisecond budget is protected by cutting regex work whenever a cheaper match already resolves the team.

### Siblings
- [TieredArtifactMatchOrdering](./TieredArtifactMatchOrdering.md) -- [LLM] The two-tier ordering inside `analyzeEntityPatterns()` (src/ontology/heuristics/EntityPatternAnalyzer.ts) always invokes `checkLocalArtifact()` before `matchArtifactPattern()` for every artifact in the loop, and returns immediately on the first hit. This means the tiering is per-artifact, not per-call: if the first extracted artifact fails both checks, the loop moves to the second artifact and again tries the cheap path first. For content containing many low-signal artifacts (e.g. several generic directory strings from the `dirPattern` regex) before the one that actually matches, the theoretical 'fast path only' benefit degrades because both checks run repeatedly across the artifact list rather than once globally.
- [ArtifactPatternRegistry](./ArtifactPatternRegistry.md) -- [LLM] `EntityPatternAnalyzer.extractArtifacts()` (src/ontology/heuristics/EntityPatternAnalyzer.ts) runs four independent regex passes over the same content string — `filePathPattern`, `npmPattern`, `classPattern`, and `dirPattern` — each populated into a shared `Set<string>` before any matching begins. This means the documented '<1ms response time' budget in the file's header docstring is spent primarily on regex extraction, not on the team-matching logic in `checkLocalArtifact()`/`matchArtifactPattern()`. Because `classPattern` is `/[A-Z][a-zA-Z]+(Service|Agent|Manager|Engine|Handler|Analyzer|Classifier|Filter|Monitor)/g` and omits 'Adapter', any content mentioning `TranscriptAdapter` or `SpecstoryAdapter` is invisible to this layer even though `dirPattern` and `filePathPattern` might still catch a full path reference to the same class — the four extraction patterns have inconsistent recall depending on how the artifact is textually referenced.


---

*Generated from 9 observations*
