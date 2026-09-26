// Phase 56 Plan 04 round 4 — pure visibility predicate.
//
// Extracted from D3GraphCanvas.tsx `visibleEntities` useMemo body
// (lines 244-337) so the predicate can be shared between the D3 canvas
// and the new `useVisibleEntityIds` hook (the LSL strip's source of truth
// for round-4 phantom-id resolution).
//
// Behaviour is bit-identical to the prior inline predicate. Tests:
//   - D3GraphCanvas test gates G1-G5 + G9-G13 (source-grep) continue to
//     pass — D3GraphCanvas still computes its `visibleEntities` memo via
//     this predicate; the dep list shape is preserved.
//   - Round-4 RED tests T-F/T-G/T-H (LslTimelineStrip.test.tsx) drive
//     the strip's onTickClick path through `useVisibleEntityIds`, which
//     calls this predicate.

import { learningSourceOf } from './learning-source'
import type { Entity } from './types'
import { deriveLayer } from './layer'
import { deriveLevel } from './graph-builder'

export interface VisibilityFilters {
  /** Already-lowercased search query for case-insensitive substring match. */
  searchQueryLowered: string
  selectedTeams: ReadonlySet<string>
  learningSource: 'combined' | 'online' | 'batch' | string
  selectedLayers: readonly string[]
  hideDocNodes: boolean
  /**
   * Hide rows the roll-up pass folded behind a subsystem-level parent:
   * `metadata.archivedAt` AND `metadata.rolledUpInto`. Archiving is an obs-api
   * TYPED-VIEW concept — `/api/coding/insights` filters it — but the viewer
   * reads `/api/v1/*`, km-core's generic router, which knows nothing about it.
   * So a corpus rolled up from 678 insights to 40 still renders all 678 here
   * unless this is on.
   *
   * SPLIT FROM `hideArchived` (2026-09-25). One flag used to hide everything
   * carrying `archivedAt`, under a label that named only one of the two
   * populations that field marks. The distinction is not cosmetic:
   *
   *   rolled up  archivedAt + rolledUpInto   1,261 rows.  A parent stands in
   *              for them on the canvas, so hiding them loses no information.
   *   stale      archivedAt, no rolledUpInto     9 rows.  Archived by the
   *              ratio=0 sweep — "code claims no longer exist". NOTHING stands
   *              in for them; hiding them removes the row outright.
   *
   * Hiding the second silently, under a checkbox that says "rolled-up", is how
   * a row disappears and nobody goes looking for it. See `showStale`.
   */
  hideRolledUp: boolean
  /**
   * Show rows archived as stale (`archivedAt`, no `rolledUpInto`). Default
   * FALSE — measured-wrong knowledge is out of the default view at every
   * detail level, and reachable in one click from Advanced > Content.
   */
  showStale: boolean
  selectedClasses: ReadonlySet<string>
  visibleLevels: ReadonlySet<0 | 1 | 2 | 3>
  lslFilterEntityIds: ReadonlySet<string> | null
  /**
   * Hierarchy navigator subtree focus: the entity ids the clicked row stands
   * for, resolved by `graph/subtree-members.ts` (the row, its subtree, and the
   * code-tree ancestors that anchor them). `null` = no subtree focus.
   *
   * NO structural exemption, unlike the teams / learningSource / LSL rules
   * above. Those filters narrow WHICH artifacts to look at and keep the
   * backbone so the survivors stay attached; this one narrows WHICH PART OF
   * THE BACKBONE to look at, so exempting System/Project/Component would
   * re-admit all 26 projects and leave the filter with nothing to do. The
   * anchoring those exemptions buy is bought here instead by the ancestor walk
   * in the resolver — the chain above the clicked row is in the set, every
   * other branch is not.
   */
  hierarchySubtreeIds?: ReadonlySet<string> | null
  /**
   * Legend click-to-toggle: ontologyClass names the operator switched off in
   * the LegendPanel. Lives INSIDE the filter object on purpose.
   *
   * It used to be a separate `&& !hiddenNodeTypes.has(e.ontologyClass)` guard
   * bolted onto each `isEntityVisible` call. That made it forgettable, and it
   * was duly forgotten: `useVisibleEntityIds` omitted it, so the LSL strip and
   * the bucket list disagreed with the canvas about every hidden type. A rule
   * that must be remembered at each call site is a rule that will drift.
   *
   * Optional so a partial test filter compiles; `undefined` = nothing hidden,
   * identical to the empty-Set default the store starts with.
   */
  hiddenNodeTypes?: ReadonlySet<string>
  /**
   * Aggregates-only view: render ONLY roll-up parents plus the structural
   * backbone (System/Project/Component).
   *
   * The roll-up folds ~25 granular rows into one subsystem-level parent, but
   * the parent is written with `ontologyClass: 'Insight'` — deliberately, see
   * repair-rollup-parent-class.mjs: setting it to the subsystem made the
   * parent match neither the typed view nor the class filter and it vanished
   * from the Insights page entirely. The consequence is that no class, level
   * or team filter can separate "the 64 aggregates" from "the 219 rows nobody
   * has rolled up yet" — the aggregation layer exists in the data and is
   * unaddressable from the UI, which is why a corpus condensed 678 -> 40 still
   * renders as a hairball.
   *
   * Parents are identifiable by `metadata.rollUpOf` (their child id list).
   * This flag is the filter over that field.
   */
  aggregatesOnly?: boolean
  /**
   * Collapse SubComponents behind their Component. A SubComponent is visible
   * only while its parent Component is in `expandedComponentIds`.
   *
   * The parent lookup cannot happen in here — this predicate sees one entity
   * and knows nothing about edges — so the resolved map is passed in. See
   * `hierarchyParents` in the store for who builds it.
   */
  collapseSubComponents?: boolean
  expandedComponentIds?: ReadonlySet<string>
  hierarchyParents?: ReadonlyMap<string, string>
  /**
   * Ontology class of an ANCESTOR id, for the transitive collapse walk. The
   * predicate is handed one entity and cannot look another up, and the walk
   * needs to know which ancestor is the SubComponent. Optional: when absent
   * the collapse degrades to the immediate-parent behaviour it had before,
   * which is wrong but not broken — the same fail-toward-visible choice the
   * rest of this file makes.
   */
  hierarchyClassOf?: (id: string) => string | undefined
  /**
   * Which of the two trees is on screen — the rail's Code|Intent switch.
   *
   * `Intent` rows render only in `'intent'`. The two trees are joined at the
   * Insight and nowhere else (graph/intent-spine.ts), so drawing both node
   * populations on one canvas is the conflation the spine exists to remove.
   *
   * IT SHOWED UP AS CONFETTI, WHICH IS WHY THIS EXISTS. Overview collapses the
   * Insight layer — the joint. The Intents kept rendering with every child
   * gone: 19 visible, 12 of them with no drawn edge at all. `buildRehomeEdges`
   * cannot save them either, and not by oversight — it walks UP over
   * containment edges, and an Intent has zero inbound edges of any type while
   * its 4-to-87 `aggregates` all point DOWN. Adding `aggregates` to
   * ANCHOR_EDGE_TYPES would not help (still the wrong direction) and making
   * the walk bidirectional would draw an Intent hanging off a Component by a
   * synthetic `contains` that misstates the hierarchy — exactly what that
   * module promises not to invent.
   *
   * REQUIRED, no `?`. `showDebugEntityTypes` is required for the same reason
   * (checker W-2): a defaulted field is one a call site can forget, and the
   * project-wide `tsc --noEmit` gate is the only thing that catches a
   * half-deployed consumer. `useVisibleEntityIds`'s missing `hiddenNodeTypes`
   * is the precedent — it drifted for exactly as long as it was optional.
   */
  hierarchySpine: 'code' | 'intent'
  /**
   * Phase 60 Plan 01 (G1): ontology registry (subset shape — `name` +
   * extends-chain `parent`) consumed by `deriveLayer` for L2 inference.
   * Optional so existing call sites compile until the registry is threaded
   * through (`useVisibleEntityIds`, `D3GraphCanvas.visibleEntities`,
   * `LayerFilter`). When undefined, `deriveLayer` falls back to the
   * direct-class rule (Pattern/Insight → pattern) — same behaviour as the
   * pre-Phase-60 inline rule.
   */
  ontologyRegistry?: readonly { name: string; parent?: string | null }[]
  /**
   * Phase 60 Plan 03 (G3) — D-09..D-11: when `true`, the predicate skips the
   * Observation/Digest hard-exclusion branch so operators can debug those
   * types in the rendered graph. Default `false` (architecture-bleed shield
   * ON). Required field (no `?`) per checker W-2: forces every call site to
   * pass the flag explicitly so the project-wide `tsc --noEmit` gate surfaces
   * any half-deployed site that could otherwise leak Observation/Digest.
   *
   * The predicate body reads `filters.showDebugEntityTypes !== true` (not a
   * direct boolean check). That intentional `!== true` means a runtime
   * `undefined` (e.g., a partial mock in a test, or a transient store-init
   * race) still causes the exclusion to fire — the safer default for a
   * security-shaped shield.
   */
  showDebugEntityTypes: boolean
}

