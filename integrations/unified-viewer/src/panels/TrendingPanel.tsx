// PATTERN SOURCE: 55-08-PLAN.md Task 3 — placeholder for the lazy-loaded
// TrendingPanel slot pinned by FilterRail in this plan. Plan 55-10 Task 1
// OVERWRITES this file with the real port of VOKB's
// `_work/.../viewer/src/components/KnowledgeGraph/TrendingPanel.tsx`.
//
// The placeholder is deliberately minimal (single <div>, no logic, no fetch)
// so the lazy import resolves at build time between 55-08 ship and 55-10
// ship. Tests against the lazy slot accept either the Suspense fallback or
// this placeholder content as proof the slot is mounted.

import type { ApiClient } from '@/api/ApiClient'

export interface TrendingPanelProps {
  apiClient: ApiClient
}

export default function TrendingPanelPlaceholder(_props: TrendingPanelProps) {
  return (
    <div
      data-testid="trending-panel-placeholder"
      className="text-xs text-muted-foreground px-3 py-2 italic"
    >
      Trending Patterns — loading from 55-10…
    </div>
  )
}
