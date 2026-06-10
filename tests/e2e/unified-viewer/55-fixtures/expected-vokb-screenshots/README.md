# Golden VOKB Reference Screenshots — Plan 55-13

This directory holds the **expected** screenshots of the legacy VOKB at
`localhost:3002` (and counterpart unified-viewer screenshots at
`localhost:5173/viewer/{coding,okb}`) used by
`tests/e2e/unified-viewer/55-side-by-side-screenshots.spec.ts` for the
Phase 55 parity gate (UI-SPEC §17 + Phase 45 retrospective requirement).

## What lives here

Captured by Playwright's snapshot subsystem on first run:

| File                                                | Captured by                                                                                             |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `unified-viewer-coding.png` (placeholder for spec)  | `expect(page).toHaveScreenshot('unified-viewer-coding.png')` against `http://localhost:5173/viewer/coding` |
| `vokb-3002.png` (placeholder for spec)              | `expect(page).toHaveScreenshot('vokb-3002.png')` against `http://localhost:3002`                        |

Note: Playwright's `toHaveScreenshot` actually writes into a sibling directory
named `55-side-by-side-screenshots.spec.ts-snapshots/`. The fixture directory
here is the **canonical home for any hand-captured pairs** (e.g. per-surface
crops the operator may take during the Plan 55-13 review).

## How to (re-)capture the golden references

Prerequisites:

- Unified viewer running on `localhost:5173`:
  ```bash
  cd integrations/unified-viewer && npm run dev
  ```
- Legacy VOKB running on `localhost:3002`:
  ```bash
  cd _work/rapid-automations/integrations/operational-knowledge-management/viewer && npm run dev
  ```
- Coding services running so the unified-viewer can populate data
  (`coding --claude` or `bin/coding --claude`).

Then from the repo root:

```bash
# First-time generation OR drift refresh: --update-snapshots writes new
# golden references in the sibling -snapshots/ directory. Review the diff
# before committing.
npx playwright test tests/e2e/unified-viewer/55-side-by-side-screenshots.spec.ts \
    --update-snapshots
```

For manual side-by-side captures the operator may use during the Plan 55-13
parity review:

```bash
# Unified viewer
gsd-browser navigate http://localhost:5173/viewer/coding
gsd-browser screenshot tests/e2e/unified-viewer/55-fixtures/expected-vokb-screenshots/unified-viewer-coding.png

# Legacy VOKB
gsd-browser navigate http://localhost:3002
gsd-browser screenshot tests/e2e/unified-viewer/55-fixtures/expected-vokb-screenshots/vokb-3002.png
```

## When VOKB is unreachable

The spec auto-skips the VOKB-side capture with an explicit annotation
(`vokb-unreachable`). The Plan 55-13 operator gate verifies that VOKB was
running during the review run — the annotation is the audit trail.

## Forbidden-string contract (D-55-01c)

Any fixture, comment, or commit message that references `cc.bmwgroup.net`
is a violation. The unified-viewer specs all assert
`expect(body).not.toContain('cc.bmwgroup.net')`; this README must remain
clean of that string as well. The bmw corporate Git host for projects in
`_work/rapid-automations/` is `bmw.ghe.com` (HTTPS-token-auth via gh CLI;
SSH publickey fails for current keys per memory `feedback_bmw_ghe_https`).

## Plan 55-13 references

- `.planning/phases/55-unified-viewer-feature-parity-with-vokb/55-13-PLAN.md`
- `.planning/phases/55-unified-viewer-feature-parity-with-vokb/55-CONTEXT.md`
  (Process Amendments — side-by-side screenshot comparison MANDATORY)
- `.planning/phases/45-unified-web-viewer/45-VERIFICATION.md`
  (the 15%-shortfall finding that this harness prevents from recurring)