/**
 * Returns true when the entity should render in the D3 graph (and in
 * any consumer that wants the SAME predicate the D3 canvas uses).
 *
 * Mirror of `D3GraphCanvas.tsx:244-337` — see comments there for the
 * rationale of each filter step (structural-exemption rules for teams /
 * learningSource / LSL filter, the `[Raw]` stub exclusion, the
 * Observation/Digest hard exclusion gated by `filters.showDebugEntityTypes`
 * — Phase 60 Plan 03 — layer inference fallback, etc.).
 *
 * Phase 60 Plan 03 (G3 — D-09..D-11): the Observation/Digest hard-exclusion
 * is the default architecture-bleed shield. Operators can flip
 * `filters.showDebugEntityTypes = true` (wired via `GraphToggles`) to
 * unhide those types. The flag is read defensively (`!== true`) so an
 * undefined runtime value behaves identically to false.
 */
/**
 * Classes the SubComponent collapse governs — everything at or below the
 * collapse frontier. Backbone classes (System/Project/Component) are never
 * collapsed by it; they ARE the aggregated view.
 *
 * `Insight` is here for the same reason `Detail` is: it is a leaf-level
 * artifact, so at the aggregated level it is below the frontier no matter
 * which parent it belongs to.
 *
 * THAT INDEPENDENCE IS THE POINT. An Insight's placement comes from
 * `metadata.parentId`, which stage 4 chose by a rarity heuristic over the
 * mentions edges and which its own write-up calls "a mechanical prior... not
 * a semantic parent assignment". A rule that hid a row only when its parentId
 * pointed at a collapsed SubComponent would have made the headline node count
 * depend on that heuristic being RIGHT — and would have left every row the
 * heuristic could not place (12 of 88 under Coding) visible precisely because
 * it was unplaceable. Keying on the row's own level instead means the count is
 * the same whether the placement is good, bad or missing; `parentId` decides
 * only WHERE a row reappears when you expand, which is the right blast radius
 * for a mechanical prior.
 *
 * Unreachable therefore means hidden, not visible — the same call the
 * SubComponent branch already made for a SubComponent with no resolvable
 * parent: it cannot be reached by opening anything, so showing it puts an
 * unexplained fragment on a canvas the operator just asked to condense.
 */
