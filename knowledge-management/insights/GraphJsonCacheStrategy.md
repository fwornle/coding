# GraphJsonCacheStrategy

**Type:** Detail

# GraphJsonCacheStrategy — Technical Insight Document

## What It Is

GraphJsonCacheStrategy is the mtime-based caching mechanism embedded within **GraphifyGraph** (`integrations/semantic-analysis/src/agents/graphify-graph.ts`), governing how a flat `graph.json` NetworkX node-link export is read into memory. Rather than querying a live graph database, the strategy `stat()`s the file, compares the result against the last-observed modification time, and only re-parses the (potentially tens-of-megabytes) JSON payload when the mtime has changed. No dedicated cache class exists in the codebase — the "strategy" is a behavioral pattern realized directly inside GraphifyGraph's read path, making the file itself the system of record rather than an index or database.

This pattern is not unique to GraphifyGraph. It is one instance of a recurring "file on disk as system of record" philosophy that appears elsewhere in the dashboard layer, most notably in the `/api/ukb/history` endpoint referenced via `HISTORY_PAGE_SIZE` in `integrations/system-health-dashboard/src/components/ukb-workflow-modal.tsx`, which reads and parses every report on every call rather than maintaining an incremental index.

## Architecture and Design

The defining architectural decision is to treat correctness as a function of **full re-reads** rather than **incremental updates**. GraphJsonCacheStrategy achieves consistency by invalidating and reloading the entire artifact whenever it changes, rather than tracking deltas. This mirrors the full-read-then-slice pagination pattern in `ukb-workflow-modal.tsx`, where `HISTORY_PAGE_SIZE` was raised from 50 to 500 to counteract silent truncation — both are examples of widening the effective window of a batch read as a fix, rather than introducing true incremental or ground-truth querying.

This coarse-grained approach has a notable consistency advantage over fine-grained state synchronization. As observed in comparison to `ukbSlice.ts`'s `WorkflowExecutionState` and `multi-agent-graph.tsx`'s `getNodeStatus`/`shouldShowEdge`, which derive live UI state from many small incremental Redux actions (`fetchHistorySuccess`, `syncStepPauseFromServer`), GraphJsonCacheStrategy's blast radius is bounded: a stale read yields an outdated but **internally consistent** full snapshot, whereas incremental state sync risks internally *inconsistent* state (e.g., mismatched `stepStatuses` vs. `currentStep`). Coarse whole-file caching thus trades freshness for stronger consistency guarantees — a deliberate architectural trade-off rather than an oversight.

The strategy also exemplifies a broader performance idiom shared with `multi-agent-graph.tsx`'s module-scope constants `KG_OPERATOR_CHILDREN`/`WAVE_AGENTS`: both avoid unnecessary recomputation by gating expensive work behind an invariance check (mtime comparison vs. hoisting arrays outside the render path) rather than paying O(n) cost on every access cycle.

## Implementation Details

Mechanically, the strategy relies on a simple guard: compare the file's current mtime against a stored value; if unchanged, serve the cached parsed structure; if changed, re-parse the full JSON and update the stored mtime. This lazy-invalidation approach means GraphifyGraph "cannot see a code-structure change until the separate graphify analysis pipeline finishes a full re-write of the JSON artifact" — staleness is bounded by the producer's write cadence, not by any consumer-side polling interval.

Downstream, GraphifyGraph's `kindOf()`/`nameOf()` functions parse a loosely-typed `label` string field from the cached graph to derive semantic categories. This is structurally analogous to `color-fallback.ts`'s `nodeFillColor()` and `nodeShapeFor()`, which perform similar low-cardinality palette derivation from string-typed fields — but the color-fallback implementation is more defensive, walking a parent chain via `registry.get(cur).parent` and falling back through `BATCH_PALETTE`/`ONLINE_PALETTE` before defaulting to `DEFAULT_BATCH`. GraphJsonCacheStrategy's consumers have no equivalent fallback chain: a producer-side label format change would silently break `kindOf()`/`nameOf()` parsing with no compile-time contract to catch it.

## Integration Points

GraphJsonCacheStrategy is entirely internal to its parent, **GraphifyGraph**, which is the sole consumer of the cached, parsed graph structure. Beyond that direct relationship, its integration is best understood through analogy rather than direct coupling: it shares the "file as API" philosophy with system-health-dashboard's bind-mount VirtioFS caching issue (which required a forced container restart to invalidate a stale read), and shares the batch-read-then-slice philosophy with `ukb-workflow-modal.tsx`'s `/api/ukb/history` endpoint.

On the semantic-derivation side, GraphifyGraph's string-based `kindOf()`/`nameOf()` parsing sits in the same conceptual space as `D3GraphCanvas.tsx`'s `D3Node` interface, which explicitly separates `entityType` from `ontologyClass` to express cases where raw type and canonical class disagree (e.g., CollectiveKnowledge: ontologyClass=Detail, entityType=System). Where D3GraphCanvas.tsx has a first-class dual-field schema for this disagreement, GraphifyGraph's cache has no structural safeguard — the label string is simultaneously the source of both kind and name with no schema enforcement.

## Usage Guidelines

Developers extending or consuming GraphifyGraph should treat graph.json as an eventually-consistent artifact: any change to the underlying analysis pipeline's output format for the `label` field can silently break `kindOf()`/`nameOf()` parsing, since there is no schema contract analogous to color-fallback.ts's parent-chain fallback or D3GraphCanvas.tsx's `entityType`/`ontologyClass` split. Adding a similar defensive fallback (or at minimum validation/logging on unparseable labels) would close this gap.

When reasoning about staleness bugs, recognize this class of defect recurs across the dashboard layer — the mtime cache here is architecturally the same category of issue as `HISTORY_PAGE_SIZE`'s prior silent truncation bug and system-health-dashboard's VirtioFS staleness. Fixes in this codebase have consistently taken the form of widening the read window (raising page size, invalidating via mtime) rather than introducing real incremental queries; future changes should be aware this is a deliberate, recurring trade-off of operational simplicity over real-time correctness, not an isolated shortcut.


## Hierarchy Context

### Parent
- [GraphifyGraph](./GraphifyGraph.md) -- [LLM] GraphifyGraph (integrations/semantic-analysis/src/agents/graphify-graph.ts) inverts the conventional graph-database architecture by treating a flat, periodically-regenerated graph.json file as the system of record instead of a live queryable store. The mtime-based lazy-caching strategy — stat() the file, compare against the last-seen mtime, and only re-parse the (potentially tens-of-megabytes) NetworkX node-link export when it changes — is a classic read-heavy optimization, but it also means GraphifyGraph is fundamentally a batch-consistency component: it cannot see a code-structure change until the separate graphify analysis pipeline finishes a full re-write of the JSON artifact. This is architecturally similar to the mtime/staleness problem the dashboard integration explicitly worked around elsewhere in this codebase (system-health-dashboard's bind-mount VirtioFS caching required a forced container restart to invalidate a stale read) — both are instances of 'a file on disk is the API' trading real-time correctness for operational simplicity.


---

*Generated from 9 observations*
