// PATTERN SOURCE: 55-PATTERNS.md § HierarchyNavigator.tsx
//   + 55-UI-SPEC.md §13.1 (Hierarchy Navigator full UX)
//   + 55-UI-SPEC.md §10 (`g h` shortcut focuses search input)
//   + 55-11-PLAN.md Task 1
//
// Surface #13 — coding-only hierarchical project tree.
//
// This file OVERWRITES the placeholder shipped by 55-08 Task 3 (FilterRail's
// `lazy(() => import('./coding/HierarchyNavigator'))` line is untouched —
// only the contents at this path change). Default export contract preserved.
//
// GATING:
//   Renders null when `system !== 'coding'`. This is a defense-in-depth gate;
//   FilterRail.tsx (55-08) ALREADY gates the lazy mount on `system === 'coding'`.
//
// TREE BUILD (rewritten — see below):
//   Filter entities by ontologyClass in {System, Project, Component, SubComponent,
//   Detail}, then take parent pointers from graph/hierarchy-parents.deriveParents.
//   Each row shows its descendant count.
//
//   The original build walked `metadata.parent`. NOTHING HAS EVER WRITTEN THAT
//   FIELD — it is absent on all 2441 entities in the live graph — so every node
//   fell through to `roots` and this "tree" rendered ~1341 siblings. The real
//   hierarchy is in the edges (`contains`, `parent-child`, `includes`), which is
//   what deriveParents reads. Do not reintroduce a metadata.parent read without
//   a writer to match it.
//
//   `System` joins the rendered classes so CollectiveKnowledge is the single
//   root the Projects hang from; otherwise the top level is 26 Projects wide.
//
//   Nodes with no parent edge (~540 Details today, none of which carry a team
//   either) collect under one synthetic UNPARENTED root rather than spilling
//   across the top level. That keeps the gap visible instead of hiding it.
//
// RENDER:
//   shadcn <Accordion type="multiple"> with role="tree" parent + role="treeitem"
//   rows + aria-level + aria-expanded.
//
// KEYBOARD (UI-SPEC §13.1, §10):
//   - Cmd/Ctrl+F while focus is inside the navigator opens the in-navigator
//     search input above the tree.
//   - `g h` (no input focus) focuses the search input — registered via
//     useKeyboardShortcuts.registerSequence (extended in this plan; closes
//     plan-checker W-6).
//
// CLICK SEMANTICS (UI-SPEC §13.1):
//   Click any row → focus the canvas on that row's subtree, and render a
//   transient filter chip above the canvas (the chip itself lives in
//   UnifiedViewer, not in this file). Clicking the focused row again clears it.
//
//   Until 2026-09-22 this wrote `hierarchySubtreeFilter` and stopped: the field
//   was written and never read — no predicate, no chip — so every row in both
//   trees was clickable and did nothing, and the tests passed because they
//   asserted the store value changed rather than that anything happened. The
//   row is resolved to entity ids HERE because the two spines reach their
//   members by different edges (`contains`/`parent-child` vs `aggregates`) and
//   the canvas predicate sees one entity at a time; see graph/subtree-members.ts
//   for what a subtree is taken to include and why the ancestors come with it.
//
// LOGGER DISCIPLINE: ZERO raw console.*

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Logger } from '@/lib/logging'
import { useViewerStore } from '@/store/viewer-store'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import type { Entity } from '@/api/ApiClient'
import type { HierarchyEdge } from '@/graph/hierarchy-parents'
import {
  deriveParents,
  HIERARCHY_CLASSES,
  HIERARCHY_LEVEL,
} from '@/graph/hierarchy-parents'
import { buildIntentSpine } from '@/graph/intent-spine'
import { resolveSubtreeMembers } from '@/graph/subtree-members'

/** Synthetic root collecting hierarchy nodes with no containment edge. */
export const UNPARENTED_ID = '__unparented__'

