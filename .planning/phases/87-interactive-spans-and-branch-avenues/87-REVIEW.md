---
phase: 87-interactive-spans-and-branch-avenues
reviewed: 2026-07-13T00:00:00Z
depth: standard
files_reviewed: 11
files_reviewed_list:
  - lib/experiments/experiment-runner.mjs
  - lib/experiments/run-launch.mjs
  - lib/vkb-server/api-routes.js
  - scripts/experiment-run.mjs
  - scripts/health-coordinator.js
  - integrations/system-health-dashboard/src/store/slices/performanceSlice.ts
  - integrations/system-health-dashboard/src/components/performance/experiment-launcher.tsx
  - tests/experiments/avenue-fork-thread.test.mjs
  - tests/experiments/experiment-runner.test.mjs
  - tests/experiments/run-endpoint.test.mjs
  - tests/experiments/run-launch.test.mjs
findings:
  critical: 0
  warning: 4
  info: 3
  total: 7
status: issues_found
---

# Phase 87: Code Review Report

**Reviewed:** 2026-07-13
**Depth:** standard
**Files Reviewed:** 11
**Status:** issues_found

> Scope: the Phase 87-07 "fork into avenues" gap-closure diff since
> `0984013dc54d0a1c82ce0bd41b8116322807b138`. This supersedes the earlier full-phase
> REVIEW pass; findings here target the newly-wired fork thread only.

## Summary

Reviewed the Phase 87-07 fork thread across the full seam chain: dashboard launcher/slice →
vkb-server `handleExperimentRun` / `handleExperimentForkPreview` → health-coordinator
`/experiments/run` → `buildRunArgv` → `experiment-run.mjs` → `runMatrix`/`runCell` →
measurement-start `--origin-span-id`.

**No BLOCKERs.** The command/argv-injection surface is well contained: every child spawn in
`run-launch.mjs`, `experiment-runner.mjs`, and the measurement CLIs is a fixed-argv array with
no `shell:true` and no template-string concatenation, so `origin_span_id` — even carrying a `/`
— reaches the runner as an inert argv value, not a shell token. The avenue basename is derived
through `sanitizeTaskId`, and `_validOriginSpanId` blocks `..`, control chars, and the bare
`.`/`..` cases before the id is used to synthesize a filename. `origin_span_id` threading
correctness is proven continuous by `avenue-fork-thread.test.mjs`.

The defects are in **input-validation completeness at the new seam** (the primary review focus):
the `sweep` request-body field is accepted by the client and forwarded but is **never read**
server-side (the sweep toggle is decorative), and a client can **bypass the fork-validation path**
by putting `avenue`/`origin_span_id` directly into `overrides`, since `_validateOverrides` does
not reject or scrutinize those keys. Two lower-severity robustness gaps (deterministic
avenue-spec filename overwrite; preview vs. launch validation asymmetry) round out the warnings.

## Structural Findings (fallow)

None provided — no `<structural_findings>` block was supplied with this review.

## Narrative Findings (AI reviewer)

### Warnings

#### WR-01: `sweep` request-body field is accepted and forwarded but never consumed server-side (dead input / decorative control)

**File:** `lib/vkb-server/api-routes.js:962` (launch destructure), `lib/vkb-server/api-routes.js:1174` (`handleExperimentForkPreview` destructure), `integrations/system-health-dashboard/src/components/performance/experiment-launcher.tsx:273,440-451`

**Issue:** The launcher renders a "Sweep (cross-product of chosen axes)" checkbox and the client
sends `sweep` in **both** the launch payload (`experiment-launcher.tsx:276`, `performanceSlice.ts:1030`)
and the fork-preview payload (`performanceSlice.ts:1017`). The `handleExperimentRun` destructure at
`api-routes.js:962` reads `{ spec, overrides, rerun_of, origin_span_id, forkAxes }` — **`sweep` is
never destructured or used**. `handleExperimentForkPreview` reads `{ origin_span_id, forkAxes, repeats }`
— again no `sweep`. `_mapForkAxesToVariants` **always** computes the full agent×model×framework×env
cross-product regardless of `sweep`. The toggle therefore changes neither the previewed `cellCount` nor
the launched matrix. This is squarely in the review's focus area ("input validation on the new
request-body fields ... sweep"): the operator believes they are gating combinatorial expansion, but the
control is inert.

