# MixedFormatLivePreview

**Type:** Detail

Rendering reuses pi's own exported HTML shell (assets/pi-export-shell.html) refreshed by scripts/vendor-pi-export-shell.mjs, avoiding a runtime dependency on the pi tool which is not installed in the container.

# MixedFormatLivePreview — Technical Insight Document

## What It Is

MixedFormatLivePreview is a rendering feature implemented within `lsl-sessions.mjs` and `lsl-sessions.tsx`, responsible for presenting session "chains" — as defined by the parent component **LslSessionDashboard** — that may span multiple content formats within a single logical unit. A chain, per the dashboard's own definition, is an hourly tranche potentially composed of legacy headerless markdown rotation parts and pi-format parts linked via `parentSession`. Because a single chain can mix these formats, MixedFormatLivePreview exists to parse, badge, and render that heterogeneous content coherently in the UI.

## Architecture and Design

The core architectural decision is **parity-by-construction**: rather than building a bespoke preview parser, `.md` chains are converted in memory using "the same parser and writer the backfill uses" (per the `lsl-sessions.mjs` header comment). This guarantees the live preview is never a divergent second implementation — what you see in the viewer is guaranteed to match what backfill would persist to disk. This is a deliberate trade-off favoring correctness and consistency over rendering-path independence or performance isolation.

A second key pattern is **shell reuse over runtime dependency**. Instead of invoking the actual `pi` tool at render time (which is not installed in the container), the system reuses pi's own exported HTML shell (`assets/pi-export-shell.html`), kept fresh via `scripts/vendor-pi-export-shell.mjs`. This is a vendoring pattern: a build/update script snapshots an external tool's output artifact so the runtime environment never needs the tool itself. This decouples container dependencies from rendering fidelity.

Format detection is handled via a dedicated classification step, `peekMeta`, which distinguishes markdown from JSONL content using different heuristics — regex matching (`**Agent:**`, `<a name="ps_\d+">`) for markdown, versus structured `JSON.parse` per line with `customType` checks (`lsl.tranche`, `lsl.promptSet`) for JSONL. This bifurcated detection strategy reflects the underlying reality that legacy and modern formats have fundamentally different structural guarantees.

## Implementation Details

`FormatBadge` (in `lsl-sessions.tsx`) is the visual component surfacing format identity to the user, rendering distinct badges for `pi`, `markdown`, and `mixed` formats. Its styling explicitly accounts for accessibility/contrast concerns — light and dark themed variants exist because "-400 shades... wash out on white," indicating attention to real-world visual QA rather than a purely systematic color scheme.

`peekMeta` acts as the format sniffer: for markdown it looks for authorship markers and promptSet anchors; for JSONL it parses line-by-line and inspects `customType` values. This function's output presumably feeds both the badge rendering and the parser dispatch decision (markdown vs. pi conversion path).

The in-memory conversion path reuses the backfill's parser and writer directly — implying these are shared, importable modules rather than duplicated logic, though the specific parser/writer module names are not enumerated in the observations.

## Integration Points

MixedFormatLivePreview sits inside **LslSessionDashboard**, alongside sibling concerns **ChainGroupingModel** and **ProjectDiscovery**. While it doesn't directly depend on `ChainGroupingModel`'s `chainId`/`parseChainId` logic per the observations, it operationally relies on the dashboard's chain concept — the same chains whose opaque IDs `ChainGroupingModel` constructs are the units this preview renders across mixed formats. Its dependency on the backfill parser/writer ties it directly to the backfill subsystem's correctness; any parser change automatically propagates to the preview. Its dependency on `assets/pi-export-shell.html` ties it to `scripts/vendor-pi-export-shell.mjs` as a build-time/maintenance dependency rather than a runtime one.

## Usage Guidelines

Developers modifying markdown or JSONL parsing logic for backfill should recognize that MixedFormatLivePreview will automatically inherit those changes, since it reuses the same parser/writer — this is a feature, not a bug, but it means backfill logic changes should be tested with mixed-format chains in mind. When updating pi's export format, `scripts/vendor-pi-export-shell.mjs` must be re-run to refresh `assets/pi-export-shell.html`, or the preview will drift from actual pi output. When adding new format types beyond `pi`/`markdown`/`mixed`, both `FormatBadge` and `peekMeta`'s detection heuristics need corresponding updates, and dark/light theming should be verified against washout issues at the -400 color shade level.


## Hierarchy Context

### Parent
- [LslSessionDashboard](./LslSessionDashboard.md) -- lsl-sessions.mjs defines a chain as an hourly tranche including rotation parts, not a single file, because legacy '-N_' markdown parts are headerless fragments split mid-token and pi-format parts are linked via parentSession

### Siblings
- [ChainGroupingModel](./ChainGroupingModel.md) -- chainId(project, year, month, key) builds an opaque reversible id of shape '<project>/<yyyy>/<mm>/<chainKey>', parsed back by parseChainId via regex.
- [ProjectDiscovery](./ProjectDiscovery.md) -- discoverProjects(codingRoot) scans path.resolve(codingRoot, '..') plus an optional LSL_WORKSPACE_ROOT (default '/workspace') because sibling projects are bind-mounted differently inside coding-services container vs on host.


---

*Generated from 4 observations*
