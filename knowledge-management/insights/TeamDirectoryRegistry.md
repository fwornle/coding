# TeamDirectoryRegistry

**Type:** Detail

[Code References] src/ontology/heuristics/EntityPatternAnalyzer.ts:33-56 - hardcoded teamDirectories Map defining five teams' directory prefixes; src/ontology/heuristics/EntityPatternAnalyzer.ts:59-141 - hardcoded artifactPatterns array with per-team regex lists and entityClassMap; src/ontology/heuristics/EntityPatternAnalyzer.ts:150-183 - analyzeEntityPatterns() early-return-on-first-match loop over extracted artifacts; src/ontology/heuristics/EntityPatternAnalyzer.ts:191-210 - extractArtifacts() four-pass regex extraction into a shared Set; src/ontology/heuristics/EntityPatternAnalyzer.ts:218-228 - checkLocalArtifact() directory-prefix match returning confidence 0.9; src/ontology/heuristics/EntityPatternAnalyzer.ts:236-252 - matchArtifactPattern() regex match returning confidence 0.75; src/ontology/heuristics/EntityPatternAnalyzer.ts:260-271 (truncated) - inferEntityClass() duplicate teamMappings prefix-to-class table for the 'Coding' team; scripts/knowledge-management/verify-patterns.sh:1-20 - unrelated pattern-compliance checker operating on $SHARED_MEMORY, not part of the ownership-heuristic pipeline

# TeamDirectoryRegistry — Technical Insight Document

## What It Is

TeamDirectoryRegistry is the in-code data layer, embedded within `src/ontology/heuristics/EntityPatternAnalyzer.ts`, that defines the mapping between teams and their owned artifacts. It is realized as a hardcoded `teamDirectories` Map (lines 33-56) enumerating directory-prefix arrays for five teams — Coding, RaaS, ReSi, Agentic, and UI — alongside a parallel `artifactPatterns` array (lines 59-141) that supplies per-team regex lists and `entityClassMap` entries. As a child concept within the broader `TeamOwnershipHeuristics` component, TeamDirectoryRegistry supplies the foundational "ground truth" table that Layer 1 of the ownership-resolution pipeline consults before falling back to fuzzy pattern matching. It sits alongside sibling constructs `ArtifactPatternMatcher` and `LayerResultProtocol`, which respectively implement the regex-matching strategy and the two-tier confidence/early-exit contract that consumes this registry's data.

## Architecture and Design

The registry is part of a chain-of-responsibility-style layered heuristic pipeline, though only Layer 1 (EntityPatternAnalyzer) is visible in these observations. Within that layer, `analyzeEntityPatterns()` (lines 150-183) implements a strictly first-match-wins strategy: it extracts artifacts once via `extractArtifacts()`, then iterates them in a single `for...of` loop, invoking `checkLocalArtifact()` (deterministic directory-prefix lookup, confidence 0.9) before `matchArtifactPattern()` (regex-based fallback, confidence 0.75), and returns on the first hit from either. This is a two-tier confidence design that is never actually exploited for comparison — as LayerResultProtocol notes, the two confidence tiers would only be meaningful if scored against each other across multiple candidate artifacts, but the implementation trades completeness for speed, yielding the documented sub-1ms performance profile at the cost of correctness when multiple teams' artifacts co-occur in one content blob.

A second defining architectural trait is configuration-as-code: all team/directory/pattern data lives in constructor-initialized structures rather than externalized, runtime-loaded config, making this component an outlier relative to config-driven conventions elsewhere in the project. Iteration order — array declaration order for `artifactPatterns`, Set insertion order for extracted artifacts — functions as an implicit, undocumented precedence mechanism rather than an explicit priority field.

## Implementation Details

