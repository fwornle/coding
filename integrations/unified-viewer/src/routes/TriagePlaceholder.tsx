// PATTERN SOURCE: 55-07-PLAN.md Task 2 <interfaces>
//
// Importable stub for the `mode === 'triage'` branch of UnifiedViewer.
// Exists so the lazy-import in UnifiedViewer.tsx resolves at build time
// during Wave 3 (before Plan 55-10 ships IssueTriageView in Wave 4).
//
// Plan 55-10 Task 2 will swap the lazy import path from `./TriagePlaceholder`
// to `@/routes/IssueTriageView` and the JSX from `<TriagePlaceholder />` to
// `<IssueTriageView />`. This is a single-line edit because the import is
// already lazy() — see 55-10 PLAN frontmatter `key_links`.
//
// Default-export contract MUST stay stable so the lazy() swap is mechanical.

export default function TriagePlaceholder() {
  return (
    <div
      data-testid="triage-mode-placeholder"
      className="flex items-center justify-center h-full text-sm text-muted-foreground italic"
    >
      Triage view loading…
    </div>
  )
}
