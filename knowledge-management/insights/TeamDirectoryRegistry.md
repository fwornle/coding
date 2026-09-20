# TeamDirectoryRegistry

**Type:** Detail

# TeamDirectoryRegistry — Technical Insight Document

## What It Is

`TeamDirectoryRegistry` refers to the data structures — `teamDirectories` (a `Map<string, string[]>`) and its companion `artifactPatterns` (an `ArtifactPattern[]` array) — defined and populated in the constructor of `EntityPatternAnalyzer` at `src/ontology/heuristics/EntityPatternAnalyzer.ts:34-100`. Together these form the "registry" half of the registry+adapter idiom that this component instantiates: `teamDirectories` maps team names to directory-prefix strings consulted by `checkLocalArtifact`, while `artifactPatterns` pairs `RegExp[]` collections with an `entityClassMap`, consulted by `matchArtifactPattern`. Both are private, readonly, and populated once — there is no runtime mutation, making the registry an immutable lookup table rather than a live, dynamically-registered service.

## Architecture and Design

The defining architectural decision is expressing team-ownership rules as plain data (Map and array literals) instead of instantiated adapter objects. As the parent component **AdapterRegistryPattern** frames it, this is a "data-driven registry" variant of the adapter-registry idiom — contrasted with object-oriented registries like `ProviderRegistryManager` or `SpecstoryAdapter`/`TranscriptAdapter`. Sibling entity **ArtifactPatternRegistry** describes the same design: no adapter classes are instantiated, and the "registry" is simply structured data consulted by two private methods. This keeps the component allocation-free and trivially serializable but removes any polymorphic extension point — adding a new team means editing `EntityPatternAnalyzer.ts` directly.

Resolution logic in `analyzeEntityPatterns` implements an implicit chain-of-responsibility: for each artifact extracted, `checkLocalArtifact` is tried before `matchArtifactPattern`, short-circuiting on the first match with `return { layer: 1, ... }`. Confidence is confidence-tiered via hardcoded magic numbers — 0.9 for direct directory matches, 0.75 for pattern matches — embedded directly in the method rather than externalized as configuration.

## Implementation Details

`checkLocalArtifact` traverses `teamDirectories.entries()` and uses `Array.prototype.some(startsWith)` prefix matching against artifact paths. `matchArtifactPattern` iterates `artifactPatterns`, testing each `RegExp` via `RegExp.test`. Artifacts themselves come from `extractArtifacts`, which runs four unconditional regex passes over the full content string — file paths, `@scope/package` names, class names matching `[A-Z][a-zA-Z]+(Service|Agent|Manager|...)`, and bare `dir/dir/` prefixes — merging all matches into a single `Set<string>` for deduplication. This is O(4n) per call with no early exit, a reasonable trade-off given the documented "<1ms" target for short knowledge snippets, but wasteful if an early pass already yields a confident candidate.

A structural weakness lives in team→entityClass mapping duplication: `ArtifactPattern.entityClassMap` (keyed by prefixes like `LSL`, `MCP`, `Kubernetes`) is one source, while `inferEntityClass`'s private `teamMappings` record is a second, independently maintained source — the latter additionally covers an `Agentic` team absent from `teamDirectories`/`artifactPatterns` entirely. Because `inferEntityClass` is reachable only from the direct-match path, a directory-prefix match (confidence 0.9) can still yield a weaker or missing `entityClass` if the filename doesn't match `teamMappings[team]`'s keys.

Classification outcomes are order-sensitive: since `analyzeEntityPatterns` returns on the first artifact that resolves, results depend on `Set` insertion order from `extractArtifacts` combined with the fixed iteration order of `teamDirectories.entries()` and the `artifactPatterns` array. Two artifacts from the same content that would classify to different teams are resolved silently by insertion order, with no conflict reporting.

