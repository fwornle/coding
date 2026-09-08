# ProjectDiscovery

**Type:** Detail

discoverProjects(codingRoot) scans path.resolve(codingRoot, '..') plus an optional LSL_WORKSPACE_ROOT (default '/workspace') because sibling projects are bind-mounted differently inside coding-services container vs on host.

# ProjectDiscovery — Technical Insight Document

## What It Is

ProjectDiscovery is a discovery layer within the `LslSessionDashboard` system, centered on the function `discoverProjects(codingRoot)`. Its job is to locate valid "projects" on disk — directories that contain a `.specstory/history` subdirectory — by scanning both the parent of a given `codingRoot` (via `path.resolve(codingRoot, '..')`) and an optional, environment-configurable sibling root (`LSL_WORKSPACE_ROOT`, defaulting to `/workspace`). Alongside project discovery, this component includes helper functions `listMonths(history)` and `listTranscriptFiles` (with its `isLsl(n)` filter) that traverse and filter the internal structure of a discovered project's history directory.

## Architecture and Design

The defining architectural decision here is **dual-root scanning to account for divergent container/host mount topologies**. Because the coding-services container bind-mounts sibling projects differently than they appear on the host filesystem, `discoverProjects` cannot rely on a single relative-path heuristic (`path.resolve(codingRoot, '..')`). Instead, it layers a second, explicitly configurable root (`LSL_WORKSPACE_ROOT`) on top, making the discovery logic environment-agnostic rather than hardcoded to one deployment context. This is a pragmatic trade-off: rather than building an abstraction over filesystem layout, the code simply checks multiple candidate locations.

Qualification logic is deliberately minimal and convention-based: presence of `.specstory/history` is the sole signal that a directory is a "project." This keeps ProjectDiscovery decoupled from the internal semantics of what a project contains — that responsibility is delegated to downstream consumers like the parent `LslSessionDashboard` and sibling `ChainGroupingModel`.

Within a discovered project, structure is further decomposed by time: `listMonths(history)` uses regex-based enumeration of `YYYY/MM` subdirectories, sorted newest-first specifically to serve the dashboard's default (most-recent) view — indicating the discovery layer is shaped directly by UI/UX requirements of its parent component.

## Implementation Details

`discoverProjects(codingRoot)` performs its scan by resolving two candidate base directories — the parent of `codingRoot`, and the `LSL_WORKSPACE_ROOT` (env-overridable, default `/workspace`) — and testing each candidate subdirectory for a `.specstory/history` folder as the qualifying condition.

`listMonths(history)` operates one level down: given a project's history directory, it applies a regex to find `YYYY/MM`-shaped subdirectories, then sorts them in descending (newest-first) order. This ordering is not incidental — it directly supports the dashboard's default landing view, coupling this utility's output contract to UI consumption patterns.

`listTranscriptFiles` filters raw directory entries through `isLsl(n)`, a predicate that only accepts filenames ending in `.jsonl` or `.md`. This explicit exclusion of "logs/classification or docs files" indicates the directories being scanned are mixed-content (containing non-transcript artifacts), and the filter exists to prevent misclassification of unrelated files as session transcripts.

## Integration Points

ProjectDiscovery is contained by `LslSessionDashboard`, which relies on it as the entry point for populating the dashboard's project list and default month view. Its output feeds into sibling components: `ChainGroupingModel` consumes discovered project/year/month structure to build opaque chain IDs of the form `<project>/<yyyy>/<mm>/<chainKey>` via `chainId(...)`, meaning ProjectDiscovery's directory taxonomy (project → year → month) is the schema that `ChainGroupingModel`'s ID scheme is built on top of.

The `.md` files surfaced by `listTranscriptFiles` (via `isLsl`) are also the raw input consumed by `MixedFormatLivePreview`, which converts `.md` chains in memory using the same parser/writer as the backfill process — meaning ProjectDiscovery's filtering decisions (what counts as a transcript file) directly determine what enters that conversion pipeline.

Environment configuration (`LSL_WORKSPACE_ROOT`) is the primary external dependency/integration surface, tying this component's correctness to deployment/container configuration rather than pure code logic.

## Usage Guidelines

Developers extending or debugging ProjectDiscovery should treat `.specstory/history` presence as the canonical, sole qualification check for "is this a project" — any change to this convention has cascading effects on `LslSessionDashboard`, `ChainGroupingModel`, and transcript discovery. When deploying in new environments, ensure `LSL_WORKSPACE_ROOT` is correctly set if the container's mount layout diverges from `path.resolve(codingRoot, '..')`, since silent mis-scanning (missing or duplicate projects) is the primary failure mode of this dual-root approach. When adding new file types to transcript directories, update `isLsl(n)` deliberately — it currently hard-excludes anything other than `.jsonl`/`.md`, so new legitimate transcript formats will be silently filtered out. Finally, since `listMonths` sorting is newest-first by design intent (dashboard default view), any reordering should be treated as a UX-affecting change, not just an implementation detail.


## Hierarchy Context

### Parent
- [LslSessionDashboard](./LslSessionDashboard.md) -- lsl-sessions.mjs defines a chain as an hourly tranche including rotation parts, not a single file, because legacy '-N_' markdown parts are headerless fragments split mid-token and pi-format parts are linked via parentSession

### Siblings
- [ChainGroupingModel](./ChainGroupingModel.md) -- chainId(project, year, month, key) builds an opaque reversible id of shape '<project>/<yyyy>/<mm>/<chainKey>', parsed back by parseChainId via regex.
- [MixedFormatLivePreview](./MixedFormatLivePreview.md) -- lsl-sessions.mjs header states '.md chains are converted IN MEMORY through the same parser and writer the backfill uses' so the viewer matches backfill output exactly.


---

*Generated from 4 observations*
