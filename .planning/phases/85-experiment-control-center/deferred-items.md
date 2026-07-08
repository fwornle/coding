# Phase 85 — Deferred Items (out-of-scope discoveries)

Logged per the executor scope-boundary rule: pre-existing issues in files NOT
touched by Phase 85 work. Do not fix in this phase.

## Pre-existing dashboard tsc errors (non-blocking — build script is `tsc --noEmit 2>/dev/null; vite build`)

Found during the 85-06 dashboard rebuild (2026-07-08). The vite bundle builds
fine; these fail only the advisory `tsc --noEmit` pass:

- `src/pages/token-usage.tsx:589` — TS2322 recharts `Formatter<number, NameType>` mismatch
- `src/pages/token-usage.tsx:675` — TS2322 recharts `Formatter<number, string>` mismatch (`val: number | undefined`)
- `src/components/workflow/node-details-sidebar.tsx:1393` — TS2322 `unknown` not assignable to `ReactNode`
- `src/components/workflow/node-details-sidebar.tsx:1412` — TS2322 `unknown` not assignable to `ReactNode`

## Browserslist data stale

`npm run build` warns `caniuse-lite is 7 months old` — run
`npx update-browserslist-db@latest` in `integrations/system-health-dashboard`
during a maintenance window.
