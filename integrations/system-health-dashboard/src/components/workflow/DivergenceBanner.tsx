'use client'

import React from 'react'

/**
 * Shape of a single divergence entry from the comparison utility.
 */
export interface DivergenceEntry {
  field: string
  legacy: unknown
  current: unknown
}

interface DivergenceBannerProps {
  divergences: DivergenceEntry[]
}

/**
 * DivergenceBanner: Warning banner displayed when migration state divergences
 * are detected between the legacy and new progress files.
 *
 * Renders a yellow warning bar at the top of the workflow view.
 * Returns null when there are no divergences (clean state).
 */
export function DivergenceBanner({ divergences }: DivergenceBannerProps): React.ReactElement | null {
  if (divergences.length === 0) {
    return null
  }

  return (
    <div
      style={{
        background: '#fff3cd',
        border: '1px solid #ffc107',
        borderRadius: '4px',
        padding: '8px 12px',
        marginBottom: '8px',
        fontSize: '13px',
        color: '#856404',
      }}
    >
      <strong>Migration Warning:</strong> {divergences.length} state divergence(s) detected.
      Check <code>.data/comparison-log.json</code> for details.
    </div>
  )
}
