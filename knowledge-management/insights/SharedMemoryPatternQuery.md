# SharedMemoryPatternQuery

**Type:** Detail

verify-patterns.sh runs `jq -r '.entities[] | select(.entityType == "TransferablePattern" and .significance >= 8) | .name' "$SHARED_MEMORY"` to pull pattern names at runtime rather than hardcoding them.

# SharedMemoryPatternQuery: Technical Insight Document

## What It Is

SharedMemoryPatternQuery is a query mechanism implemented within `verify-patterns.sh` that dynamically retrieves high-significance patterns from a JSON-based knowledge base file referenced by the `$SHARED_MEMORY` variable. Rather than embedding pattern names as static strings in the verification script, this component uses `jq` to extract pattern data at runtime:

```
jq -r '.entities[] | select(.entityType == "TransferablePattern" and .significance >= 8) | .name' "$SHARED_MEMORY"
```

This single line of shell/jq logic constitutes the core of the query: it filters a JSON entity array down to only those records classified as `TransferablePattern` with a `significance` score of 8 or higher, then extracts just the `.name` field for downstream use. As a child component of ConfigAsCodeConvention, SharedMemoryPatternQuery embodies that parent's core philosophy — treating pattern definitions as external, queryable configuration data rather than code-embedded constants.

## Architecture and Design

The architectural approach here is a **data-driven verification pattern**: instead of hardcoding the list of patterns to verify, the script treats the knowledge base file as the single source of truth and queries it dynamically. This is a deliberate decoupling decision — the verification logic in `verify-patterns.sh` remains stable even as the underlying pattern catalog evolves, since new patterns automatically become subject to verification once they're added to `$SHARED_MEMORY` with the correct `entityType` and `significance` attributes.

The design also incorporates a **defensive existence check**, guarding the entire query with `if [ -f "$SHARED_MEMORY" ]`. This ensures the script degrades gracefully — rather than failing with a jq parse error or shell crash — when the knowledge base file doesn't exist, an important consideration for environments where the shared memory file may not yet have been generated or may be optionally present.

The significance threshold (>= 8) represents a filtering/prioritization design decision: not all entities of type `TransferablePattern` are surfaced, only those deemed high-priority. This keeps the verification report focused and actionable rather than noisy with low-value pattern checks.

## Implementation Details

The query is a single `jq` invocation embedded directly in shell script logic — there are no dedicated classes or functions wrapping it (0 code symbols were identified, consistent with this being a shell/jq expression rather than a compiled or object-oriented construct). The mechanics break down as follows:

1. **Selection**: `.entities[]` iterates over the entities array in the JSON knowledge base.
2. **Filtering**: `select(.entityType == "TransferablePattern" and .significance >= 8)` applies a compound boolean filter combining type-matching and a numeric threshold comparison.
3. **Projection**: `.name` extracts just the pattern name field, discarding other entity metadata (descriptions, relationships, etc.) that isn't needed for verification.
4. **Raw output**: the `-r` flag ensures jq emits raw strings (unquoted) suitable for shell consumption rather than JSON-quoted strings.

The output of this query feeds directly into a `while IFS= read -r pattern` loop, which iterates over each returned pattern name line-by-line. Within this loop, the script performs codebase usage checks for each pattern name and appends findings to `$VERIFICATION_REPORT`. This establishes a clear pipeline: **query → iterate → verify → report**.

## Integration Points

SharedMemoryPatternQuery is tightly integrated with its parent, ConfigAsCodeConvention, which frames the broader convention of reading pattern definitions dynamically from JSON rather than hardcoding them into scripts. The query's output is directly consumed by the surrounding `while` loop in `verify-patterns.sh`, making it an upstream dependency for the codebase-usage-verification step.

Its primary external dependency is the `$SHARED_MEMORY` file itself — a JSON document containing an `entities` array with objects that must include `entityType`, `significance`, and `name` fields to be compatible with this query's filtering logic. Any downstream consumer of pattern data (such as the verification loop) depends implicitly on this schema contract. The `$VERIFICATION_REPORT` variable represents the output integration point, where results of processing each queried pattern are accumulated.

## Usage Guidelines

When adding new patterns intended for automatic verification, ensure entities in `$SHARED_MEMORY` are tagged with `entityType == "TransferablePattern"` and assigned a `significance` value of 8 or higher — anything below this threshold will silently be excluded from verification, which is by design but should be understood by contributors curating the knowledge base.

Developers should preserve the existence check (`if [ -f "$SHARED_MEMORY" ]`) when modifying `verify-patterns.sh`, since removing it would reintroduce a hard failure mode when the shared memory file is absent — undermining the graceful degradation this component currently provides.

Because the query strictly extracts `.name` and discards other fields, any downstream logic requiring additional entity metadata (e.g., descriptions, relationships) would need a separate or expanded jq query — this component is intentionally minimal and single-purpose, aligned with the parent ConfigAsCodeConvention's emphasis on simple, declarative configuration reads over complex embedded logic.


## Hierarchy Context

### Parent
- [ConfigAsCodeConvention](./ConfigAsCodeConvention.md) -- verify-patterns.sh reads pattern definitions dynamically from a jq-queried JSON knowledge base file ($SHARED_MEMORY) filtering entities by entityType == 'TransferablePattern' and significance >= 8


---

*Generated from 4 observations*