`extractArtifacts()` (lines 191-210) performs four independent regex passes — `filePathPattern`, `npmPattern`, `classPattern`, `dirPattern` — over the same content string, merging all matches into one shared `Set<string>` in insertion order: file paths, then npm packages, then class names, then bare directory paths. This insertion order directly determines which team is credited when content references multiple teams' artifacts, since the consuming loop returns on first match. The `classPattern` regex (`/[A-Z][a-zA-Z]+(Service|Agent|Manager|Engine|Handler|Analyzer|Classifier|Filter|Monitor)/g`) is broad enough to match the analyzer's own naming conventions, but its effectiveness is coupled to whether the rest of the codebase actually follows *Service/*Manager/*Handler suffix conventions.

`checkLocalArtifact()` (lines 218-228) performs the directory-prefix match against `teamDirectories`, returning `confidence: 0.9`; `matchArtifactPattern()` (lines 236-252) performs regex matching against `artifactPatterns`, returning `confidence: 0.75`. Both confidence values are inlined as numeric literals in two separate locations each — once inside the private helper's returned `ArtifactMatch`, once in the `LayerResult` constructed by the caller — meaning each tier is hardcoded in four total occurrences with no shared constant.

A notable defect surfaces in `inferEntityClass()` (invoked from `checkLocalArtifact()`, partially visible at lines 260-271): it maintains a third `teamMappings` object duplicating prefix-to-class strings (e.g., `'LSL: LSLSession'`, `'Knowledge: KnowledgeEntity'`) that already exist verbatim in the `'Coding'` team's `artifactPatterns.entityClassMap`. This produces triplicated ownership logic across `teamDirectories`, `artifactPatterns[].entityClassMap`, and `teamMappings`.

The array-order dependency also creates a concrete classification bug: `Agentic`'s regex `/AgentFramework|AgentWorkflow/i` and `UI`'s regex `/MultiAgent|AgentCoordinator/i` both key off the substring "Agent," and since `matchArtifactPattern()` iterates in declaration order (Coding, RaaS, ReSi, Agentic, UI), any artifact matching Agentic's broader pattern is attributed there even when intended as a UI-owned `MultiAgent` coordinator class.

## Integration Points

TeamDirectoryRegistry's data structures are consumed exclusively within `EntityPatternAnalyzer.ts` by its sibling logic paths: `ArtifactPatternMatcher`-equivalent behavior (`matchArtifactPattern()`) and the `LayerResultProtocol`-governed `analyzeEntityPatterns()` orchestration. As part of `TeamOwnershipHeuristics`, it presumably feeds later resolution layers, though only Layer 1 internals are evidenced here. Notably, two files sometimes bundled with this evidence set — `scripts/knowledge-management/verify-patterns.sh` (a shell-based compliance checker operating on `$SHARED_MEMORY` via `jq`) and the graphify xaml_viewmodel test fixtures (`DesignViewModel.cs`, `DesignView.xaml`) — have no code-path coupling to EntityPatternAnalyzer.ts and should not be treated as structurally connected to team-directory resolution.

## Usage Guidelines

Anyone adding a new team or entity-class prefix must edit three separate locations to keep the registry consistent: `teamDirectories`, the relevant `artifactPatterns[team].entityClassMap`, and `teamMappings` inside `inferEntityClass()` — omitting any one introduces silent drift. Because match order (both array declaration order and Set insertion order) acts as an undocumented precedence rule, care must be taken when adding new regex patterns that share substrings with existing ones (as with Agentic/UI's "Agent" collision); more specific patterns should be ordered before broader ones, or the ambiguity should be resolved explicitly rather than relying on array position. Confidence tuning requires updating four hardcoded literal occurrences (0.9 and 0.75, each duplicated) rather than a single config value — a future improvement would be extracting these into named constants. Given the first-match-wins design, this registry is best suited for content with a single dominant artifact reference; multi-team content blobs risk misattribution and should be flagged for review rather than trusted at face value.


## Hierarchy Context

### Siblings
- [ArtifactPatternMatcher](./ArtifactPatternMatcher.md) -- [LLM] [object Object]
- [LayerResultProtocol](./LayerResultProtocol.md) -- [LLM] The `analyzeEntityPatterns()` method in `src/ontology/heuristics/EntityPatternAnalyzer.ts` implements a two-tier resolution strategy where `checkLocalArtifact()` is always attempted before `matchArtifactPattern()` for any given artifact, inside a `for...of artifacts` loop that returns immediately on the first successful match at either tier. This means the function never compares confidence across multiple artifacts extracted from the same content blob — it is a first-match-wins design, not a best-match-wins design, despite explicitly encoding two different confidence tiers (0.9 vs 0.75) that would only be meaningful if compared against each other. The performance characteristics (documented as '<1ms' in the file header) are a direct consequence of this early-exit strategy trading completeness for speed.


---

*Generated from 10 observations*