interface TreeNode {
  id: string
  name: string
  ontologyClass: string
  level: number
  children: TreeNode[]
  descendantCount: number
  /** Intent spine only — the Components this intent's insights live in. */
  codeEvidence?: { component: string; insights: number }[]
  /** Intent spine only — what the category excludes. */
  test?: string
}

/**
 * Which tree is on screen.
 *
 * `code` answers "where does this live" and is the only half that can be
 * checked against the filesystem. `intent` answers "why is it like this" —
 * the descent a person actually makes, coarse to fine. They are separate
 * trees joined at the Insight, so this is a switch and not a filter.
 */
type Spine = 'code' | 'intent'

function buildTree(entities: readonly Entity[], relations: readonly HierarchyEdge[]): TreeNode[] {
  const filtered = entities.filter((e) => {
    const cls = typeof e.ontologyClass === 'string' ? e.ontologyClass : ''
    return HIERARCHY_CLASSES.has(cls)
  })

  // Build a lookup by id.
  const byId = new Map<string, TreeNode>()
  for (const e of filtered) {
    const cls = e.ontologyClass as string
    byId.set(e.id, {
      id: e.id,
      name: e.name,
      ontologyClass: cls,
      level: HIERARCHY_LEVEL[cls] ?? 5,
      children: [],
      descendantCount: 0,
    })
  }

  const parents = deriveParents(filtered, relations)

  // Link children to parents. A node with no parent edge is only a real root if
  // it sits at the top of the ontology (System, or a Project when no System node
  // exists); anything deeper is orphaned data and goes to the Unparented bucket,
  // so a missing edge cannot masquerade as a top-level project.
  const roots: TreeNode[] = []
  const unparented: TreeNode[] = []
  const topLevel = byId.size > 0 ? Math.min(...[...byId.values()].map((n) => n.level)) : 0

  for (const e of filtered) {
    const node = byId.get(e.id)
    if (!node) continue
    const parentId = parents.get(e.id)
    if (parentId && byId.has(parentId)) {
      byId.get(parentId)!.children.push(node)
    } else if (node.level <= topLevel) {
      roots.push(node)
    } else {
      unparented.push(node)
    }
  }

  if (unparented.length > 0) {
    roots.push({
      id: UNPARENTED_ID,
      name: 'Unparented',
      ontologyClass: 'Unparented',
      // Sorts last among roots — this is a diagnostic bucket, not a peer of
      // CollectiveKnowledge.
      level: 99,
      children: unparented,
      descendantCount: 0,
    })
  }

  // Compute descendant counts via post-order traversal.
  function countDescendants(node: TreeNode): number {
    let total = 0
    for (const child of node.children) {
      total += 1 + countDescendants(child)
    }
    node.descendantCount = total
    return total
  }
  for (const root of roots) {
    countDescendants(root)
  }

  // Sort siblings by ontologyClass level then by name for stable rendering.
  function sortRecursive(nodes: TreeNode[]) {
    nodes.sort((a, b) => {
      if (a.level !== b.level) return a.level - b.level
      return a.name.localeCompare(b.name)
    })
    for (const n of nodes) sortRecursive(n.children)
  }
  sortRecursive(roots)

  return roots
}

interface HierarchyNavigatorProps {
  system: 'coding' | 'okb'
  /**
   * Optional entities source. When omitted, the component falls back to
   * `useViewerStore(s => s.entities)` (Phase 55-04 BC-shim). The Phase 55
   * Wave-5 mount (FilterRail) passes the entities prop explicitly so this
   * stays a pure component — but the test harness can drive the store
   * directly via `useViewerStore.setState({entities})`. Either path works.
   */
  entities?: readonly Entity[]
  /**
   * Edge set the parent pointers are derived from. Same BC-shim contract as
   * `entities`: FilterRail passes it explicitly, tests may drive the store.
   * Without it the tree has no parents at all and every node lands in the
   * Unparented bucket — which is precisely the old metadata.parent behaviour.
   */
  relations?: readonly HierarchyEdge[]
}

