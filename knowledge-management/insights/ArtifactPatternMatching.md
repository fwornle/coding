# ArtifactPatternMatching

**Type:** Detail

## What It Is

"ArtifactPatternMatching" does not exist as a distinct file, class, export, or documented interface anywhere in the supplied sources. What the observations actually describe is `matchArtifactPattern()`, a private method at `src/ontology/heuristics/EntityPatternAnalyzer.ts:159-175`, which is one of two branches inside `analyzeEntityPatterns()` — the fallback branch reached only when its sibling `checkLocalArtifact()` (lines 145-157) fails to find a directory-prefix match. The requested "component" is therefore an entity-graph abstraction layered over a single method of the parent `EntityTeamOwnershipHeuristics` class, not a standalone unit of code. This document treats it as such: an analysis of that one branch, not of an independent module.

## Architecture and Design

The governing pattern is a strategy/rule-table lookup: `matchArtifactPattern()` iterates `this.artifactPatterns` (lines 60-129), an ordered array of four `{team, patterns[], entityClassMap}` objects for Coding, RaaS, ReSi, and UI. Evaluation is first-match-wins via nested loops — outer over teams, inner over that team's regex list — calling `pattern.test(artifact)` and returning on the first hit. Array order therefore functions as a silent priority ranking: because Coding is declared first, any artifact ambiguously matching both a Coding pattern and a later team's pattern is always attributed to Coding, with no ambiguity signal exposed to the caller.

