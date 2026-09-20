# TeamDirectoryTable

**Type:** Detail

# TeamDirectoryTable: Technical Insight Document

## What It Is

`TeamDirectoryTable` is the literal `teamDirectories` field constructed in `EntityPatternAnalyzer`'s constructor (`src/ontology/heuristics/EntityPatternAnalyzer.ts:31-56`). It is a `Map<string, string[]>` with exactly four entries — **Coding, RaaS, ReSi, UI** — each mapping a team name to a flat array of path prefixes (e.g., Coding → `['src/ontology', 'src/knowledge-management', 'src/live-logging', 'scripts', '.specstory']`). Structurally it is a pure ownership lookup: it answers "which team owns this artifact path" and carries no entity-classification information of its own. It is consumed exclusively by the private `checkLocalArtifact()` method, which is the first of two steps in the broader `TwoStepArtifactMatching` strategy implemented in `analyzeEntityPatterns()`.

## Architecture and Design

The table embodies the **declarative externalization** idiom shared with its parent, `ConfigurationExternalization`: classification rules are expressed as constructor-literal data rather than as branching code or external config files. `checkLocalArtifact()` never branches on team name — it walks the table generically via `Array.some((dir) => artifact.startsWith(dir))` — so adding a team or convention is meant to be a data change, not a new code path.

This table is one leg of a confidence-weighted, two-step fallback strategy shared with its sibling `ArtifactPatternRegistry`: `checkLocalArtifact()` (confidence 0.9, prefix-based) runs before `matchArtifactPattern()` (confidence 0.75, regex-based) in `TwoStepArtifactMatching`. Architecturally this tiering suggests prefix matches are treated as more trustworthy — but as the `ArtifactPatternRegistry` analysis notes, this is actually inverted in practice, since raw `startsWith` prefix checks are more brittle to naming coincidences than the regex fallback's word-boundary-anchored patterns.

## Implementation Details

The core mechanic is a linear scan: `checkLocalArtifact()` iterates `this.teamDirectories.entries()` (Map insertion order: Coding, RaaS, ReSi, UI) and, per team, calls `dirs.some((dir) => artifact.startsWith(dir))`, returning on the first match. At most 4 teams × 3-5 prefixes, this is why the class's docblock can credibly claim sub-millisecond response — no trie or sorted-prefix index exists, nor is one needed at this scale.

Two correctness gaps are notable at the implementation level. First, matching is purely lexical `startsWith`, with no path-boundary check — an artifact like `scripts-external/foo.ts` would false-positive against the `scripts` prefix. Second, prefix specificity is asymmetric across teams: Coding's entries mix nested paths (`src/ontology`) and a dotfile directory (`.specstory`) with top-level names, while RaaS and ReSi use bare top-level directory names (`raas-service`, `virtual-target`, `orchestration-engine`) that match any path beginning with that string regardless of depth. The uniform 0.9 confidence score does not reflect this imbalance.

Ownership resolution here is deliberately decoupled from entity-class resolution: `checkLocalArtifact()` delegates to `this.inferEntityClass(artifact, team)`, so the table itself is agnostic to entity type — that concern lives separately in `artifactPatterns[].entityClassMap` and in `inferEntityClass()`'s own `teamMappings`.

## Integration Points

`teamDirectories` is consumed only by `checkLocalArtifact()`, which is called from `analyzeEntityPatterns()` as the first check per artifact extracted by `extractArtifacts()`. Its output team, when non-null, feeds into `inferEntityClass()` for classification. This creates a three-way duplication of "team shape" across the file: `teamDirectories` (4 teams), `artifactPatterns` (same 4 teams), and `inferEntityClass()`'s `teamMappings` (5 teams, adding 'Agentic'). Since `checkLocalArtifact()` never iterates anything but `teamDirectories`, the 'Agentic' branch is unreachable via the directory-prefix path — dead code unless invoked another way, and no reader can determine the authoritative team list without cross-referencing all three structures.