The `UI` team entry exemplifies a domain-conflation trade-off: it bundles AWS serverless infra patterns (Lambda, API Gateway, EventBridge, Step Functions) with React/Redux/curriculum/multi-agent patterns under one label, spanning both `teamDirectories` (`curriculum-alignment`, `aws-lambda`, `multi-agent-system`) and the corresponding `artifactPatterns` entry's regex list and `entityClassMap`. Splitting this team's ownership later would require coordinated edits across three separate structures with no single point of change.

## Integration Points

Within the class itself, the registry data feeds two consumer methods (`checkLocalArtifact`, `matchArtifactPattern`) invoked by `analyzeEntityPatterns`, which is the entry point exposed by sibling **EntityPatternAnalyzer**. Outside the class, there is no code-level dependency: `scripts/knowledge-management/verify-patterns.sh` performs its own independent textual/regex compliance scoring (console.log counts, useState counts, install.sh grep checks) and patches `$SHARED_MEMORY` JSON metadata atomically via `jq ... > tmp && mv`, but has no code path connecting it to this registry — their co-location under `knowledge-management` is directory happenstance, not a shared abstraction. Similarly, the XAML/C# fixtures under `integrations/graphify/tests/fixtures/xaml_viewmodel` (`DesignViewModel.cs`, `DesignView.xaml`) exist purely to exercise graphify's C#/XAML parsing and reference none of this registry's prefixes or patterns.

## Usage Guidelines

Because `teamDirectories` and `artifactPatterns` are populated once in the constructor with no external registration API, any new team or artifact pattern must be added by directly editing `EntityPatternAnalyzer.ts` — there is no plugin point. When doing so, developers must remember to update entityClass mappings in *two* places (`entityClassMap` and `inferEntityClass`'s `teamMappings`) to avoid drift, and should be cautious about ordering: since resolution short-circuits on the first matching artifact, new prefixes or patterns should be checked against existing ones for ambiguity, particularly given the precedent of the `UI` team's broad, multi-domain scope. Given the sensitivity to `Set` iteration order in `extractArtifacts`, avoid assuming deterministic precedence among multiple valid matches without verifying insertion order empirically.


## Hierarchy Context

### Parent
- [AdapterRegistryPattern](./AdapterRegistryPattern.md) -- [LLM] EntityPatternAnalyzer (src/ontology/heuristics/EntityPatternAnalyzer.ts) is the concrete implementation of the 'registry + adapter' idiom described at the parent (CodingPatterns) level: `teamDirectories` is a Map acting as a lightweight registry keying team names to directory prefixes, and `artifactPatterns` is an array-of-records registry keying team names to arrays of RegExp + an `entityClassMap`. Rather than a class-per-adapter registry (as implied by ProviderRegistryManager or SpecstoryAdapter/TranscriptAdapter), this component implements the same conceptual pattern with plain data structures (Map and array literals) instead of instantiated adapter objects — a 'data-driven registry' variant of the adapter-registry idiom rather than an object-oriented one.

### Siblings
- [ArtifactPatternRegistry](./ArtifactPatternRegistry.md) -- [LLM] `EntityPatternAnalyzer` (src/ontology/heuristics/EntityPatternAnalyzer.ts) implements a data-driven registry rather than an object-oriented adapter registry: `teamDirectories` is a `Map<string, string[]>` built once in the constructor, and `artifactPatterns` is an `ArtifactPattern[]` array literal combining `RegExp[]` with an `entityClassMap`. No adapter classes are instantiated — the 'registry' is just structured data consulted by two private methods (`checkLocalArtifact`, `matchArtifactPattern`), which keeps the component allocation-free and trivially serializable, but also means there is no polymorphic extension point: adding a new team requires editing this file directly rather than registering a new adapter object elsewhere.
- [EntityPatternAnalyzer](./EntityPatternAnalyzer.md) -- [CGR] EntityPatternAnalyzer (class) in EntityPatternAnalyzer.ts


---

*Generated from 10 observations*
