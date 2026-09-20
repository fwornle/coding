# TwoStepArtifactMatching

**Type:** Detail

# TwoStepArtifactMatching: Technical Insight Document

## What It Is

TwoStepArtifactMatching is the core resolution strategy implemented in `EntityPatternAnalyzer.analyzeEntityPatterns()` (`src/ontology/heuristics/EntityPatternAnalyzer.ts`). For each artifact string produced by `extractArtifacts()`, the method attempts a high-confidence lookup via `checkLocalArtifact()` (confidence 0.9) before falling back to a lower-confidence `matchArtifactPattern()` (confidence 0.75), returning on the **first** hit rather than evaluating all candidates and selecting the best. It is a child concept under the parent component `ConfigurationExternalization`, sharing that parent's philosophy of driving classification off declarative data tables — `TeamDirectoryTable` (`teamDirectories`) and `ArtifactPatternRegistry` (`artifactPatterns`) — rather than team-name branching in code.

## Architecture and Design

The nominal architecture is a confidence-tiered fallback: try the cheap, high-confidence check first; if it fails, try the more expensive, lower-confidence regex check. This is explicitly listed as an architectural pattern (early return per artifact, not best-of-all-artifacts). However, the observations reveal this is not a true confidence-maximization system — because `extractArtifacts()` populates a `Set<string>` from four independently ordered regex passes (`filePathPattern`, `npmPattern`, `classPattern`, `dirPattern`), the artifact that happens to be iterated first determines the outcome, not the one that would yield the highest overall confidence. A low-confidence match on an early artifact wins over a high-confidence match on a later one purely due to Set insertion order and regex-pass sequencing.

The two underlying methods are structurally asymmetric despite being framed as symmetric "steps": `checkLocalArtifact()` is an O(teams × prefixes) prefix scan (`dirs.some((dir) => artifact.startsWith(dir))`) against `teamDirectories`, while `matchArtifactPattern()` is a nested double loop over `artifactPatterns[].patterns` (RegExp arrays), re-run from scratch per artifact. This mirrors the sibling components' own tradeoffs: `TeamDirectoryTable` is praised for sub-millisecond linear scans at small scale, while `ArtifactPatternRegistry` notes that this same prefix-based path is lexically brittle (e.g., `'scripts-external/foo.ts'` false-positives against a `'scripts'` prefix), making the "higher-confidence" 0.9 path actually more naively implemented than the regex-anchored 0.75 fallback.

At the CI/batch level, `verify-patterns.sh` (`scripts/knowledge-management/verify-patterns.sh`) implements a conceptually parallel but mechanically unrelated two-tier matching idea: coarse `rg --count-matches` counters (CONSOLE_LOG_COUNT, LOGGER_COUNT, REDUX_COUNT) feed a compliance SCORE, and a `SHARED_MEMORY`-driven block cross-references `TransferablePattern` entities (significance ≥ 8) via a `case "$pattern" in *Logging*|*Redux*|*State*)` string-switch — an even cruder analogue of `matchArtifactPattern()`'s regex step, with no equivalent of `checkLocalArtifact()`'s precision tier at all.

## Implementation Details

`extractArtifacts()` builds its candidate set from four regexes: `filePathPattern`, `npmPattern`, `classPattern` (`/[A-Z][a-zA-Z]+(Service|Agent|Manager|Engine|Handler|Analyzer|Classifier|Filter|Monitor)/g`), and `dirPattern` (`/[a-z-]+\/[a-z-]+\//g`). Because these patterns overlap and are unanchored, a single reference like `src/ontology/heuristics/EntityPatternAnalyzer.ts` can independently satisfy all three of `filePathPattern`, `dirPattern`, and `classPattern`, surviving Set deduplication as three distinct strings and giving one logical code reference three sequential chances to match in `analyzeEntityPatterns()`'s loop.

Entity-class inference is similarly bifurcated: `checkLocalArtifact()` calls `inferEntityClass(artifact, team)`, which consults a hardcoded `teamMappings: Record<string, Record<string,string>>`, while `matchArtifactPattern()` calls the differently named `inferEntityClassFromPattern(artifact, entityClassMap)`, using the `entityClassMap` bound to the matched `ArtifactPattern`. Notably, `teamMappings` contains an `'Agentic'` key (Agent/RAG/LLM/Vector) with no corresponding entry in `teamDirectories`, making it dead code — `inferEntityClass()` is only ever invoked with team values drawn from `teamDirectories.entries()`, so `'Agentic'` can never be selected.

The `teamDirectories` table (also documented under sibling `TeamDirectoryTable`) holds four teams — Coding, RaaS, ReSi, UI — each with a small array of path prefixes (e.g., Coding → `['src/ontology', 'src/knowledge-management', 'src/live-logging', 'scripts', '.specstory']`). `artifactPatterns` (sibling `ArtifactPatternRegistry`) pairs each team with `RegExp[]` and an `entityClassMap`, anchoring on patterns like `/LSL(Session|Monitor|Classifier)/i`.

