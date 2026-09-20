# TeamArtifactPatternTable

**Type:** Detail

[Architecture Notes] EntityPatternAnalyzer has no constructor dependency injection — teamDirectories and artifactPatterns are hardcoded literals built inline, not passed in or loaded from config; Naming convention (Service/Agent/Manager/Engine/Handler/Analyzer/Classifier/Filter/Monitor suffixes) is duplicated in three places: the classPattern regex in extractArtifacts(), the artifactPatterns regex alternations, and verify-patterns.sh's implicit assumptions — tight, unenforced coupling to a project-wide naming convention; Data-model drift: inferEntityClass()'s private teamMappings object defines an 'Agentic' team entry with no corresponding entry in the constructor-built teamDirectories or artifactPatterns, making that branch unreachable from the public analyzeEntityPatterns() entry point; verify-patterns.sh and EntityPatternAnalyzer.ts are architecturally parallel but disconnected — no shared module, shared regex source, or cross-reference between the shell-level and TypeScript-level pattern registries

# TeamArtifactPatternTable: Technical Insight Document

## What It Is

TeamArtifactPatternTable represents the data model underlying `EntityPatternAnalyzer`, implemented at `src/ontology/heuristics/EntityPatternAnalyzer.ts`. It is the constructor-built registry that maps four teams — Coding, RaaS, ReSi, and UI — to their associated directory prefixes, artifact regex patterns, and entity class labels. This table is not an externally-loaded configuration but a set of hardcoded literals: a `teamDirectories` `Map<string, string[]>` (e.g., Coding → `['src/ontology', 'src/knowledge-management', 'src/live-logging', 'scripts', '.specstory']`) and an `artifactPatterns` array pairing each team with case-insensitive `RegExp` objects and an `entityClassMap` keyed by short prefixes like 'LSL', 'Constraint', 'MCP'. Its purpose is to let `analyzeEntityPatterns()` classify arbitrary knowledge text into a team affiliation based on lexical artifact evidence — file paths, npm package names, class names, and directory strings.

## Architecture and Design

The design instantiates a **config-as-code registry pattern**: rather than externalizing team/directory/pattern mappings into YAML or JSON (as done elsewhere in the project, e.g., `config/prompt-classifier.yaml`), the table is frozen into TypeScript literals at construction time. This makes `EntityPatternAnalyzer` a stateless classifier — it has no init/start/stop lifecycle, no mutable counters, and no connect/disconnect semantics, distinguishing it from the CircuitBreakerManager/BudgetTracker-style lifecycle-owning classes described under its parent, ManagerPattern. Despite lacking the "Manager" suffix, EntityPatternAnalyzer structurally mirrors that convention by building immutable collections in its constructor and exposing a single lifecycle-free public entry point, `analyzeEntityPatterns()` — evidence that the Manager naming convention is not universal and diverges for pure-classification components.

The classification pipeline itself is a two-step, confidence-scored process: direct artifact matches score 0.9, while regex pattern matches score 0.75. Underneath this sits `extractArtifacts()`, which runs four independent regex passes (filePathPattern, npmPattern, classPattern, dirPattern) and deduplicates results into a `Set`, favoring precision over recall.

## Implementation Details

The table's data is triply redundant for at least the Coding team: the same vocabulary (LSL, Constraint, MCP, Knowledge) is independently encoded in `artifactPatterns[0].patterns` (regex alternations), `artifactPatterns[0].entityClassMap` (string keys), and again inside the private `inferEntityClass()` method's `teamMappings.Coding` object. These three sources must be manually kept in sync — there is no shared derivation.

`analyzeEntityPatterns()` iterates artifacts in `Set` insertion order (as produced by `extractArtifacts()`) and **short-circuits on the first match**, returning immediately upon success in `checkLocalArtifact()` or `matchArtifactPattern()`. This means knowledge entries referencing artifacts from multiple teams will be attributed solely to whichever team's artifact happens to appear earliest in iteration order — no aggregation or voting occurs.

The `classPattern` regex (`/[A-Z][a-zA-Z]+(Service|Agent|Manager|Engine|Handler|Analyzer|Classifier|Filter|Monitor)/g`) notably would match the literal string "EntityPatternAnalyzer" itself, since it ends in "Analyzer" — an unguarded self-referential edge case. Separately, `dirPattern` (`/[a-z-]+\/[a-z-]+\//g`) only matches lowercase-hyphen directory segments, silently excluding any uppercase or underscore-based directories from ever being extracted.

Notably, `inferEntityClass()`'s private `teamMappings` object defines an 'Agentic' team entry with no corresponding entry in the constructor-built `teamDirectories` or `artifactPatterns` — a data-model drift rendering that branch unreachable from the public API.

## Integration Points

EntityPatternAnalyzer has no dependency injection: its sibling entity in the code structure is itself (`EntityPatternAnalyzer` class in `EntityPatternAnalyzer.ts`), and there are no externally supplied configuration inputs. It operates entirely in-process on arbitrary `knowledge.content` text strings.

A parallel, disconnected mechanism exists in `scripts/knowledge-management/verify-patterns.sh`, which performs the same conceptual naming-convention classification but via shell/`rg`/`jq` over the live filesystem and a `$SHARED_MEMORY` JSON knowledge store, computing a compliance score (e.g., the 'ConditionalLoggingPattern' check comparing `CONSOLE_LOG_COUNT` vs `LOGGER_COUNT`). Neither script calls or references the other, so the Service/Agent/Manager/Engine/Handler/Analyzer/Classifier/Filter/Monitor naming universe is duplicated across TypeScript regex and shell grep logic with no shared source of truth.

## Usage Guidelines

Any addition of a new team, directory prefix, or naming suffix requires manually editing and recompiling `EntityPatternAnalyzer.ts` — there is no config file to update. Maintainers must also remember to update all three synchronized locations (patterns, entityClassMap, and `inferEntityClass()`'s `teamMappings`) for any given team, and check the `verify-patterns.sh` shell script separately since it is not auto-synchronized. Developers extending this table should consider adding a conflict-resolution/aggregation step in `analyzeEntityPatterns()` before assuming single-team attribution is reliable, and should be aware that this analyzer's own class name could trigger self-matching if analyzed text ever contains "EntityPatternAnalyzer." Given the precision-over-recall trade-off in `extractArtifacts()`, this table is appropriate as a fast heuristic layer but should not be treated as an authoritative or exhaustive classifier.


## Hierarchy Context

### Parent
- [ManagerPattern](./ManagerPattern.md) -- [LLM] EntityPatternAnalyzer (src/ontology/heuristics/EntityPatternAnalyzer.ts) is suffixed 'Analyzer', not 'Manager', yet it structurally resembles the Manager convention described for the parent: it builds two readonly, immutable collections in its constructor — `teamDirectories` (a `Map<string, string[]>`) and `artifactPatterns` (an array of `{team, patterns: RegExp[], entityClassMap}` objects) — and exposes exactly one lifecycle-free public method, `analyzeEntityPatterns()`. Unlike the CircuitBreakerManager/BudgetTracker pattern described in the parent observations, there is no init/start/stop, no mutable counters, and no connect/disconnect semantics; the class is effectively a stateless classifier over data frozen at construction time. This is evidence the 'Manager' suffix convention is NOT universal — naming diverges for components whose job is pure classification rather than owning a stateful external resource.

### Siblings
- [EntityPatternAnalyzer](./EntityPatternAnalyzer.md) -- [CGR] EntityPatternAnalyzer (class) in EntityPatternAnalyzer.ts


---

*Generated from 9 observations*