This branch is explicitly the lower-priority half of a two-tier confidence hierarchy documented on the parent: `checkLocalArtifact()` (directory-prefix match against `TeamDirectoryMapping`'s `teamDirectories` Map) returns confidence 0.9 and is checked first; `matchArtifactPattern()` returns 0.75 only as a fallback — a deliberate "known location beats plausible name" design.

## Implementation Details

Entity-class inference for a successful pattern match is delegated to `inferEntityClassFromPattern(artifact, entityClassMap)`, referenced but not shown in the truncated file, which looks up the artifact in a team-specific `entityClassMap` defined inline per pattern-team (e.g. Coding's `{LSL: 'LSLSession', Constraint: 'ConstraintRule', MCP: 'MCPAgent', Knowledge: 'KnowledgeEntity'}`). This duplicates key names also present in a separate `teamMappings.Coding` table inside `inferEntityClass()` (lines 180-198), used by `checkLocalArtifact()` — two independently maintained team-truth sources for the same keys, compounding team-mapping drift already flagged elsewhere for the Agentic team.

The confidence value itself is not data on the match: 0.75 is a literal hardcoded at the `analyzeEntityPatterns()` call site, applied uniformly regardless of regex specificity. A narrow three-alternative suffix match like `LSL(Session|Monitor|Classifier)` receives the same score as a broad two-term alternation like `VirtualTarget|EmbeddedFunction` for ReSi — there is no per-pattern precision data or evaluation harness backing either the 0.75 or the 0.9 threshold used by its sibling.

## Integration Points

`matchArtifactPattern()` is reachable only through `analyzeEntityPatterns()`'s per-artifact loop, downstream of `checkLocalArtifact()` and dependent on artifacts produced by sibling **ArtifactExtraction** (`extractArtifacts()`). Because `extractArtifacts()` unions four regex passes into a single `Set` with pass-order-determined (not content-position-determined) insertion order, pattern-matching operates on whatever artifacts happen to fail the directory check first in iteration order — e.g., a class-name-suffix artifact like `ConstraintRule` could satisfy `/Constraint(Rule|Monitor|Hook)/i` before a co-occurring directory artifact (`src/ontology/`) is ever tried against `checkLocalArtifact()`'s higher-confidence path via sibling **TeamDirectoryMapping**.

Downstream, pattern-matches and local-artifact matches produce structurally identical `ArtifactMatch` objects, differing only in confidence (0.75 vs 0.9) and implicit provenance. This connects directly to the previously documented Metadata Merge Bug (destructive-overwrite pattern): any consolidation step that doesn't preserve confidence/provenance risks treating a weak pattern-regex guess as equivalent evidence to a directory-anchored match.

## Usage Guidelines

Treat pattern-array order in `artifactPatterns` as a real prioritization decision, not incidental ordering — reordering teams changes match outcomes for ambiguous artifacts. Any change to entity-class keys (LSL, Constraint, MCP, Knowledge) must be mirrored in both the inline `entityClassMap` and `inferEntityClass()`'s `teamMappings`, since these are unsynchronized duplicate sources. The method has no independent test seam — it's only exercised via `analyzeEntityPatterns()` — so testing requires driving artifacts through the full per-artifact loop. Before trusting the 0.75 confidence value in downstream logic, note it has no empirical backing across heterogeneous regex specificities, and any merge/consolidation logic must explicitly preserve confidence provenance rather than assuming structural equality implies evidentiary equality.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- The Metadata Merge Bug — Destructive Overwrite Pattern record is directly relevant to matchArtifactPattern()'s output specifically: because pattern-based matches (0.75 confidence) and local-artifact matches (0.9 confidence) are structurally identical ArtifactMatch objects once returned, any downstream consolidation step that doesn't preserve the confidence/provenance distinction risks treating a weaker pattern-regex guess as equivalent evidence to a directory-anchored match, reproducing the same 'no representation treated as authoritative' failure mode documented in that record.

## Hierarchy Context

### Parent
- [EntityTeamOwnershipHeuristics](./EntityTeamOwnershipHeuristics.md) -- [LLM] src/ontology/heuristics/EntityPatternAnalyzer.ts implements the actual 'Layer 1: File/Artifact Detection' stage of EntityTeamOwnershipHeuristics, per its own header comment. analyzeEntityPatterns() runs a two-step check per extracted artifact: checkLocalArtifact() first looks for a direct prefix match against a hardcoded teamDirectories Map (Coding → src/ontology, src/knowledge-management, src/live-logging, scripts, .specstory; RaaS → raas-service, orchestration-engine, event-mesh; ReSi → virtual-target, embedded-functions, reprocessing-engine; UI → curriculum-alignment, aws-lambda, multi-agent-system), returning confidence 0.9. Only if that fails does matchArtifactPattern() fall back to a per-team array of naming-convention regexes (e.g. /LSL(Session|Monitor|Classifier)/i for Coding, /Kubernetes(Cluster|Pod|Service)/i for RaaS) at confidence 0.75 — a deliberate 'known location beats plausible name' ordering.

### Siblings
- [TeamDirectoryMapping](./TeamDirectoryMapping.md) -- [LLM] The literal 'TeamDirectoryMapping' entity is realized as the `teamDirectories` private field in `src/ontology/heuristics/EntityPatternAnalyzer.ts`'s constructor: a `Map<string, string[]>` with four hardcoded team keys (Coding, RaaS, ReSi, UI), each holding a flat array of directory-prefix strings (e.g. Coding → `src/ontology`, `src/knowledge-management`, `src/live-logging`, `scripts`, `.specstory`). This is not a generic config object but the exact lookup table `checkLocalArtifact()` iterates via `this.teamDirectories.entries()`, using `dirs.some((dir) => artifact.startsWith(dir))` — a simple prefix test, not a path-segment-aware match, so a hypothetical directory named e.g. `scripts-legacy/` would also satisfy `startsWith('scripts')`.
- [ArtifactExtraction](./ArtifactExtraction.md) -- [LLM] The component named "ArtifactExtraction" maps directly onto the private extractArtifacts() method in src/ontology/heuristics/EntityPatternAnalyzer.ts, which is the sole artifact-mining routine in the supplied code. It runs four independent regex passes over the raw knowledge-content string and unions every hit into a single `Set<string>`: a file-path pattern requiring a two-segment lowercase/hyphen directory prefix before one of nine hardcoded extensions (ts/js/cpp/java/tsx/jsx/py/go/rs), an npm-scoped-package pattern (`@scope/name`), a class-name pattern requiring a capitalized identifier ending in one of nine hardcoded suffixes (Service|Agent|Manager|Engine|Handler|Analyzer|Classifier|Filter|Monitor), and a bare two-segment directory pattern (`x/y/`). Because `Array.from(artifacts)` preserves Set insertion order and the four `.forEach` calls run strictly sequentially (file paths, then npm packages, then class names, then directories), a class-name artifact is always inserted before a directory artifact extracted from the same line of text, even if the directory appeared first in the source string — insertion order is a function of regex pass order, not of position in the content.


---

*Generated from 9 observations*
