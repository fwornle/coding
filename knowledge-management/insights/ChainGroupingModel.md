# ChainGroupingModel

**Type:** Detail

describeKey(key) extracts date/window/redirect metadata from the chain key using a regex matching patterns like 'S\d+-\d+-' for sub-agent detection and '_from-' for redirect origin.

# ChainGroupingModel — Technical Insight Document

## What It Is

ChainGroupingModel is the conceptual model implemented in `lsl-sessions.mjs` that governs how individual transcript files are grouped into "chains" — hourly tranches of related files, including rotation parts — rather than being treated as single, standalone sessions. As the internal grouping engine used by its parent, LslSessionDashboard, it is responsible for identity (via `chainId`/`parseChainId`), classification (via format detection in `listSessions`), key parsing (`describeKey`), metadata aggregation (`peekMeta`), and reverse resolution of a chain back to its constituent files (`resolveChain`).

The model exists because a chain is not a 1:1 mapping to a file: legacy `-N_` markdown parts are headerless fragments that were split mid-token, and pi-format parts are linked together via `parentSession`. ChainGroupingModel's job is to reassemble these fragments into a coherent logical unit and expose that unit through a stable, reversible identifier.

## Architecture and Design

The dominant pattern is **opaque-but-reversible identifier design**: `chainId(project, year, month, key)` constructs an id of the shape `<project>/<yyyy>/<mm>/<chainKey>`, and `parseChainId` deconstructs it via regex. This id acts as a portable handle that can be persisted, passed to a UI, and later resolved back into concrete files without the caller needing to understand the underlying grouping logic.

A second architectural theme is **derive-don't-store classification**: format ('pi', 'mixed', 'markdown') is not a stored attribute of a chain but a computed property, determined in `listSessions` by inspecting whether all, some, or none of a chain's parts end in `.jsonl`. This keeps the grouping model stateless and recomputable from the file system at any time, which pairs naturally with `resolveChain`'s design of re-deriving parts by re-running `groupChains` against `listTranscriptFiles` rather than caching part lists.

The key-parsing logic in `describeKey` uses targeted regexes (`S\d+-\d+-` for sub-agent detection, `_from-` for redirect origin) to extract semantic metadata embedded in the chain key itself, treating the key as a mini encoding scheme rather than an arbitrary string.

## Implementation Details

- **`chainId(project, year, month, key)`**: Builds the composite id string; paired with `parseChainId`, which uses a regex to extract the same four components back out. This is the round-trip contract the whole model depends on.
- **`listSessions`**: Calls `groupChains(files)` to cluster raw files into chains, then computes the `format` field per chain by checking `.jsonl` suffix presence across all parts — 'pi' (all), 'mixed' (some), or 'markdown' (none).
- **`describeKey(key)`**: Regex-driven extraction of date, window, and redirect metadata from the chain key, detecting sub-agent chains (`S\d+-\d+-` pattern) and redirect origins (`_from-` pattern).
- **`peekMeta(parts)`**: Deliberately iterates over ALL parts of a chain, not just the first, to aggregate agent name and prompt-set counts — motivated by the observation that a 12-part tranche can contain 48 prompt sets total, so first-part-only inspection would drastically undercount.
- **`resolveChain(codingRoot, id)`**: Reverses the process — parses the id into project/year/month/key via `parseChainId`, then re-runs `groupChains` against `listTranscriptFiles` to relocate the actual part files belonging to that chain.

## Integration Points

ChainGroupingModel is a subordinate concept within LslSessionDashboard (`lsl-sessions.mjs`), which defines the chain abstraction itself (hourly tranche + rotation parts) that the model operationalizes. It sits alongside two siblings:

- **MixedFormatLivePreview**, which relies on chains potentially being 'mixed' format and converts `.md` chain parts in memory "through the same parser and writer the backfill uses" — meaning ChainGroupingModel's format classification directly determines which rendering path a chain takes in the viewer.
- **ProjectDiscovery**, which supplies the `codingRoot` context (via `discoverProjects`) that `resolveChain` and `listTranscriptFiles` depend on to locate files across host vs. bind-mounted container paths.

The dependency on `listTranscriptFiles` and `groupChains` (presumably shared utilities within `lsl-sessions.mjs`) means ChainGroupingModel is not a standalone module but a set of cooperating functions layered on top of a common file-listing/grouping primitive.

## Usage Guidelines

- Always treat chain ids as opaque tokens produced by `chainId`/parsed by `parseChainId` — do not manually construct or string-manipulate them, since the format is a contract shared with `resolveChain`.
- When computing metadata (agent name, prompt-set counts), use `peekMeta` semantics of scanning all parts, not just the first — assuming single-part behavior will undercount multi-part tranches significantly.
- Format classification ('pi'/'mixed'/'markdown') should be treated as derived state, recomputed from current file contents rather than cached, to stay consistent with how `listSessions` and downstream consumers like MixedFormatLivePreview expect it to behave.
- Because `resolveChain` re-derives parts by re-scanning the filesystem, callers should not assume performance is free — resolution involves a full `groupChains`/`listTranscriptFiles` pass rooted at `codingRoot`, which itself depends on correct project discovery (see ProjectDiscovery) to point at the right root in containerized vs. host environments.


## Hierarchy Context

### Parent
- [LslSessionDashboard](./LslSessionDashboard.md) -- lsl-sessions.mjs defines a chain as an hourly tranche including rotation parts, not a single file, because legacy '-N_' markdown parts are headerless fragments split mid-token and pi-format parts are linked via parentSession

### Siblings
- [MixedFormatLivePreview](./MixedFormatLivePreview.md) -- lsl-sessions.mjs header states '.md chains are converted IN MEMORY through the same parser and writer the backfill uses' so the viewer matches backfill output exactly.
- [ProjectDiscovery](./ProjectDiscovery.md) -- discoverProjects(codingRoot) scans path.resolve(codingRoot, '..') plus an optional LSL_WORKSPACE_ROOT (default '/workspace') because sibling projects are bind-mounted differently inside coding-services container vs on host.


---

*Generated from 5 observations*