**Fix:** Decide the contract and enforce it. Either (a) make `_mapForkAxesToVariants` honor `sweep`
(e.g. when `sweep === false`, vary one axis at a time / zip positionally instead of a full
cross-product), threading `sweep` into both the launch and preview call sites; or (b) if the
cross-product is always intended, remove the `sweep` state, the checkbox, and the `sweep` fields from
both payloads and the two thunks so no dead input crosses the seam. Do not leave a client-visible
control the server silently ignores.

#### WR-02: client can bypass the fork-validation path by injecting `avenue`/`origin_span_id` directly into `overrides`

**File:** `lib/vkb-server/api-routes.js:1088-1090` (`ov = { ...overrides }`), `lib/vkb-server/api-routes.js:1389-1421` (`_validateOverrides`), consumed at `lib/experiments/run-launch.mjs:83,112`

**Issue:** Fork provenance is *supposed* to enter only through the guarded top-level path: a top-level
`origin_span_id` triggers `_validOriginSpanId` → `_resolveOriginRun` (404 if unresolvable) → synthesis,
and only then sets `ov.origin_span_id` + `ov.avenue = true` (api-routes.js:1104-1107). However, `ov` is a
verbatim shallow copy of the client's `overrides` (`{ ...overrides }`, line 1089), and `_validateOverrides`
only checks the known keys `repeats`/`timeout`/`variants`/`variantOverrides` — it neither rejects unknown
keys nor scrutinizes `avenue`/`origin_span_id`. A client that POSTs
`{ spec: '<listed>.yaml', overrides: { avenue: true, origin_span_id: 'arbitrary' } }` with **no** top-level
`origin_span_id` skips the fork block entirely (`forkOriginSpanId` stays null), yet `ov.avenue` /
`ov.origin_span_id` survive into the coordinator body → `buildRunArgv` emits `--avenue --origin-span-id
arbitrary` (run-launch.mjs:83,112). This runs an avenue matrix (avenue-branch restore + commit-on-close)
against a plain listed spec and stamps an **unvalidated, never-resolved** `origin_span_id` onto every
resulting Run — defeating the `_validOriginSpanId`/`_resolveOriginRun` gates the fork path enforces. No
shell injection (fixed argv), but it is a validation/authorization bypass of the fork-only contract and
pollutes the origin-grouped ranked panel with fabricated groupings.

**Fix:** Treat `avenue`/`origin_span_id` as **server-controlled** override keys — strip them from the
client copy and reject if present before the fork block runs:
```js
const ov = overrides && typeof overrides === 'object' && !Array.isArray(overrides)
  ? { ...overrides } : {};
if ('avenue' in ov || 'origin_span_id' in ov) {
  return res.status(400).json({
    error: 'Invalid overrides',
    message: 'avenue/origin_span_id are server-derived from the top-level origin_span_id fork path and may not be set in overrides.',
  });
}
// ...only the guarded fork block may set ov.avenue / ov.origin_span_id
```
Alternatively, give `_validateOverrides` an explicit allow-list and reject any unknown key.

#### WR-03: deterministic avenue-spec filename allows silent overwrite of an in-flight/concurrent fork's spec

**File:** `lib/vkb-server/api-routes.js:1050-1051`, `lib/experiments/avenue-spec.mjs:144-153`

**Issue:** `synthesizeToYamlFile` writes to a **fully deterministic** basename
`avenue-<sanitizeTaskId(origin_span_id)>.yaml` with an unconditional `fs.writeFileSync` overwrite
(avenue-spec.mjs:148-150). Two forks of the same origin span — or a re-fork while the detached runner of a
prior fork of that origin has not yet read its spec — write the **same path**. `launchRun` spawns the
runner detached and the runner reads the spec lazily at resolve time (`experiment-run.mjs:233`), so an
overwrite in the window between persist (api-routes.js:1050) and the runner's `readFileSync` changes the
matrix the already-launched runner resolves (different `forkAxes` → different variants than were previewed
and slot-gated). The live-run 409 guard keys on the measurement span / progress.json, not the avenue-spec
file, and there is a non-zero window before the child opens the file.

