// PATTERN SOURCE: 45-UI-SPEC.md § State Contract + § Copywriting Contract
// CONTRACT: every copy string here is verbatim from UI-SPEC. Drifting any
// string is a contract break — the verification grep gate in PLAN.md
// catches the "Click any node to see its details." string explicitly.
//
// Destructive banner classes copied verbatim from
//   integrations/system-health-dashboard/src/pages/digests.tsx:304-308
// per UI-SPEC § State Contract row "Error (unreachable)".

import { AlertTriangle, Loader2, MousePointer, Network } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { System } from '@/config/system-endpoints'

// Reused shells —————————————————————————————————————————————

function CenteredBlock({
  children,
  testId,
}: {
  children: React.ReactNode
  testId: string
}) {
  return (
    <div
      data-testid={testId}
      className="flex h-full w-full flex-col items-center justify-center gap-3 p-6 text-center"
    >
      {children}
    </div>
  )
}

// State Components ——————————————————————————————————————————

export interface SystemStateProps {
  system: System
}

/**
 * Initial-load spinner shown until the first /api/v1/entities response lands.
 * Copy: `Loading {system} graph...` (UI-SPEC § State Contract row 1).
 */
export function InitialLoadingState({ system }: SystemStateProps) {
  return (
    <CenteredBlock testId="state-initial-loading">
      <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" aria-hidden />
      <p className="text-sm text-muted-foreground">
        Loading {system} graph...
      </p>
    </CenteredBlock>
  )
}

/**
 * Empty-no-data state — `/api/v1/entities` returned []. Per UI-SPEC: a
 * Network icon at 64px in muted-foreground/40 plus the copy with `{system}`
 * interpolated. The first `{system}` appears in "this {system} knowledge
 * graph" and the second in "via {system}'s pipeline".
 */
export function EmptyNoDataState({ system }: SystemStateProps) {
  return (
    <CenteredBlock testId="state-empty-no-data">
      <Network className="h-16 w-16 text-muted-foreground/40" aria-hidden />
      <h3 className="text-base font-semibold text-foreground">No entities yet</h3>
      <p className="text-sm text-muted-foreground max-w-md">
        This {system} knowledge graph is empty. Ingest data via {system}'s pipeline to see
        nodes appear here.
      </p>
    </CenteredBlock>
  )
}

export interface EmptyFilterStateProps {
  onClear: () => void
}

/**
 * Empty-filter state — level/class filter reduced visible to 0. Copy verbatim
 * + a `Clear filters` button (UI-SPEC § Copywriting row "Empty (no filter match)").
 */
export function EmptyFilterState({ onClear }: EmptyFilterStateProps) {
  return (
    <CenteredBlock testId="state-empty-filter">
      <h3 className="text-base font-semibold text-foreground">No matches</h3>
      <p className="text-sm text-muted-foreground">No entities match the current filter.</p>
      <Button variant="ghost" size="sm" onClick={onClear}>
        Clear filters
      </Button>
    </CenteredBlock>
  )
}

export interface EmptySearchStateProps {
  query: string
}

/**
 * Empty-search state — search query matched 0 entities. Heading interpolates
 * the query verbatim with surrounding double-quotes per UI-SPEC.
 */
export function EmptySearchState({ query }: EmptySearchStateProps) {
  return (
    <CenteredBlock testId="state-empty-search">
      <h3 className="text-base font-semibold text-foreground">
        {`No matches for "${query}"`}
      </h3>
      <p className="text-sm text-muted-foreground">
        Try a different search term or clear it to see all entities.
      </p>
    </CenteredBlock>
  )
}

/**
 * Empty-node-detail state — right panel default tab, no node selected.
 * MousePointer 32px icon above the copy per UI-SPEC § Panel Contracts.
 */
export function EmptyNodeDetailState() {
  return (
    <CenteredBlock testId="state-empty-node-detail">
      <MousePointer className="h-8 w-8 text-muted-foreground/60" aria-hidden />
      <p className="text-sm text-muted-foreground">Click any node to see its details.</p>
    </CenteredBlock>
  )
}

// Error states ——————————————————————————————————————————————

export interface ErrorStateProps {
  system: System
  baseUrl: string
  onRetry?: () => void
}

/**
 * Error-unreachable banner. Copy + class names verbatim from UI-SPEC § State
 * Contract row "Error (unreachable)" — full-width destructive banner styled
 * from the dashboard's digests.tsx:304-308.
 */
export function ErrorUnreachableState({ system, baseUrl, onRetry }: ErrorStateProps) {
  return (
    <div
      data-testid="state-error-unreachable"
      className="flex items-start gap-3 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
    >
      <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden />
      <div className="flex-1 space-y-2">
        <p>
          Cannot reach {system} API at {baseUrl}. Check that the service is running and
          accessible.
        </p>
        {onRetry && (
          <Button size="sm" variant="outline" onClick={onRetry}>
            Retry
          </Button>
        )}
      </div>
    </div>
  )
}

/**
 * Error-CORS banner — same destructive shell as Unreachable, different copy.
 */
export function ErrorCorsState({ system, baseUrl, onRetry }: ErrorStateProps) {
  return (
    <div
      data-testid="state-error-cors"
      className="flex items-start gap-3 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
    >
      <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden />
      <div className="flex-1 space-y-2">
        <p>
          Browser blocked the request to {baseUrl} (CORS). The {system} service must allow
          this origin or be reached through a proxy.
        </p>
        {onRetry && (
          <Button size="sm" variant="outline" onClick={onRetry}>
            Retry
          </Button>
        )}
      </div>
    </div>
  )
}

/**
 * Error-ontology-fetch inline notice — graph still renders, but ontology
 * metadata unavailable. Amber palette per UI-SPEC § State Contract row
 * "Error (ontology fetch fail)".
 */
export function ErrorOntologyFetchState() {
  return (
    <div
      data-testid="state-error-ontology-fetch"
      className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400"
    >
      Ontology metadata unavailable — node colors will use hash-based fallback.
    </div>
  )
}