function TreeBranch({
  node,
  level,
  onSubtreeClick,
  matchesSearch,
  focusedId,
}: {
  node: TreeNode
  level: number
  onSubtreeClick: (n: TreeNode) => void
  matchesSearch: (n: TreeNode) => boolean
  focusedId: string | null
}) {
  // Filter by search at THIS level — only show node if it or any descendant
  // matches the search query.
  if (!matchesSearch(node)) return null

  const ariaLabel = `Filter to ${node.ontologyClass}: ${node.name} (${node.descendantCount} descendants)`
  const hasChildren = node.children.length > 0
  const focused = focusedId === node.id

  return (
    <AccordionItem
      value={node.id}
      role="treeitem"
      aria-level={level}
      aria-expanded={hasChildren ? false : undefined}
      className="border-b-0"
    >
      {/* min-w-0 on the TRIGGER, not only on the button inside it. The trigger
          is itself a flex item (`flex-1`) of the AccordionItem's header row, so
          its min-width defaults to `auto` = the intrinsic width of its content.
          With code-tree rows that is a PascalCase component name and nothing
          shows; with intent rows it is a whole sentence, and the rail's content
          box went to 755px inside a 255px aside — a sideways scroll the
          operator never asked for, which the new focus-on-click then rode into
          view. The `min-w-0` already on the inner button could not help: it
          lets the button shrink, but nothing was shrinking the trigger. */}
      <AccordionTrigger className="text-xs py-1.5 hover:no-underline min-w-0">
        <button
          type="button"
          aria-label={ariaLabel}
          data-testid={`hierarchy-row-${node.id}`}
          // aria-pressed, not just a colour: the focused row is a toggle, and
          // clicking it again clears the filter. A sighted user sees the accent;
          // everyone else needs the state said out loud.
          aria-pressed={focused}
          // `truncate` belongs on the NAME, not the button: an intent is a
          // whole sentence, and truncating the button clipped the count off
          // the end of every row — the one number that says how much of the
          // corpus the row carries. min-w-0 lets the name shrink inside flex.
          className={
            'flex-1 min-w-0 text-left hover:text-foreground '
            + (focused ? 'text-accent-foreground font-medium' : 'text-foreground')
          }
          title={node.name}
          onClick={(e) => {
            // Stop propagation so the accordion's own toggle doesn't intercept.
            e.stopPropagation()
            onSubtreeClick(node)
          }}
        >
          <span className="flex items-baseline gap-1.5">
            <span className="truncate">{node.name}</span>
            <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
              ({node.descendantCount})
            </span>
          </span>
          {node.codeEvidence && node.codeEvidence.length > 0 && (
            // The join between the trees, shown rather than described: which
            // parts of the code this goal was pursued in. Derived from the
            // insights' own placement, so it costs no extra classification.
            <span
              data-testid={`intent-evidence-${node.id}`}
              className="block text-[10px] text-muted-foreground/80 truncate font-normal"
            >
              in {node.codeEvidence.slice(0, 3).map((e) => e.component).join(', ')}
              {node.codeEvidence.length > 3 && ` +${node.codeEvidence.length - 3}`}
            </span>
          )}
        </button>
      </AccordionTrigger>
      {hasChildren && (
        <AccordionContent className="pl-3 pb-0">
          {node.children.map((child) => (
            <TreeBranch
              key={child.id}
              node={child}
              level={level + 1}
              onSubtreeClick={onSubtreeClick}
              matchesSearch={matchesSearch}
              focusedId={focusedId}
            />
          ))}
        </AccordionContent>
      )}
    </AccordionItem>
  )
}