**Fix:** Make the persisted spec name unique per launch by folding the minted `run_id` into the basename
(e.g. `avenue-<origin>-<run_id>.yaml`) and set `effectiveSpec` accordingly, so each detached runner reads
a spec that a later fork cannot clobber. The `.gitignore` glob `config/experiments/avenue-*.yaml` already
covers the suffixed form.

#### WR-04: fork-preview `cellCount` can report cells the launch will reject (validation asymmetry)

**File:** `lib/vkb-server/api-routes.js:1172-1195` (`handleExperimentForkPreview`) vs. `lib/vkb-server/api-routes.js:1076-1082` (launch resolves + validates the persisted spec)

**Issue:** The preview path calls `synthesizeAvenueSpec` and returns `variants.length * repeats` **without**
running the synthesized spec through `resolveExperimentSpec` / `validateCells`. The launch path (line 1078)
*does* resolve the persisted avenue spec, which runs `makeCell`/`validateCells` (agent-enum,
unsupported-combo gates). When `_mapForkAxesToVariants` seeds a model from `originRun.model` (line 1465) or
crosses an agent×model combo that `validateCells` rejects, the preview reports a positive `cellCount` and
enables the launch button, but the actual launch then bounces at `resolveExperimentSpec` with a 400
"Malformed spec" (line 1080). The operator sees an honest-looking count and a launch that fails.

**Fix:** Have `handleExperimentForkPreview` resolve the synthesized spec through the same
`resolveExperimentSpec` the launch uses and count `resolved.cells.length * resolved.repeats`, returning a
400 with the validation message when the synthesized matrix is invalid — so the previewed count and the
launch outcome cannot diverge.

### Info

#### IN-01: fork `variants` from `_mapForkAxesToVariants` are not validated against resolved cell names

**File:** `lib/vkb-server/api-routes.js:1449-1490`

**Issue:** `_validateOverrides` validates `ov.variants` / `ov.variantOverrides` keys against
`resolvedNames`, but the fork's synthesized `variants` (from `_mapForkAxesToVariants`) bypass that check —
they become the spec's cells directly. This is by design (the fork *defines* the cells), but it makes the
fork path's validation asymmetric with the rerun path. Combined with WR-04, consider centralizing a "the
launched matrix is the validated matrix" invariant.

#### IN-02: fork-mode matrix-preview equation can display `X variants × Y repeats ≠ Z cells`

**File:** `integrations/system-health-dashboard/src/components/performance/experiment-launcher.tsx:457,471-490`

**Issue:** The matrix-preview block is gated on `selectedSpec &&` and derives its `X variants` / `Y repeats`
from `selectedSpec` (the origin spec's static metadata), while the `= Z cells` term is `previewCellCount`,
which in fork mode is the axes-aware server `forkPreviewCount`. When a spec is selected in fork mode, the
rendered equation's left side (from `selectedSpec`) and right side (from the fork preview) can disagree. In
practice fork mode often has no `selectedSpec` so the block does not render, but the coupling is fragile.

**Fix:** In fork mode, render the count from `forkPreviewCount` without the `selectedSpec`-derived
`variants × repeats` framing (or compute the left side from the fork axes) so the equation is internally
consistent.

#### IN-03: `previewForkCount` rejection is swallowed into a null count with no operator-visible reason

**File:** `integrations/system-health-dashboard/src/store/slices/performanceSlice.ts:1005-1029`, `integrations/system-health-dashboard/src/components/performance/experiment-launcher.tsx:139-156`

**Issue:** When the fork-preview thunk rejects (400/404/network), the launcher's `.then` handles only
`previewForkCount.fulfilled` and otherwise leaves `forkPreviewCount` null — which correctly keeps the launch
disabled (D-02) but surfaces no reason (unlike `launchExperiment`, which renders `launchError`). A fork
whose origin cannot be resolved (404) presents as a silently-disabled launch with no explanation.

**Fix:** Capture the `previewForkCount.rejected` payload into a launcher-visible error string (mirror the
`clearLaunchError`/`launchError` idiom) so a refused preview tells the operator *why*.

---

_Reviewed: 2026-07-13_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
