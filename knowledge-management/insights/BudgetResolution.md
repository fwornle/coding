# BudgetResolution

**Type:** Detail

budgetForMonth() in cost-model.ts checks b.monthlyEurByMonth for an own-property match on the 'YYYY-MM' key before falling back to b.monthlyEur

# BudgetResolution — Technical Insight Document

## What It Is

BudgetResolution is the monthly budget-cap resolution logic implemented in `budgetForMonth()` within `cost-model.ts`. It determines the effective spending cap for a given calendar month by consulting a budget entry `b`, checking `b.monthlyEurByMonth` for an own-property match keyed on the `'YYYY-MM'` format, and falling back to `b.monthlyEur` (the standing/default cap) when no month-specific override exists. This function is a core capability of its parent component, CostModelEngine, which also governs model pricing resolution via `priceForModel()`.

## Architecture and Design

The design follows a layered-override resolution pattern, structurally similar to the three-tier fallback strategy used by sibling logic `priceForModel()` in CostModelEngine (exact match → representative fallback → generic default). Here, the tiers are simpler — a month-specific override versus a standing default — but the underlying philosophy of "most specific match wins" is shared across CostModelEngine's resolution functions.

A key design decision is the explicit modeling of *absence* versus *null* as distinct signals: an own-property check (rather than a truthy check) distinguishes "no entry for this month" (fall back to standing cap) from "entry present but explicitly null" (interpreted as "no cap this month"). This is a deliberate three-state semantic (unset / null / value) rather than a simple two-state override, requiring careful use of property-existence checks (e.g. `in` or `hasOwnProperty`) instead of naive value truthiness.

Another architectural constraint, documented directly on BudgetConfig, is that budget resolution operates at whole-month granularity only — in-month changes are explicitly not modeled. Whatever cap is in force at month end governs the entire calendar month retroactively/prospectively. This is a simplifying trade-off: it avoids the complexity of date-range interpolation within a month at the cost of precision for teams that change budgets mid-month.

## Implementation Details

The core mechanics live in `budgetForMonth()`:
- Look up `b.monthlyEurByMonth[YYYY-MM]` using an own-property check.
- If the key exists and its value is `null`, treat the month as uncapped.
- If the key exists with a numeric value, use it as the cap.
- If the key is absent entirely, fall back to `b.monthlyEur`.

`DEFAULT_COST_CONFIG.budgets.copilot` illustrates this concretely: `monthlyEur: 300` acts as the standing cap, while `monthlyEurByMonth: { '2026-08': 1000 }` raises the cap specifically for August 2026 without altering the baseline. This pattern allows configuration authors to express temporary or one-off budget adjustments without restructuring the whole budget schema.

## Integration Points

BudgetResolution is a facility of CostModelEngine, sitting alongside ModelFamilyPricing (`modelFamily()`, mapping model name substrings like 'haiku', 'sonnet', 'opus', 'gpt-4o', 'gpt-5' to a `ModelFamily` enum) and WireProtocolTokenSemantics (`isOpenAIWireProvider()`, distinguishing OpenAI-wire providers like copilot/github/opencode from Anthropic-wire providers). While these siblings resolve *what* a request costs per unit and *how* tokens are counted, BudgetResolution governs *how much total spend is permitted* in a given month — together these form CostModelEngine's cost-governance surface. BudgetConfig serves as the schema/contract that BudgetResolution consumes, defining both `monthlyEur` and `monthlyEurByMonth` fields and documenting the month-granularity constraint.

## Usage Guidelines

When authoring budget configurations, use `monthlyEurByMonth` sparingly and only for genuine month-level exceptions (as in the copilot example raising the cap to 1000 for August 2026). Do not attempt to express intra-month changes — the system does not support them, and the cap active at month's end is authoritative for the whole month. When explicitly disabling a cap for a specific month, set the value to `null` rather than omitting the key, since omission triggers fallback to the standing `monthlyEur` cap, while `null` produces an uncapped month — the two are not interchangeable. Developers extending this logic should preserve the own-property distinction to avoid silently collapsing the null/absent semantic difference.


## Hierarchy Context

### Parent
- [CostModelEngine](./CostModelEngine.md) -- priceForModel() implements a three-tier resolution: exact model key match, family-representative fallback via FAMILY_REPRESENTATIVE, then generic family match, defaulting to a zero-priced 'none' source

### Siblings
- [ModelFamilyPricing](./ModelFamilyPricing.md) -- modelFamily() in cost-model.ts maps model substrings like 'haiku', 'sonnet', 'opus', 'fable', 'gpt-4o-mini', 'gpt-4o', 'gpt-5' to a ModelFamily enum, defaulting to 'other'
- [WireProtocolTokenSemantics](./WireProtocolTokenSemantics.md) -- isOpenAIWireProvider() in cost-model.ts flags copilot/github/opencode providers as speaking the OpenAI wire versus Anthropic wire


---

*Generated from 4 observations*
