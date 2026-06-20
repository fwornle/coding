# Phase 61: LSL Timeline & OKB Routing Honesty - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-20
**Phase:** 61-LSL Timeline & OKB Routing Honesty
**Areas discussed:** 200-cap honesty, 'all' window meaning, Bi-source tick coloring, OKB contract bridge

---

## 200-cap honesty (LSLTIME-01)

| Option | Description | Selected |
|--------|-------------|----------|
| Cap + 'N of M' label | Keep a bounded fetch cap; render a visible "showing N of M total" badge when truncated. Bounded DOM, legible strip, no silent lies. | ✓ |
| Remove cap, stream all | Raise limit to a huge ceiling / no cap; render every session in the window. Literal "no truncation" but 1,600+ ticks per 30d view (perf + density). | |
| You decide | Defer cap-vs-label balance to Claude. | |

**User's choice:** Cap + 'N of M' label
**Notes:** Thousands of overlapping 2px ticks are illegible regardless; the honest count badge is the real win. Cap number raised to a sane ceiling is Claude's discretion.

---

## 'all' window meaning (LSLTIME-02)

| Option | Description | Selected |
|--------|-------------|----------|
| Rename 'all' → '1y' | Keep the 365-day value, label it honestly. Ladder: 24h/7d/30d/1y. Minimal, truthful, no backend change. | ✓ |
| Make 'all' truly all-time | WINDOW_MS.all = Infinity / oldest-on-disk. Faithful to "all" but pulls full 22k history; only sane with cap removal. | |
| Both: '1y' + a real 'all' | Rename 365d to '1y' AND add a separate true-all-time option. Most complete but adds a 5th toggle button. | |

**User's choice:** Rename 'all' → '1y'
**Notes:** Pairs with the "N of M" badge for anything beyond a year. True all-time deferred.

---

## Bi-source tick coloring (LSLTIME-03)

| Option | Description | Selected |
|--------|-------------|----------|
| Backend adds source; pink=auto + 2nd color | obs-api session payload gains a per-session source (from observation metadata.source). Pink=online/auto + distinct hue for manual/batch. Backend = honest truth. | ✓ |
| Derive client-side heuristic | Infer source from session id pattern / timing; no backend change but fragile (id may not encode origin). | |
| You decide colors | Backend adds the field; Claude picks colors + bucketing semantics. | |

**User's choice:** Backend adds source; pink=auto + 2nd color
**Notes:** Confirmed by scouting that the session payload `{id, startAt, endAt, observationCount, entityIds}` carries no source field today, so an additive obs-api field is in scope. Exact 2nd hue is Claude's discretion.

---

## OKB contract bridge (OKBROUTE-01/02 + SC#5)

| Option | Description | Selected |
|--------|-------------|----------|
| ApiClient path-rewrite + adapter (okb) | For system=okb, rewrite /api/v1/entities → /api/entities and normalize OKM Express's response to Entity[]. Low-touch, OKM Express untouched, tactical. SC#5 truthful-failure handled here. | ✓ |
| Mount /api/v1 on OKM Express | Add a Phase-44 contract adapter server-side on OKM Express. "One canonical contract everywhere" but edits the OKM Express submodule (heavier, cross-repo). | |
| You decide | Pick A vs B by shape-distance / whether OKM Express is retiring. | |

**User's choice:** ApiClient path-rewrite + adapter (okb)
**Notes:** Matches REQUIREMENTS.md's stated adapter location (system-endpoints.ts / ApiClient.ts) and keeps the change inside the viewer. SC#5 — truthful "OKM Express unreachable on :8090" message, no silent coding-KG fallback — locked as part of this area.

---

## Claude's Discretion

- Bounded cap number (raise from 200 to a sane ceiling, e.g. 500).
- Second tick hue for manual/batch sessions (must be clearly distinguishable; coexist with greyed-out 0-obs + blue selection/halo rings).
- Cheapest mechanism to obtain the total `M` count for the "N of M" badge.
- Deterministic derivation rule for a session's source when its observations are mixed-source.

## Deferred Ideas

- True all-time LSL window (Infinity / oldest-on-disk) — revisit only if 1y + badge proves insufficient.
- Sparse graph-node-history backfill — separate mcp-server-semantic-analysis investigation.
- Mirror OKM data into coding's km-core (Option C) — heavier, offline-query only.
- Server-side /api/v1 adapter on OKM Express (Option B) — revisit if OKM Express survives long-term.
