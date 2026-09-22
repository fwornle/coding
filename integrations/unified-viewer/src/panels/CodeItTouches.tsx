// "Code it touches" — the bottom of the drill, and the way back up it.
//
// WHAT THIS RENDERS, AND WHY IT IS NOT A CLASSIFICATION
//
// 739 of the graph's 997 Insights carry
// `metadata.codeVerification.referencedFiles` — the PATH-typed claims the
// verifier resolved against the repo on a stated date, with the ones it could
// NOT resolve kept separately in `staleClaims`. Nothing in the viewer read the
// field until now. Aggregated over an Intent's lessons and ranked by how many of
// them name each file, it answers the question the intent rail could previously
// only gesture at: which code was this goal pursued in.
//
// WHY THE FILES ARE NOT LINKS
//
// The verifier's own `searchRoots` span several repositories, and 28% of the
// path-shaped claims do not resolve inside THIS one — `proxy-bridge/server.mjs`
// and `config/llm-routing.yaml`, for instance, live in `_work/rapid-llm-proxy`.
// A link that 404s is worse than text, so the path is text and the click does
// something the viewer can actually honour.
//
// WHAT THE CLICK DOES INSTEAD — THE REVERSE JOIN
//
// It focuses the canvas on the lessons this row counted, plus the code they sit
// under. It reuses the hierarchy focus triple rather than adding a second one —
// see `fileFocusId` for why a synthetic root is safe, and note that reuse also
// makes the two focuses mutually exclusive, which is correct: the canvas is
// focused on one thing at a time.
//
// WHY THE CANVAS MAY SHOW FEWER NODES THAN THE COUNT
//
// The count beside a path is a fact about the CORPUS: that many lessons name
// that file. The focus is a filter, and filters intersect — "Hide archived
// (rolled-up)" and "Collapse sub-components" are both on by default, so a file
// named by 32 lessons can legitimately leave 2 on screen. That is the same
// composition every hierarchy row click already has, not something this list
// does differently, which is why the label states the count as a property of
// the data rather than promising a node count. Looks like a bug at the next
// read; is not one.

import { useMemo } from 'react'
import { Logger } from '@/lib/logging'
import { useViewerStore } from '@/store/viewer-store'
import { resolveSubtreeMembers } from '@/graph/subtree-members'
import {
  fileFocusId,
  filesTouched,
  verifiedAt,
  type ReachInsight,
} from '@/graph/intent-code-reach'

export interface CodeItTouchesProps {
  /** The lessons whose file evidence to aggregate. Empty renders nothing. */
  insights: readonly ReachInsight[]
  /** How many lessons are in scope, including those with no file evidence. */
  totalLessons: number
}

/** Longest list rendered before it is cut. Beyond this the tail is noise. */
const MAX_ROWS = 25

export default function CodeItTouches({ insights, totalLessons }: CodeItTouchesProps) {
  const hierarchyParents = useViewerStore((s) => s.hierarchyParents)
  const setHierarchySubtreeFilter = useViewerStore((s) => s.setHierarchySubtreeFilter)
  const clearHierarchySubtreeFilter = useViewerStore((s) => s.clearHierarchySubtreeFilter)
  const focusedId = useViewerStore((s) => s.hierarchySubtreeFilter)

  const files = useMemo(() => filesTouched(insights), [insights])
  const checked = useMemo(() => verifiedAt(insights), [insights])

  if (files.length === 0) return null

  // Lessons that actually carry file evidence — NOT the same as the number of
  // lessons in scope. Saying "172 files" without saying how much of the corpus
  // they came from would let a thin sample read as a complete map.
  const contributing = new Set<string>()
  for (const f of files) for (const id of f.lessonIds) contributing.add(id)

  function onFileClick(path: string, lessonIds: string[]) {
    const id = fileFocusId(path)
    if (focusedId === id) {
      clearHierarchySubtreeFilter()
      Logger.info(Logger.Categories.FILTERS, `File focus cleared: ${path}`)
      return
    }
    // The same ancestor walk a hierarchy row uses, so a file focus anchors to
    // the spine the way every other focus does instead of landing as an island.
    const members = resolveSubtreeMembers(
      { id, children: lessonIds.map((lid) => ({ id: lid, children: [] })) },
      hierarchyParents,
    )
    // The synthetic root is not an entity; it would sit in the set matching
    // nothing. Harmless, but a filter set whose members are all real ids is one
    // less thing to explain at the next read.
    members.delete(id)
    setHierarchySubtreeFilter(id, members, path)
    Logger.info(
      Logger.Categories.FILTERS,
      `File focus: ${path} (${lessonIds.length} lessons, ${members.size} entities)`,
    )
  }

  const shown = files.slice(0, MAX_ROWS)

  return (
    <div data-testid="code-it-touches" className="rounded-md border border-border p-2 space-y-1">
      <div className="flex items-center gap-2 text-xs font-medium">
        <span aria-hidden>📄</span>
        <span>Code it touches</span>
      </div>
      <p data-testid="code-it-touches-provenance" className="text-[10px] text-muted-foreground pl-4">
        {files.length} file{files.length === 1 ? '' : 's'} · from {contributing.size} of{' '}
        {totalLessons} lesson{totalLessons === 1 ? '' : 's'}
        {checked ? ` · verified ${checked}` : ''}
      </p>
      <ul className="space-y-0.5 pl-4">
        {shown.map((f) => {
          const id = fileFocusId(f.path)
          const active = focusedId === id
          return (
            <li key={f.path} className="flex items-baseline gap-2">
              <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums w-6 text-right">
                {f.count}
              </span>
              <button
                type="button"
                data-testid={`code-file-${f.path}`}
                aria-pressed={active}
                // States the corpus fact, not a promise about how many nodes
                // survive — other canvas filters still apply. See the header.
                aria-label={`Focus on ${f.path} — named by ${f.count} lesson${f.count === 1 ? '' : 's'}`}
                title={f.path}
                onClick={() => onFileClick(f.path, f.lessonIds)}
                className={
                  'min-w-0 flex-1 text-left font-mono text-xs truncate hover:underline '
                  + (active ? 'text-accent-foreground font-medium' : 'text-foreground')
                }
              >
                {f.path}
              </button>
            </li>
          )
        })}
      </ul>
      {files.length > shown.length && (
        <p className="text-[10px] text-muted-foreground italic pl-4">
          +{files.length - shown.length} more, each named by {shown[shown.length - 1].count} lesson
          {shown[shown.length - 1].count === 1 ? '' : 's'} or fewer
        </p>
      )}
    </div>
  )
}
