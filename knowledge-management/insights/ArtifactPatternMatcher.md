# ArtifactPatternMatcher

**Type:** Detail

[Code References] src/ontology/heuristics/EntityPatternAnalyzer.ts:1-9 - file header documents 'Layer 1: File/Artifact Detection' and '<1ms response time' contract, unenforced at runtime; src/ontology/heuristics/EntityPatternAnalyzer.ts:29-58 - constructor hardcodes teamDirectories Map and artifactPatterns array for exactly 5 teams; src/ontology/heuristics/EntityPatternAnalyzer.ts:~130-170 - analyzeEntityPatterns() early-return loop over extracted artifacts, first match wins regardless of confidence; src/ontology/heuristics/EntityPatternAnalyzer.ts:~180-210 - extractArtifacts() four regex passes (filePathPattern, npmPattern, classPattern, dirPattern) merged into one Set; src/ontology/heuristics/EntityPatternAnalyzer.ts:~215-230 - checkLocalArtifact() directory-prefix match via dirs.some(artifact.startsWith(dir)); src/ontology/heuristics/EntityPatternAnalyzer.ts:~235-255 - matchArtifactPattern() regex-array match via pattern.test(artifact), returns on first hit; src/ontology/heuristics/EntityPatternAnalyzer.ts:~260+ - inferEntityClass() teamMappings duplicate prefix→class table (truncated in provided excerpt)

# ArtifactPatternMatcher — Technical Insight Document

## What It Is

ArtifactPatternMatcher is implemented within `src/ontology/heuristics/EntityPatternAnalyzer.ts`, serving as "Layer 1: File/Artifact Detection" in a documented multi-layer team-ownership heuristic pipeline. It is contained by the parent **TeamOwnershipHeuristics** entity and sits alongside sibling components **TeamDirectoryRegistry** and **LayerResultProtocol**, which describe complementary facets of the same underlying `analyzeEntityPatterns()` mechanism. In essence, this component's job is to inspect a piece of knowledge content, extract candidate "artifacts" (file paths, npm package names, class names, directory paths), and match those artifacts against hardcoded team ownership data to attribute the content to one of five teams: Coding, RaaS, ReSi, Agentic, and UI.

## Architecture and Design

The core architectural pattern is **chain-of-responsibility with early-exit**: `analyzeEntityPatterns()` (lines ~130-170) iterates extracted artifacts in a `for...of` loop, attempting `checkLocalArtifact()` before `matchArtifactPattern()` for each, and returns immediately upon the first successful match — whether that match comes from directory-prefix comparison or regex pattern testing. This is explicitly a **first-match-wins**, not best-match-wins, design.

Layered atop this is a **two-tier confidence heuristic**: local/direct matches are scored at a hardcoded 0.9, fuzzy pattern matches at 0.75. Critically, these tiers are never actually compared against one another across candidate artifacts — the early-exit strategy means the second tier only ever activates when the first tier fails for a given artifact, not when it fails across all artifacts. This makes the two confidence values largely vestigial numeric labels rather than an active scoring/ranking mechanism.

Extraction feeds this matching logic via a **regex-driven pipeline**: `extractArtifacts()` (lines ~180-210) runs four independent regex passes — `filePathPattern`, `npmPattern`, `classPattern`, and `dirPattern` — merging all results into a single `Set<string>` for deduplication. However, `filePathPattern` and `dirPattern` overlap in what they capture, which can produce redundant or truncated duplicate artifacts extracted from the same source substring.

A significant structural weakness is **duplicated lookup logic across parallel data structures**: `checkLocalArtifact()` (lines ~215-230) performs a directory-prefix test (`dirs.some(artifact.startsWith(dir))`) over a `Map`, while `matchArtifactPattern()` (lines ~235-255) performs a regex-array test (`pattern.test(artifact)`) over an array — same loop-test-return shape, different data types, no shared generic implementation. Compounding this, `inferEntityClass()` maintains its own `teamMappings` table that independently re-encodes the same prefix→class domain knowledge already present in `artifactPatterns[].entityClassMap`, meaning the same conceptual mapping exists in at least three places in the file.

## Implementation Details

The constructor (lines 29-58) hardcodes `teamDirectories` (a `Map`) and `artifactPatterns` (an array) covering exactly five teams as embedded literals — there is no external configuration file backing this data, which contradicts the project's otherwise stated config-driven convention.

