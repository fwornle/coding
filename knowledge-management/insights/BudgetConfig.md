# BudgetConfig

**Type:** Detail

## What It Is

`BudgetConfig` is a data interface defined in `integrations/system-health-dashboard/src/components/cost/cost-model.ts`, part of the `DashboardCostModel` component. It models a single provider's spending cap policy: `monthlyEur: number | null` (standing cap), `monthlyEurByMonth?: Record<string, number | null>` (per-month overrides), `enforce: boolean`, and `budgetBasis: string`. It is a pure data shape — no methods attached — with all resolution behavior delegated to the standalone function `budgetForMonth(b, month)`.

## Architecture and Design

The core pattern is precedence-based resolution: `budgetForMonth()` checks `Object.prototype.hasOwnProperty.call(byMonth, month)` before falling back to `b.monthlyEur`. This is a deliberate three-state design — key absent (use standing cap), key present with a number (this month's cap), key present with `null` (explicitly uncapped) — rather than a simple `??` fallback, which would silently collapse the "explicitly uncapped" and "not recorded" states into one. This explicit-null-as-sentinel technique is one of the file's named architectural patterns.

A second pattern, two-bucket classification, is enforced by `budgetProvider()` and its `BudgetProvider` type, which collapse every provider string appearing in `CostRow` down to exactly `'copilot'` or `'claude-max'`. These two literals are the only keys `budgetForMonth()`'s consumers will ever look up in `CostConfig.budgets: Record<string, BudgetConfig>`.

The design keeps `BudgetConfig` as inert data and pushes all logic into `budgetForMonth()`, consistent with the file's stated "no React, pure logic" philosophy — a maintainability-oriented separation of state from behavior.

## Implementation Details

`DEFAULT_COST_CONFIG.budgets` provides exactly two entries. `copilot` sets `enforce: true`, `monthlyEur: 300`, and overrides `'2026-08': 1000`. `claude-max` sets `monthlyEur: null, enforce: false` — reflecting that it's a flat subscription with no marginal cost, so its `BudgetConfig` exists only to keep the `Record` uniform, with the numeric-cap branch permanently inert.

The interface docstring specifies that in-month cap changes are not modelled as a timeline: only the cap in force at month end matters. The parent-context history shows the copilot cap moving 300→600→1000 through August 2026, but only the final `1000` value is retained in `monthlyEurByMonth['2026-08']` — the intermediate 600 is nowhere represented. This is a conscious design trade-off: a single editable number must not retroactively re-judge past months against a cap they never had.

`budgetBasis: string` is notably untyped as a free-form string rather than a union, unlike `enforce: boolean` and the numeric/null caps. Both current entries hardcode `'gross'`, and nothing in `cost-model.ts` — including `cellCostUsd` or `monthlySeries` — reads or branches on it. It is a documented-but-unenforced, forward-declared attribute.

## Integration Points

`BudgetConfig` connects to the rest of `DashboardCostModel` through `CostConfig.budgets`, keyed by the output of `budgetProvider()`. The coupling between `budgetProvider()`'s two return literals and the key set of `DEFAULT_COST_CONFIG.budgets` is implicit — enforced only by convention, with no shared enum or compile-time link. A mismatch (e.g., a third bucket added to one side but not the other) would not error; `budgetForMonth(cfg.budgets[budgetProvider(row.provider)], month)` would simply receive `undefined` and silently return `null` (no cap).

Per the 'Opus-5 Cost Attribution and API Key Security' work record, `DEFAULT_COST_CONFIG.budgets` is only the code-level default; actual runtime `BudgetConfig` values may be overridden by operator-editable settings served via `GET /api/llm/settings`, meaning consumers should treat the in-source defaults as a fallback layer, not the final source of truth.

## Usage Guidelines

When adding a new provider bucket, both `budgetProvider()`'s mapping and `DEFAULT_COST_CONFIG.budgets`'s key set must be updated together — there is no compiler check forcing this, so mismatches degrade silently to "no cap" rather than erroring. When editing `monthlyEurByMonth`, prefer explicit `null` entries over omission when a month should be recorded as deliberately uncapped, since `hasOwnProperty`-based resolution treats these differently. Mid-month cap changes should be recorded only as the final end-of-month value, since `BudgetConfig` intentionally does not model intra-month history. Finally, `budgetBasis` should not yet be relied upon for branching logic anywhere in the cost model — it is a label awaiting future enforcement, not an active input to `cellCostUsd` or `monthlySeries`.


## Code Evidence

Key code artifacts grounding this entity's analysis:

**Structural:**
- BudgetConfig (class) in cost-model.ts

**Other:**
- The `BudgetConfig` interface in `cost-model.ts` (`monthlyEur: number | null`, `monthlyEurByMonth?: Record<string, number | null>`, `enforce: boolean`, `budgetBasis: string`) is resolved exclusively through the free function `budgetForMonth(b, month)`, which checks `Object.prototype.hasOwnProperty.call(byMonth, month)` before falling back to `b.monthlyEur`. This is a deliberate three-way distinction rather than a simple override: a month key absent from the map means 'use the standing cap', a month key present with a numeric value means 'this month's cap is X', and a month key present with an explicit `null` means 'no cap this month' — three states that a plain `byMonth[month] ?? b.monthlyEur` fallback (using `??` alone, without `hasOwnProperty`) would collapse into two, silently reintroducing the standing cap for a month that was deliberately uncapped.
- `DEFAULT_COST_CONFIG.budgets` populates exactly two `BudgetConfig` entries keyed `copilot` and `claude-max`, and only `copilot` sets `enforce: true` with a real `monthlyEur: 300` (overridden to 1000 for `'2026-08'`); `claude-max` sets `monthlyEur: null, enforce: false`. This asymmetry is structural, not incidental — `claude-max` is a flat subscription with no marginal cost, so its `BudgetConfig` exists in the same shape purely to keep `CostConfig.budgets: Record<string, BudgetConfig>` uniform across both keys, even though one branch of the type (a numeric cap that can be exceeded) is permanently inert for that entry.
- `budgetForMonth()`'s two `BudgetConfig` consumers it must serve are implicitly fixed by `budgetProvider()`, which collapses every provider string in `CostRow` into only `'copilot'` or `'claude-max'` (`BudgetProvider` type). There is no shared enum or compile-time link between `budgetProvider()`'s return type and the keys actually present in `DEFAULT_COST_CONFIG.budgets` — the connection is made only by both independently agreeing on the literal strings `'copilot'` and `'claude-max'`. A third bucket added to one without the other would silently degrade: `budgetForMonth(cfg.budgets[budgetProvider(row.provider)], month)` would receive `undefined` and return `null` (no cap), rather than erroring.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- The work record 'Opus-5 Cost Attribution and API Key Security' establishes that pricing defaults live in `DEFAULT_COST_CONFIG` inside `cost-model.ts` and that persisted, operator-editable config (served via `GET /api/llm/settings`) interacts with these code defaults — meaning the `BudgetConfig` entries actually in force at runtime are not necessarily the literal `DEFAULT_COST_CONFIG.budgets` object shown in source, but that object merged with whatever an operator has since edited through the dashboard's settings surface.

## Hierarchy Context

### Parent
- [DashboardCostModel](./DashboardCostModel.md) -- [LLM] `integrations/system-health-dashboard/src/components/cost/cost-model.ts` defines `BudgetConfig` with both a standing `monthlyEur` cap and an optional `monthlyEurByMonth` override map, and `budgetForMonth()` resolves a given month by checking the override map first (via `Object.prototype.hasOwnProperty.call`, so an explicit `null` entry is honoured as 'no cap that month' rather than falling through). The `DEFAULT_COST_CONFIG.budgets.copilot` entry encodes a concrete case of this: `monthlyEur: 300` with `monthlyEurByMonth: { '2026-08': 1000 }`, documented in the interface comment as the record of a cap that moved 300→600→1000 across August 2026 as extensions were approved — the design exists specifically so a single editable number doesn't retroactively re-judge past months against a budget cap they never had.


---

*Generated from 10 observations*