Externally, `verify-patterns.sh` (`scripts/knowledge-management/verify-patterns.sh`) is a fully independent governance mechanism with no shared code, data, or invocation path with `EntityPatternAnalyzer.ts`. It performs `rg`-based aggregate compliance scoring (console.log vs Logger, useState vs Redux, etc.) with no notion of team ownership, illustrating a complementary but architecturally disconnected strategy: per-artifact runtime attribution (this table) versus repo-wide batch auditing (the shell script).

## Usage Guidelines

Developers extending team ownership should add entries directly to the `teamDirectories` constructor literal, keeping prefixes as specific as possible (prefer nested paths like `src/ontology` over bare top-level names) to minimize false positives given the unguarded `startsWith` matching. Any new team must also be reflected in `artifactPatterns` and `inferEntityClass()`'s `teamMappings` to avoid the same three-way inconsistency that currently strands 'Agentic'. Because prefix collisions across teams are never validated, and iteration order silently determines the winner (Coding first), added entries should be checked manually for overlap with existing prefixes — particularly against Coding's broad set. The table is `readonly` and built once in the constructor; there is no runtime mutation API, so ownership rules cannot be adjusted without redeploying the class. Given its linear-scan design, the table is appropriate only while team count and prefix count remain small; if it grows well beyond four teams, an indexed lookup should be considered.


## Hierarchy Context

### Parent
- [ConfigurationExternalization](./ConfigurationExternalization.md) -- [LLM] EntityPatternAnalyzer.ts (src/ontology/heuristics/EntityPatternAnalyzer.ts) externalizes team-ownership classification rules into two in-memory data structures built in the constructor: `teamDirectories` (a Map<string, string[]> of path prefixes like 'src/ontology', 'raas-service', 'virtual-target') and `artifactPatterns` (an array of {team, patterns: RegExp[], entityClassMap} objects). Although these are hardcoded as class fields rather than loaded from config/*.yaml or config/*.json, they represent the same declarative-externalization idiom described in the parent CodingPatterns observations — the classification logic itself (checkLocalArtifact, matchArtifactPattern) never branches on team name directly, it only walks these tables, so adding a new team or artifact convention is a data change to the constructor's literals rather than a new code path.

### Siblings
- [ArtifactPatternRegistry](./ArtifactPatternRegistry.md) -- [LLM] EntityPatternAnalyzer's constructor (src/ontology/heuristics/EntityPatternAnalyzer.ts) builds `teamDirectories` as a `Map<string, string[]>` with exactly four keys — Coding, RaaS, ReSi, UI — each mapping to a flat array of path prefixes (e.g. Coding → ['src/ontology', 'src/knowledge-management', 'src/live-logging', 'scripts', '.specstory']). `checkLocalArtifact()` iterates this map with `dirs.some((dir) => artifact.startsWith(dir))`, which means prefix matching is purely lexical: an artifact string like 'scripts-external/foo.ts' would false-positive against the 'scripts' prefix because there is no trailing-slash or path-boundary check. This is a latent correctness gap in an otherwise carefully tiered (confidence 0.9 vs 0.75) resolution strategy — the higher-confidence path is actually more brittle to naming coincidences than its RegExp-based fallback, which at least anchors on word boundaries via patterns like `/LSL(Session|Monitor|Classifier)/i`.
- [TwoStepArtifactMatching](./TwoStepArtifactMatching.md) -- [LLM] The core two-step matching strategy lives in EntityPatternAnalyzer.analyzeEntityPatterns() (src/ontology/heuristics/EntityPatternAnalyzer.ts), which iterates the artifacts returned by extractArtifacts() and, for each one, calls checkLocalArtifact() before matchArtifactPattern(), returning on the FIRST hit rather than collecting all candidate matches. This early-return-per-artifact design means that if the first extracted artifact matches at low confidence via matchArtifactPattern() (0.75) while a later artifact in the same Set would have matched checkLocalArtifact() (0.9), the lower-confidence result wins simply because of Set iteration order — Set insertion order in V8 is insertion order, but extractArtifacts() interleaves four different regex passes (filePathPattern, npmPattern, classPattern, dirPattern) appended in a fixed sequence, so the effective priority between 'file path' and 'class name' artifacts is an accidental byproduct of regex ordering in extractArtifacts(), not an explicit confidence-maximization step across all artifacts.


---

*Generated from 9 observations*