`extractArtifacts()` produces a `Set<string>` whose **iteration order is insertion order**: file paths first, then npm packages, then class names, then bare directory paths. Because `analyzeEntityPatterns()` is first-match-wins, this insertion order silently determines which team gets credited when content references artifacts from multiple teams — there is no explicit priority or tie-breaking field, making classification order-dependent and implicit rather than declared.

`checkLocalArtifact()` and `matchArtifactPattern()` are tried in that fixed sequence per artifact, meaning local directory matches are always preferred over pattern-based matches for the same artifact, but never compared against pattern matches found on other artifacts. `inferEntityClass()` (line ~260+) is the final resolution step using its own duplicated `teamMappings` table (details truncated in the observed excerpt), representing a second independent source of truth for prefix→class mapping.

## Integration Points

ArtifactPatternMatcher's behavior is fully described by its parent's method `analyzeEntityPatterns()`, and its two sibling entities — TeamDirectoryRegistry and LayerResultProtocol — each characterize different facets of that same function: TeamDirectoryRegistry emphasizes the Set-iteration-order dependency in artifact resolution, while LayerResultProtocol emphasizes the unused-comparison nature of the two confidence tiers. Together these three entities describe one cohesive mechanism from different angles, all rooted in the same file and method.

The component's stated contract — "<1ms response time," documented in the file header (lines 1-9) — is a direct architectural consequence of the early-exit design, trading completeness of matching for guaranteed low latency. However, this latency claim has no runtime enforcement (no timing assertions, benchmarks, or guards), so it functions as documentation intent rather than a verified system property.

## Usage Guidelines

Developers extending this component should be aware that **artifact extraction order matters** for classification outcomes when content spans multiple teams' artifacts — introducing new regex patterns to `extractArtifacts()` or reordering the four passes will silently change which team wins ambiguous cases. Any new team must be added redundantly in at least three places: `teamDirectories`, `artifactPatterns[].entityClassMap`, and `inferEntityClass()`'s `teamMappings` — a maintenance hazard given the lack of a single source of truth or external config.

Because the confidence tiers (0.9 vs 0.75) are not actually used for cross-artifact comparison, adding new confidence levels or trying to fine-tune scoring will have no effect unless the early-exit control flow in `analyzeEntityPatterns()` is refactored into a collect-then-rank strategy. Similarly, `checkLocalArtifact()` and `matchArtifactPattern()` should ideally be unified behind a shared generic matcher rather than duplicated per data-structure type, to reduce the risk of divergent bug fixes. Given the hardcoded five-team topology, any team reorganization requires coordinated code changes across the constructor and duplicate mapping tables rather than a config update, which is a notable scalability and maintainability liability as the number of teams grows.


## Hierarchy Context

### Siblings
- [TeamDirectoryRegistry](./TeamDirectoryRegistry.md) -- [LLM] EntityPatternAnalyzer.analyzeEntityPatterns() in src/ontology/heuristics/EntityPatternAnalyzer.ts extracts artifacts once via extractArtifacts() and then iterates them in a single for...of loop, calling checkLocalArtifact() before matchArtifactPattern() for each artifact and returning immediately on the first hit of either. This means the method never scores all candidate artifacts and picks the best one — it is strictly first-match-wins across both the directory-prefix and regex-pattern strategies, so the Set iteration order returned by extractArtifacts() (insertion order: file paths, then npm packages, then class names, then bare directory paths) directly determines which team gets credited when a piece of knowledge content references multiple teams' artifacts.
- [LayerResultProtocol](./LayerResultProtocol.md) -- [LLM] The `analyzeEntityPatterns()` method in `src/ontology/heuristics/EntityPatternAnalyzer.ts` implements a two-tier resolution strategy where `checkLocalArtifact()` is always attempted before `matchArtifactPattern()` for any given artifact, inside a `for...of artifacts` loop that returns immediately on the first successful match at either tier. This means the function never compares confidence across multiple artifacts extracted from the same content blob — it is a first-match-wins design, not a best-match-wins design, despite explicitly encoding two different confidence tiers (0.9 vs 0.75) that would only be meaningful if compared against each other. The performance characteristics (documented as '<1ms' in the file header) are a direct consequence of this early-exit strategy trading completeness for speed.


---

*Generated from 9 observations*
