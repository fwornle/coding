# TieredArtifactMatchOrdering

**Type:** Detail

# TieredArtifactMatchOrdering: Technical Insight Document

## What It Is

TieredArtifactMatchOrdering describes the structural ordering rule enforced inside `analyzeEntityPatterns()` in `src/ontology/heuristics/EntityPatternAnalyzer.ts`: for every artifact extracted from content, `checkLocalArtifact()` (Tier 1) is invoked before `matchArtifactPattern()` (Tier 2), and the loop returns immediately on the first successful match. As a child concept of the parent component OntologyHeuristicsLayering — which implements "Layer 1: File/Artifact Detection" in a broader confidence-scored classification pipeline — this ordering is the mechanism by which that layer claims its documented sub-millisecond performance budget. It sits alongside sibling components TeamDirectoryPrefixMatching (the Tier 1 implementation) and ArtifactPatternRegistry (the Tier 2 implementation and the upstream artifact-extraction logic), and effectively governs how those two siblings are sequenced and short-circuited against each other.

## Architecture and Design

The design is a Chain-of-Responsibility-like tiered matcher: `checkLocalArtifact()` then `matchArtifactPattern()`, first success wins, with confidence scores forming an implicit ladder (0.9 for direct/local match, 0.75 for pattern match). Critically, the observations reveal this "ladder" framing is partly illusory — Tier 1 and Tier 2 largely cover disjoint artifact shapes rather than two confidence levels for the same signal. `checkLocalArtifact()` only matches artifacts that are file-path-shaped (via `startsWith()` against `teamDirectories` prefixes), while `matchArtifactPattern()` is the only tier able to match bare class names like `LSLSession` through `artifactPatterns` regexes. So "always try cheap-first" mostly matters for path-shaped artifacts; name-shaped artifacts fail Tier 1 unconditionally before ever reaching Tier 2.

The ordering is enforced structurally within the per-artifact `for` loop rather than via any pluggable strategy list, and team/directory/pattern mappings are embedded as TypeScript literals — data-as-configuration-in-code rather than externalized config. The early-return design also makes the tiers mutually exclusive per artifact: once `checkLocalArtifact()` succeeds, `matchArtifactPattern()` is never consulted for that artifact, foreclosing any cross-checking between mechanisms (e.g., a path like `raas-service/ArgoWorkflow.ts` matching `RaaS` via directory prefix is never verified against the `Argo` pattern also mapped to `RaaS`).

## Implementation Details

The artifact list itself is populated by `extractArtifacts()` running four independent regex passes (`filePathPattern`, `npmPattern`, `classPattern`, `dirPattern`) merged into a single `Set`, as detailed in sibling ArtifactPatternRegistry. The tiered ordering operates over this list in `Array.from(artifacts)` insertion order — an accident of regex execution sequence, not an explicit relevance ranking. This means an early, low-value artifact (e.g., a bare directory match like `scripts/` from `dirPattern`) can win classification over a later, more specific class name, since the loop exits on the first hit across *any* artifact, not the best one.

Confidence values are duplicated: `checkLocalArtifact()` already encodes `confidence: 0.9` in the `ArtifactMatch` it constructs, yet `analyzeEntityPatterns()` separately hardcodes `0.9` again in the `LayerResult` literal at the call site, ignoring the field it was just handed. The same pattern likely applies to the 0.75 value for `matchArtifactPattern()`. This redundancy means tuning either constant requires coordinated edits in two places or the values silently diverge.

## Integration Points

