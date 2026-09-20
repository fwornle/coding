# TeamEntitySuffixMap

**Type:** Detail

# TeamEntitySuffixMap — Technical Insight Document

## What It Is

`TeamEntitySuffixMap` is the concrete naming vocabulary that maps team ownership to entity-class suffix conventions, implemented as two structurally different, parallel dictionaries inside `src/ontology/heuristics/EntityPatternAnalyzer.ts`: the `teamMappings` record inside the private `inferEntityClass()` method (lines 230-260), and the `entityClassMap` embedded in each entry of the `artifactPatterns` array (lines 48-106). Together these encode which naming suffix (e.g. `Service`, `Manager`, `Cluster`, `Workflow`) belongs to which team's entity taxonomy — for example RaaS's `{ Kubernetes: 'KubernetesCluster', Argo: 'ArgoWorkflowTemplate' }` or the (currently unreachable) `Agentic` team's `{ Agent: 'AgentFramework', RAG: 'RAGSystem', LLM: 'LLMProvider', Vector: 'VectorStore' }`. As a child concept of its parent NamingConventions, it is the data layer that operationalizes suffix-based naming (Manager/Service/Adapter/etc.) into a machine-consumable team-attribution table.

## Architecture and Design

The defining architectural trait is duplication-by-necessity: the same team-to-suffix knowledge is encoded twice, once for the 0.9-confidence path (`checkLocalArtifact()` → `inferEntityClass()`) and once for the 0.75-confidence path (`matchArtifactPattern()` → per-pattern `entityClassMap`). This mirrors the sibling ArtifactPatternRegistry's own two-tier confidence design, but at the vocabulary level rather than the matching-strategy level. No shared constant unifies the two dictionaries, so the map exists as tribal knowledge distributed across two private methods that happen to agree today (verified for the Coding team: `LSL/Constraint/Knowledge/MCP` map identically in both).

This split is compounded by team-ownership data itself being split across two differently-shaped constructs — the `teamDirectories` Map (path-based) and the `artifactPatterns` array (regex-based) — meaning full team coverage requires symmetric edits across three places, not two. The `Agentic` entry in `teamMappings` demonstrates what happens when that symmetry breaks: it was added to the entity-class dictionary but never wired into `teamDirectories` or `artifactPatterns`, leaving it structurally dead code, since `checkLocalArtifact()` can only call `inferEntityClass(artifact, team)` with a `team` already validated against `teamDirectories.entries()`.

## Implementation Details

`inferEntityClass()` is invoked only from the high-confidence path gated by `checkLocalArtifact()`'s `startsWith()`-based directory match — meaning the suffix map only fires once a directory-shaped artifact has already been attributed to a team via `teamDirectories`. The parallel `entityClassMap` per `ArtifactPattern` object is consulted by `matchArtifactPattern()`'s `.test()`-based regex matcher, independent of directory location. Both mappers ultimately produce an `entityClass` string that feeds into the `ArtifactMatch` result inside `analyzeEntityPatterns()`'s `LayerResult` (layer: 1, layerName: 'EntityPatternAnalyzer').

Because `extractArtifacts()` merges file paths, npm packages, class names, and directory strings into one untyped `Set<string>` with no source tagging, the suffix map's correctness depends entirely on the *shape* of the string reaching it — a class-shaped string reaches `matchArtifactPattern()`, a path-shaped one reaches `checkLocalArtifact()`/`inferEntityClass()`. There is no explicit type discrimination; the partition is implicit and shape-based.

## Integration Points

`TeamEntitySuffixMap`'s dictionaries are consumed exclusively within `EntityPatternAnalyzer.ts` and have no external dependencies beyond `../types.js` (`LayerResult`, `ArtifactMatch`), consistent with the class's documented <1ms, pure-synchronous, no-I/O budget. It integrates with the sibling ArtifactPatternRegistry by supplying the `entityClassMap` payload each `ArtifactPattern` carries, and with the parent NamingConventions by giving the abstract suffix rules (Manager/Service/Adapter) concrete per-team semantics. Notably, it has no visibility into naming conventions outside the TS/JS-centric `filePathPattern` scope — the `integrations/graphify/tests/fixtures/xaml_viewmodel/` fixtures (`DesignViewModel.cs`, `DesignView.xaml`) using MVVM `*ViewModel`/`*View` suffixes are entirely unrecognized by this map, illustrating a scope boundary rather than a bug.

## Usage Guidelines

Any change to a team's naming vocabulary must be applied in both `teamMappings` (inside `inferEntityClass()`) and the corresponding `artifactPatterns[].entityClassMap` entry — failing to update both will silently desync the 0.9 and 0.75 confidence paths. Before adding a new team's suffix vocabulary (as was apparently attempted with `Agentic`), developers must also register that team in `teamDirectories` and add a corresponding `artifactPatterns` entry, or the new mappings will be unreachable dead code. Given the order-dependent, first-match-wins behavior of `analyzeEntityPatterns()` (noted in the ArtifactPatternRegistry sibling analysis), suffix ambiguity across teams should be avoided — overlapping suffixes across teams can cause misattribution based on Set iteration order rather than explicit precedence. Finally, since this map only covers suffixes reachable through TS/JS-style regexes, extending coverage to other language ecosystems (e.g. MVVM `.cs`/`.xaml` conventions) would require a new extraction pattern in `extractArtifacts()`, not just an addition to the suffix dictionaries themselves.


## Hierarchy Context

### Parent
- [NamingConventions](./NamingConventions.md) -- [LLM] `src/ontology/heuristics/EntityPatternAnalyzer.ts` operationalizes the project's suffix-naming conventions described in the parent context (Manager/Service/Adapter) as a machine-readable classification heuristic. Its `extractArtifacts()` method uses a regex `[A-Z][a-zA-Z]+(Service|Agent|Manager|Engine|Handler|Analyzer|Classifier|Filter|Monitor)` to pull class names directly out of free-text knowledge content, then `matchArtifactPattern()` maps those names to a team and an inferred `entityClass` via the `artifactPatterns` array. This means naming conventions in this codebase are not just a human-readability aid — they are load-bearing for an automated team/entity-attribution pipeline (Layer 1 of what is implied to be a multi-layer classification system, given `layer: 1` and `layerName: 'EntityPatternAnalyzer'` in the returned `LayerResult`). A class that doesn't follow the established suffix vocabulary becomes invisible to this classifier.

### Siblings
- [ArtifactPatternRegistry](./ArtifactPatternRegistry.md) -- [LLM] `EntityPatternAnalyzer.extractArtifacts()` (src/ontology/heuristics/EntityPatternAnalyzer.ts) builds its artifact set from four independent regex passes — file paths (`filePathPattern`), npm scopes (`npmPattern`), suffix-based class names (`classPattern`), and bare directory prefixes (`dirPattern`) — all merged into one `Set<string>`. Because `analyzeEntityPatterns()` iterates that set and returns on the *first* artifact that produces either a `checkLocalArtifact()` or `matchArtifactPattern()` hit, the classification result is order-dependent on `Set` iteration order (insertion order in V8), meaning a knowledge string containing both a real file path (`src/ontology/foo.ts`) and a coincidental class-name match (`FooBarService`) will attribute team ownership based on whichever regex happened to match text earlier in the string, not on any explicit precedence rule.


---

*Generated from 9 observations*
