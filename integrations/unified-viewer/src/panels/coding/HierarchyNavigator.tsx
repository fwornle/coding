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
// TREE BUILD:
//   Filter entities by ontologyClass in {Project, Component, SubComponent, Detail}.
//   Index by id, then walk metadata.parent pointers to assemble children arrays.
//   Each L1 (Project) row shows its descendant count.
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
// CLICK SEMANTICS:
//   Click L1 row → setHierarchySubtreeFilter(l1.id) (UI-SPEC §13.1 transient
//   filter chip rendered above canvas; the chip rendering itself lives in
//   UnifiedViewer, not in this file).
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

const HIERARCHY_CLASSES = new Set([
  'Project',
  'Component',
  'SubComponent',
  'Detail',
])

const HIERARCHY_LEVEL: Record<string, number> = {
  Project: 1,
  Component: 2,
  SubComponent: 3,
  Detail: 4,
}

interface TreeNode {
  id: string
  name: string
  ontologyClass: string
  level: number
  children: TreeNode[]
  descendantCount: number
}

function getParentId(entity: Entity): string | null {
  const meta = (entity as unknown as { metadata?: Record<string, unknown> }).metadata
  if (!meta) return null
  const parent = meta.parent
  if (typeof parent === 'string' && parent.length > 0) return parent
  return null
}

function buildTree(entities: readonly Entity[]): TreeNode[] {
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

  // Link children to parents.
  const roots: TreeNode[] = []
  for (const e of filtered) {
    const node = byId.get(e.id)
    if (!node) continue
    const parentId = getParentId(e)
    if (parentId && byId.has(parentId)) {
      byId.get(parentId)!.children.push(node)
    } else {
      roots.push(node)
    }
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
}

function TreeBranch({
  node,
  level,
  onSubtreeClick,
  matchesSearch,
}: {
  node: TreeNode
  level: number
  onSubtreeClick: (id: string) => void
  matchesSearch: (n: TreeNode) => boolean
}) {
  // Filter by search at THIS level — only show node if it or any descendant
  // matches the search query.
  if (!matchesSearch(node)) return null

  const ariaLabel = `Filter to ${node.ontologyClass}: ${node.name} (${node.descendantCount} descendants)`
  const hasChildren = node.children.length > 0

  return (
    <AccordionItem
      value={node.id}
      role="treeitem"
      aria-level={level}
      aria-expanded={hasChildren ? false : undefined}
      className="border-b-0"
    >
      <AccordionTrigger className="text-xs py-1.5 hover:no-underline">
        <button
          type="button"
          aria-label={ariaLabel}
          data-testid={`hierarchy-row-${node.id}`}
          className="flex-1 text-left truncate hover:text-foreground text-foreground"
          onClick={(e) => {
            // Stop propagation so the accordion's own toggle doesn't intercept.
            e.stopPropagation()
            onSubtreeClick(node.id)
          }}
        >
          <span className="text-foreground">{node.name}</span>
          <span className="text-[10px] text-muted-foreground ml-1.5 tabular-nums">
            ({node.descendantCount})
          </span>
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
}: HierarchyNavigatorProps) {
  // Defense-in-depth gate (FilterRail also gates the mount).
  if (system !== 'coding') return null

  // Prefer the explicit `entities` prop; fall back to the store (test
  // harness drives the store via useViewerStore.setState).
  const storeEntities = useViewerStore((s) => (s as unknown as { entities?: readonly Entity[] }).entities)
  const entities: readonly Entity[] | undefined = entitiesProp ?? storeEntities
  const setHierarchySubtreeFilter = useViewerStore((s) => s.setHierarchySubtreeFilter)

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

  const tree = useMemo(() => buildTree(entities ?? []), [entities])

  // Search filter — case-insensitive substring match on names; recursive
  // (a node matches if any descendant matches).
  function matchesSearch(node: TreeNode): boolean {
    const q = searchQuery.trim().toLowerCase()
    if (q.length === 0) return true
    if (node.name.toLowerCase().includes(q)) return true
    return node.children.some(matchesSearch)
  }

  function onSubtreeClick(id: string) {
    setHierarchySubtreeFilter(id)
    Logger.info(Logger.Categories.PANELS, `Hierarchy filter set: ${id}`)
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
        <div
          data-testid="hierarchy-empty-state"
          className="text-xs text-muted-foreground px-1 py-2"
        >
          <p>No hierarchy data yet.</p>
          <p className="text-[10px] mt-0.5 italic">Run wave-analysis to populate.</p>
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
          />
        ))}
      </Accordion>
    </div>
  )
}