TieredArtifactMatchOrdering is the connective logic between its two sibling components: TeamDirectoryPrefixMatching (Tier 1, a naive O(teams × dirs-per-team) linear scan over `teamDirectories.entries()`) and ArtifactPatternRegistry (Tier 2's `matchArtifactPattern()`, plus the upstream `extractArtifacts()` four-pass regex extraction that feeds the loop). It is entirely contained within `EntityPatternAnalyzer.ts` and depends on the parent OntologyHeuristicsLayering pipeline's Layer 1 designation and its `<1ms` performance contract, which this ordering is meant to protect but does not strictly guarantee.

## Usage Guidelines

Developers should recognize that the tiered ordering is not a pure performance shortcut over equivalent signals — it is a shape-based dispatch (path vs. name) dressed as a confidence ladder, so reordering the tiers or assuming equivalence between them is unsafe. Any change to confidence constants must be applied at both the `ArtifactMatch` construction site inside `checkLocalArtifact()` and the `LayerResult` literals in `analyzeEntityPatterns()`. Because match order depends on regex-extraction order rather than artifact relevance, and because the loop forecloses cross-tier verification, this layer should be treated as a fast, approximate first pass whose "first match wins" result is not necessarily the strongest signal available — pathological inputs with many non-matching artifact-shaped substrings can also force up to 20 `RegExp.test()` calls per artifact, threatening the advertised sub-millisecond budget in the absence of any cap on artifacts tried.


## Hierarchy Context

### Parent
- [OntologyHeuristicsLayering](./OntologyHeuristicsLayering.md) -- [LLM] `EntityPatternAnalyzer` (src/ontology/heuristics/EntityPatternAnalyzer.ts) implements Layer 1 of a multi-layer, confidence-scored classification pipeline: its own docstring labels it 'Layer 1: File/Artifact Detection' with a documented <1ms target. The two public-facing code paths — `checkLocalArtifact()` (returns confidence 0.9 for a direct team-directory prefix match) and `matchArtifactPattern()` (returns confidence 0.75 for a regex-based match against `artifactPatterns`) — are tried in that fixed order inside `analyzeEntityPatterns()`, meaning a cheap `startsWith()` check is always preferred over regex evaluation. This ordering is itself an implicit performance optimization: string-prefix checks over the `teamDirectories` Map are O(1)-ish and run before the more expensive `RegExp.test()` loop over `artifactPatterns`, so the sub-millisecond budget is protected by cutting regex work whenever a cheaper match already resolves the team.

### Siblings
- [TeamDirectoryPrefixMatching](./TeamDirectoryPrefixMatching.md) -- [LLM] `checkLocalArtifact()` in src/ontology/heuristics/EntityPatternAnalyzer.ts implements team-directory prefix matching by iterating `this.teamDirectories.entries()` and testing `dirs.some((dir) => artifact.startsWith(dir))`. This is a naive O(teams × dirs-per-team) linear scan rather than a trie or sorted-prefix binary search — for the current 4 teams and ~3-4 directories each (12 total prefixes) this is negligible, but the design does not scale: it re-walks the full Map on every artifact for every knowledge-content analysis call, with no memoization or precomputed prefix index (e.g., a sorted array with binary search, or a Trie keyed by path segment).
- [ArtifactPatternRegistry](./ArtifactPatternRegistry.md) -- [LLM] `EntityPatternAnalyzer.extractArtifacts()` (src/ontology/heuristics/EntityPatternAnalyzer.ts) runs four independent regex passes over the same content string — `filePathPattern`, `npmPattern`, `classPattern`, and `dirPattern` — each populated into a shared `Set<string>` before any matching begins. This means the documented '<1ms response time' budget in the file's header docstring is spent primarily on regex extraction, not on the team-matching logic in `checkLocalArtifact()`/`matchArtifactPattern()`. Because `classPattern` is `/[A-Z][a-zA-Z]+(Service|Agent|Manager|Engine|Handler|Analyzer|Classifier|Filter|Monitor)/g` and omits 'Adapter', any content mentioning `TranscriptAdapter` or `SpecstoryAdapter` is invisible to this layer even though `dirPattern` and `filePathPattern` might still catch a full path reference to the same class — the four extraction patterns have inconsistent recall depending on how the artifact is textually referenced.


---

*Generated from 9 observations*