export default function HierarchyNavigator({
  system,
  entities: entitiesProp,
  relations: relationsProp,
}: HierarchyNavigatorProps) {
  // Defense-in-depth gate (FilterRail also gates the mount).
  if (system !== 'coding') return null

  // Prefer the explicit `entities` prop; fall back to the store (test
  // harness drives the store via useViewerStore.setState).
  const storeEntities = useViewerStore((s) => (s as unknown as { entities?: readonly Entity[] }).entities)
  const entities: readonly Entity[] | undefined = entitiesProp ?? storeEntities
  const storeRelations = useViewerStore(
    (s) => (s as unknown as { relations?: readonly HierarchyEdge[] }).relations,
  )
  const relations: readonly HierarchyEdge[] = relationsProp ?? storeRelations ?? []
  const setHierarchySubtreeFilter = useViewerStore((s) => s.setHierarchySubtreeFilter)
  const clearHierarchySubtreeFilter = useViewerStore((s) => s.clearHierarchySubtreeFilter)
  const focusedId = useViewerStore((s) => s.hierarchySubtreeFilter)
  // The canvas's own parent map, written once by UnifiedViewer over the whole
  // entity set. Reusing it rather than re-deriving here is what guarantees the
  // ancestors this filter admits are the ancestors the graph draws — a second
  // derivation could rank a multi-parent node differently and the chain would
  // point at a node the canvas had placed elsewhere.
  const hierarchyParents = useViewerStore((s) => s.hierarchyParents)

  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  // Bump a counter every time we want to focus the input (vs. just open it
  // once). Re-running focus on every counter bump means `g h` pressed
  // multiple times can re-focus an already-open input.
  const [focusRequest, setFocusRequest] = useState(0)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)

  // Focus the search input after it mounts (or after a focus request bump).
  useEffect(() => {
    if (searchOpen && searchInputRef.current) {
      searchInputRef.current.focus()
    }
  }, [searchOpen, focusRequest])

  // useKeyboardShortcuts handle — register the `g h` sequence to focus
  // the search input (UI-SPEC §10). The hook owns ALL two-key sequence
  // state — we never wire ad-hoc per-component state machines (closes
  // plan-checker W-6).
  const shortcuts = useKeyboardShortcuts({
    onOpenHelpDialog: () => {},
    onCloseHelpDialog: () => false,
  })

  // Register `g h` sequence on mount; unregister on unmount.
  useEffect(() => {
    const unregister = shortcuts.registerSequence('g', 'h', () => {
      setSearchOpen(true)
      setFocusRequest((n) => n + 1)
    })
    return unregister
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Cmd/Ctrl+F handler — only when focus is inside the navigator.
  function handleContainerKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if ((event.metaKey || event.ctrlKey) && (event.key === 'f' || event.key === 'F')) {
      event.preventDefault()
      setSearchOpen(true)
      setFocusRequest((n) => n + 1)
    }
  }

  const [spine, setSpine] = useState<Spine>('code')

  // Switching trees drops the focus. The filter is a resolved id set, so it
  // would survive the switch intact — and then the chip above the canvas would
  // name a row that is no longer anywhere in the rail, with no way to find it
  // again except by switching back.
  function onSpineChange(next: Spine) {
    if (next === spine) return
    setSpine(next)
    if (useViewerStore.getState().hierarchySubtreeFilter !== null) {
      clearHierarchySubtreeFilter()
    }
    Logger.info(Logger.Categories.PANELS, `Hierarchy spine: ${next}`)
  }

  const tree = useMemo(
    () =>
      spine === 'intent'
        ? (buildIntentSpine(entities ?? [], relations) as TreeNode[])
        : buildTree(entities ?? [], relations),
    [entities, relations, spine],
  )

  // Whether the store holds an intent spine at all. An empty result means two
  // different things — "not derived yet" and "derived but empty" — and the
  // toggle must not look broken in the first case.
  const hasIntentSpine = useMemo(
    () => (entities ?? []).some((e) => (e as { ontologyClass?: unknown }).ontologyClass === 'Intent'),
    [entities],
  )

  // Search filter — case-insensitive substring match on names; recursive
  // (a node matches if any descendant matches).
  function matchesSearch(node: TreeNode): boolean {
    const q = searchQuery.trim().toLowerCase()
    if (q.length === 0) return true
    if (node.name.toLowerCase().includes(q)) return true
    return node.children.some(matchesSearch)
  }

  function onSubtreeClick(node: TreeNode) {
    // Re-clicking the focused row clears it. The chip above the canvas is the
    // primary way out; this is the second, at the place the operator's hand
    // already is.
    if (focusedId === node.id) {
      clearHierarchySubtreeFilter()
      Logger.info(Logger.Categories.PANELS, `Hierarchy filter cleared: ${node.id}`)
      return
    }
    const members = resolveSubtreeMembers(node, hierarchyParents)
    setHierarchySubtreeFilter(node.id, members, node.name)
    Logger.info(
      Logger.Categories.PANELS,
      `Hierarchy filter set: ${node.id} (${members.size} entities, ${spine} spine)`,
    )
  }

  if (tree.length === 0) {
    return (
      <div
        data-testid="hierarchy-navigator"
        ref={containerRef}
        tabIndex={0}
        onKeyDown={handleContainerKeyDown}
        className="space-y-1"
      >
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Hierarchy
        </div>
        {hasIntentSpine && (
          <div
            role="group"
            aria-label="Choose which hierarchy to show"
            data-testid="spine-toggle"
            className="flex gap-1 pb-1"
          >
            {(['code', 'intent'] as const).map((s) => (
              <button
                key={s}
                type="button"
                data-testid={`spine-${s}`}
                aria-pressed={spine === s}
                onClick={() => onSpineChange(s)}
                className={
                  'text-[10px] px-2 py-0.5 rounded border transition-colors ' +
                  (spine === s
                    ? 'bg-accent text-accent-foreground border-accent'
                    : 'text-muted-foreground border-border hover:text-foreground')
                }
              >
                {s === 'code' ? 'Code' : 'Intent'}
              </button>
            ))}
          </div>
        )}
        <div
          data-testid="hierarchy-empty-state"
          className="text-xs text-muted-foreground px-1 py-2"
        >
          {spine === 'intent' ? (
            <>
              <p>No intents placed yet.</p>
              <p className="text-[10px] mt-0.5 italic">
                The intent spine is derived from the insight corpus, not from a wave run.
              </p>
            </>
          ) : (
            <>
              <p>No hierarchy data yet.</p>
              <p className="text-[10px] mt-0.5 italic">Run wave-analysis to populate.</p>
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <div
      data-testid="hierarchy-navigator"
      ref={containerRef}
      tabIndex={0}
      onKeyDown={handleContainerKeyDown}
      className="space-y-1"
    >
      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        Hierarchy
      </div>
      {hasIntentSpine && (
        <div
          role="group"
          aria-label="Choose which hierarchy to show"
          data-testid="spine-toggle"
          className="flex gap-1 pb-1"
        >
          {(['code', 'intent'] as const).map((s) => (
            <button
              key={s}
              type="button"
              data-testid={`spine-${s}`}
              aria-pressed={spine === s}
              onClick={() => onSpineChange(s)}
              className={
                'text-[10px] px-2 py-0.5 rounded border transition-colors ' +
                (spine === s
                  ? 'bg-accent text-accent-foreground border-accent'
                  : 'text-muted-foreground border-border hover:text-foreground')
              }
            >
              {s === 'code' ? 'Code' : 'Intent'}
            </button>
          ))}
        </div>
      )}
      {searchOpen && (
        <input
          ref={searchInputRef}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          data-testid="hierarchy-search-input"
          aria-label="Search hierarchy"
          placeholder="Search hierarchy…"
          className="w-full h-7 text-xs rounded-md border border-input bg-transparent px-2 outline-none focus-visible:border-ring focus-visible:ring-[2px] focus-visible:ring-ring/50"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setSearchOpen(false)
              setSearchQuery('')
            }
          }}
        />
      )}
      <Accordion type="multiple" role="tree" className="space-y-0">
        {tree.map((root) => (
          <TreeBranch
            key={root.id}
            node={root}
            level={1}
            onSubtreeClick={onSubtreeClick}
            matchesSearch={matchesSearch}
            focusedId={focusedId}
          />
        ))}
      </Accordion>
    </div>
  )
}