/**
 * Raw stream rows, in BOTH vocabularies. The batch/UKB side writes
 * `Observation`/`Digest`; the online side writes `OnlineObservation`/
 * `OnlineDigest` for the same kinds of row. A shield that names only one
 * spelling shields only half the corpus.
 */
const RAW_STREAM_CLASSES: ReadonlySet<string> = new Set([
  'Observation',
  'Digest',
  'OnlineObservation',
  'OnlineDigest',
])

const COLLAPSIBLE_LEVEL: ReadonlySet<string> = new Set([
  'SubComponent',
  'Detail',
  'Insight',
  'OnlineInsight',
])

export function isEntityVisible(e: Entity, filters: VisibilityFilters): boolean {
  // Hide raw-stub placeholders (LLM-failure transcript rows).
  if (typeof e.name === 'string' && e.name.startsWith('[Raw]')) return false

  // Legend click-to-toggle — an ontologyClass switched off in the LegendPanel.
  if (filters.hiddenNodeTypes && filters.hiddenNodeTypes.has(e.ontologyClass)) return false

  // Phase 60 Plan 03 (G3 — D-09..D-11): Hide raw stream rows
  // (Observation / Digest) UNLESS the operator has flipped the
  // showDebugEntityTypes shield. The classifier may have re-labeled the
  // entity as ontologyClass=Detail, so we check the canonical `entityType`
  // field here.
  //
  // Defensive `!== true` comparison (per checker W-2): even though the
  // field is typed as required, a runtime `undefined` (partial mock in a
  // test, transient store-init race) must still cause the exclusion to
  // fire — the safer default for a security-shaped shield.
  if (filters.showDebugEntityTypes !== true) {
    // Check BOTH fields. The classifier may relabel a raw row's ontologyClass
    // to 'Detail' while entityType stays 'Observation' — that is why this used
    // to read entityType only. Roll-up parents are the mirror image: a Digest
    // roll-up parent carries ontologyClass 'Digest' but entityType is the
    // subsystem bucket ('LiveLoggingSystem'), so an entityType-only shield let
    // 8 of them onto a canvas where every actual Digest is hidden — visible
    // summaries of invisible rows, and orphans besides, since digests carry no
    // structural edges for the parent to inherit. Either field naming a raw
    // stream type is enough to shield it.
    const raw = e as unknown as { entityType?: string; ontologyClass?: string }
    for (const field of [raw.entityType, raw.ontologyClass]) {
      // RAW_STREAM_CLASSES, not two string literals. The shield matched
      // 'Observation' and 'Digest' exactly, and the online population spells
      // the same two things `OnlineObservation` and `OnlineDigest` — so 12 raw
      // rows walked straight through a shield whose entire purpose is to keep
      // raw rows off the canvas, and rendered under no project at all. That is
      // the audit's own "two vocabularies below the upper that still disagree"
      // showing up as a rendering bug rather than as a classification one.
      if (RAW_STREAM_CLASSES.has(field ?? '')) return false
    }
  }

  // Which tree is on screen. `Intent` is the intent spine's own class and
  // belongs to that derivation only; in the code tree it is not a member at
  // all — `HIERARCHY_LEVEL` (hierarchy-parents.ts) has no entry for it, so
  // `deriveParents` never gives one a parent and nothing in the code tree can
  // hold it. Rendering it there put an unplaceable node on the canvas that
  // every re-home and every anchor count then had to explain away.
  //
  // NOT folded into COLLAPSIBLE_LEVEL below, which would have been the smaller
  // diff: that set is the collapse FRONTIER, so an Intent would then vanish at
  // Overview in intent mode too — hiding the tree the operator just asked for.
  // The spine is a switch, so it is tested as one.
  if (filters.hierarchySpine !== 'intent' && e.ontologyClass === 'Intent') return false

  const meta = (e.metadata as {
    team?: string
    source?: string
    layer?: string
    doc?: boolean
    archivedAt?: string | null
    rolledUpInto?: string | null
    rollUpOf?: unknown
  } | undefined) ?? {}

  // Aggregates-only — structural backbone exempt so the parents hang off the
  // architecture instead of floating. Everything else must BE a roll-up
  // parent: a non-empty `metadata.rollUpOf`.
  if (filters.aggregatesOnly === true) {
    const ocls = e.ontologyClass
    const isStructural = ocls === 'System' || ocls === 'Project' || ocls === 'Component'
    if (!isStructural) {
      const rollUpOf = (meta as { rollUpOf?: unknown }).rollUpOf
      if (!Array.isArray(rollUpOf) || rollUpOf.length === 0) return false
    }
  }

  // SubComponent collapse — hidden unless its Component is expanded. A
  // SubComponent with no resolvable parent stays hidden too: it cannot be
  // reached by opening anything, so showing it would put an unexplained
  // fragment on a canvas the operator just asked to condense. (There are 6
  // such nodes today — extraction artifacts never attached to a Component;
  // they show up in the orphan count, which is where they should be fixed.)
  // The collapse is TRANSITIVE: hiding a SubComponent hides what hangs under
  // it. It was not until 2026-09-21, and the result was the canvas's largest
  // single population — 152 Details whose parents were collapsed stayed on
  // screen with nothing to attach to, rendering as free-floating dots. A
  // collapse that leaves the children behind is not a collapse; it is a
  // deletion of the one edge that explained them.
  //
  // The walk goes up the same `hierarchyParents` map the canvas lays out by,
  // so "is an ancestor collapsed" can only disagree with "is that ancestor
  // drawn" if the map itself is wrong. It stops at the first SubComponent: a
  // node is hidden when ANY ancestor is a collapsed SubComponent, not only
  // when its immediate parent is.
  //
  // `seen` is belt-and-braces. deriveParents already breaks cycles, but this
  // runs per entity per render and a cycle here would freeze the tab rather
  // than misdraw it.
  if (filters.collapseSubComponents === true && COLLAPSIBLE_LEVEL.has(e.ontologyClass)) {
    const parents = filters.hierarchyParents
    const classOf = (id: string): string | undefined =>
      id === e.id ? e.ontologyClass : filters.hierarchyClassOf?.(id)

    // Walk to the nearest ancestor the operator can actually open. Reaching a
    // SubComponent means "visible while its Component is expanded"; reaching a
    // Component directly means "visible while that Component is expanded".
    //
    // Exhausting the walk without finding either means NOTHING the operator
    // could open would bring this row back — so it stays visible. Hiding it
    // would be the failure mode this whole audit is about: a row that is
    // invisible because nothing placed it, and therefore never looked at
    // again. An unplaced row stays on the canvas and counts against the node
    // budget, which puts the pressure where it belongs — on placing it.
    let reachable = true
    const seen = new Set<string>()
    for (let cur: string | undefined = e.id; cur !== undefined && !seen.has(cur); cur = parents?.get(cur)) {
      seen.add(cur)
      const cls = classOf(cur)
      if (cls === 'SubComponent') {
        const owner = parents?.get(cur)
        reachable = owner !== undefined && filters.expandedComponentIds?.has(owner) === true
        break
      }
      if (cur !== e.id && cls === 'Project') {
        // Reached the top without passing anything collapsible.
        break
      }
      if (cls === 'Component') {
        reachable = filters.expandedComponentIds?.has(cur) === true
        break
      }
    }
    if (!reachable) return false
  }

  // Teams predicate — structural backbone (System/Project/Component) exempt.
  if (filters.selectedTeams.size > 0) {
    if (filters.selectedTeams.has('__none__')) return false
    const ocls = e.ontologyClass
    const isStructural = ocls === 'System' || ocls === 'Project' || ocls === 'Component'
    if (!isStructural) {
      const team = meta.team ?? 'coding'
      if (!filters.selectedTeams.has(team)) return false
    }
  }

  // Learning Source predicate — structural backbone exempt.
  if (filters.learningSource && filters.learningSource !== 'combined') {
    const ocls = e.ontologyClass
    const isStructural = ocls === 'System' || ocls === 'Project' || ocls === 'Component'
    if (!isStructural) {
      // Shared classifier — see graph/learning-source.ts. A bare
      // `source ∈ {auto,online}` test mis-files the ~138 entities that carry no
      // source at all, and the Batch/Online radio is exactly the control a user
      // reaches for when they want to see one population and not the other.
      const src = learningSourceOf(e as { metadata?: Record<string, unknown> })
      if (filters.learningSource === 'online' && src !== 'online') return false
      if (filters.learningSource === 'batch' && src === 'online') return false
    }
  }

  // Layer predicate — empty array = "all visible", `__none__` = "none visible".
  if (filters.selectedLayers.includes('__none__')) return false
  if (filters.selectedLayers.length > 0) {
    // Phase 60 Plan 01 (G1): single source of truth — `deriveLayer` resolves
    // the layer literal via the D-03 → D-02 precedence chain (explicit
    // metadata wins, else ontology extends-walk, else evidence). The
    // pre-Phase-60 inline rule lived here; see `layer.ts` for the helper.
    const inferred = deriveLayer(
      e as unknown as { ontologyClass?: string; metadata?: { layer?: string }; layer?: string },
      filters.ontologyRegistry,
    )
    if (!filters.selectedLayers.includes(inferred)) return false
  }

  // Archived rows — TWO populations, two rules. A roll-up child carries
  // archivedAt AND rolledUpInto; the parent carries neither, so hiding the
  // children leaves exactly the condensed corpus on the canvas.
  if (typeof meta.archivedAt === 'string' && meta.archivedAt) {
    const rolledUp = typeof meta.rolledUpInto === 'string' && meta.rolledUpInto.length > 0
    if (rolledUp) {
      if (filters.hideRolledUp === true) return false
    } else {
      // Stale: archived because the code it describes is gone. No parent
      // represents it, so this is a removal rather than a fold — which is why
      // it gets its own switch instead of riding along with the roll-up one.
      if (filters.showStale !== true) return false
    }
  }

  // Doc-nodes hide toggle.
  if (filters.hideDocNodes) {
    const isDoc = (meta as { doc?: boolean }).doc === true
      || e.ontologyClass === 'Documentation'
    if (isDoc) return false
  }

  // Class predicate (empty Set = nothing visible).
  const cls = e.ontologyClass as string | undefined
  if (typeof cls !== 'string' || !filters.selectedClasses.has(cls)) return false

  // Level predicate.
  // Backend /api/v1/entities entities carry `ontologyClass` but NOT a numeric
  // `level`, so the old `typeof lvl === 'number'` guard made the Level filter a
  // no-op for the D3 render (and useVisibleEntityIds) — the counter changed
  // (UnifiedViewer.visibleCount + graph-builder both already apply deriveLevel)
  // but the rendered graph never filtered. Derive the level from ontologyClass
  // exactly as graph-builder does so all three predicates agree.
  //
  // 2026-09-26: the vestigial `e.level ??` first operand is gone with it. It
  // could never fire, and `Entity` no longer declares the field.
  const lvl = deriveLevel(e.ontologyClass)
  if (!filters.visibleLevels.has(lvl)) return false

  // Text filter (substring over name + description, lower-cased).
  if (filters.searchQueryLowered.length > 0) {
    const name = (e.name ?? '').toLowerCase()
    const desc = ((e as unknown as { description?: string }).description ?? '').toLowerCase()
    if (!name.includes(filters.searchQueryLowered) && !desc.includes(filters.searchQueryLowered)) {
      return false
    }
  }

  // LSL session filter — structural backbone exempt so anchors stay visible.
  if (filters.lslFilterEntityIds && filters.lslFilterEntityIds.size > 0) {
    const ocls = e.ontologyClass
    const isStructural = ocls === 'System' || ocls === 'Project' || ocls === 'Component'
    if (!isStructural && !filters.lslFilterEntityIds.has(e.id)) return false
  }

  // Hierarchy subtree focus — membership only, no exemption. See the field doc.
  if (filters.hierarchySubtreeIds && !filters.hierarchySubtreeIds.has(e.id)) return false

  return true
}
