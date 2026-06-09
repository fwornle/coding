// PATTERN SOURCE: 55-08-PLAN.md Task 3 — placeholder for the lazy-loaded
// HierarchyNavigator slot pinned by FilterRail in this plan. Plan 55-11
// Task 1 OVERWRITES this file with the real coding-only tree component
// (see 55-PATTERNS.md § HierarchyNavigator).
//
// Minimal placeholder so the lazy import resolves at build time between
// 55-08 ship and 55-11 ship. Tests against the lazy slot accept either
// the Suspense fallback or this placeholder content as proof of mount.

export default function HierarchyNavigatorPlaceholder({
  system: _system,
}: {
  system: 'coding' | 'okb'
}) {
  return (
    <div
      data-testid="hierarchy-navigator-placeholder"
      className="text-xs text-muted-foreground px-3 py-2 italic"
    >
      Hierarchy — loading from 55-11…
    </div>
  )
}