## Integration Points

TwoStepArtifactMatching is entirely internal to `EntityPatternAnalyzer.ts` and depends on the constructor-built `teamDirectories` Map and `artifactPatterns` array — both of which are described identically by the sibling entities `TeamDirectoryTable` and `ArtifactPatternRegistry`. It has no shared code, config, or data-format link to `verify-patterns.sh`, which is architecturally decoupled and independently reimplements a coarser version of the same precision/recall tradeoff at the shell-script/CI layer, further complicated by its `SHARED_MEMORY` / `jq`-based pattern cross-referencing.

Unrelated to this logic are the co-located fixture files `integrations/graphify/tests/fixtures/xaml_viewmodel/ViewModels/DesignViewModel.cs` and `.../Views/DesignView.xaml`, used by graphify's own XAML/C# detection — `filePathPattern`'s extension list (`ts|js|cpp|java|tsx|jsx|py|go|rs`) excludes `.cs`/`.xaml`, so these files are structurally invisible to `EntityPatternAnalyzer`.

## Usage Guidelines

Developers extending `teamDirectories` or `artifactPatterns` should treat them as data changes, per the `ConfigurationExternalization` idiom — no new branching code is needed. However, three latent issues warrant caution: (1) the early-return-per-artifact design means match quality is sensitive to `extractArtifacts()`'s regex ordering, not true confidence ranking — don't assume the 0.9/0.75 split guarantees the best available match; (2) `checkLocalArtifact()`'s prefix test lacks path-boundary checking, risking false positives on directory names that share prefixes (e.g., `scripts` vs `scripts-external`); (3) any new team added to `teamMappings` without a corresponding `teamDirectories` entry (as with `'Agentic'`) will be unreachable dead code. In `verify-patterns.sh`, the `|| echo "0"` fallback around every `rg`/`jq` call silently converts missing-tool failures into "0 violations found," so a 100% compliance SCORE should be verified against actual tool availability rather than trusted at face value.


## Hierarchy Context

### Parent
- [ConfigurationExternalization](./ConfigurationExternalization.md) -- [LLM] EntityPatternAnalyzer.ts (src/ontology/heuristics/EntityPatternAnalyzer.ts) externalizes team-ownership classification rules into two in-memory data structures built in the constructor: `teamDirectories` (a Map<string, string[]> of path prefixes like 'src/ontology', 'raas-service', 'virtual-target') and `artifactPatterns` (an array of {team, patterns: RegExp[], entityClassMap} objects). Although these are hardcoded as class fields rather than loaded from config/*.yaml or config/*.json, they represent the same declarative-externalization idiom described in the parent CodingPatterns observations — the classification logic itself (checkLocalArtifact, matchArtifactPattern) never branches on team name directly, it only walks these tables, so adding a new team or artifact convention is a data change to the constructor's literals rather than a new code path.

### Siblings
- [TeamDirectoryTable](./TeamDirectoryTable.md) -- [LLM] The `teamDirectories` Map in EntityPatternAnalyzer.ts's constructor (src/ontology/heuristics/EntityPatternAnalyzer.ts) is the literal 'TeamDirectoryTable' — a `Map<string, string[]>` with four entries (Coding, RaaS, ReSi, UI) mapping team names to arrays of path prefixes (e.g. Coding → ['src/ontology', 'src/knowledge-management', 'src/live-logging', 'scripts', '.specstory']). It is consumed exclusively by `checkLocalArtifact()`, which iterates `this.teamDirectories.entries()` and calls `dirs.some((dir) => artifact.startsWith(dir))` — a linear scan over at most 4 teams × ~3-5 prefixes each, which is why the class's own docblock can credibly claim '<1ms response time'. There is no indexing structure (e.g. a trie or sorted-prefix search) because the table is small and static; this is an appropriate trade-off for the current scale but would degrade linearly if team count grew substantially.
- [ArtifactPatternRegistry](./ArtifactPatternRegistry.md) -- [LLM] EntityPatternAnalyzer's constructor (src/ontology/heuristics/EntityPatternAnalyzer.ts) builds `teamDirectories` as a `Map<string, string[]>` with exactly four keys — Coding, RaaS, ReSi, UI — each mapping to a flat array of path prefixes (e.g. Coding → ['src/ontology', 'src/knowledge-management', 'src/live-logging', 'scripts', '.specstory']). `checkLocalArtifact()` iterates this map with `dirs.some((dir) => artifact.startsWith(dir))`, which means prefix matching is purely lexical: an artifact string like 'scripts-external/foo.ts' would false-positive against the 'scripts' prefix because there is no trailing-slash or path-boundary check. This is a latent correctness gap in an otherwise carefully tiered (confidence 0.9 vs 0.75) resolution strategy — the higher-confidence path is actually more brittle to naming coincidences than its RegExp-based fallback, which at least anchors on word boundaries via patterns like `/LSL(Session|Monitor|Classifier)/i`.


---

*Generated from 10 observations*
