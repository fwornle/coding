---
phase: 55
phase_name: unified-viewer-feature-parity-with-vokb
captured: 2026-06-09
trigger: 2026-06-09 operator visual review against VOKB localhost:3002
requirement: UI-02 (NEW)
milestone: post-v7.1 (out-of-milestone bug-fix / feature-parity phase)
---

# Phase 55 Context — Unified Viewer Feature Parity with VOKB

## Why This Phase Exists

Phase 45 ("Unified Web Viewer") was marked complete on 2026-06-08 with the MVP-shipped note "VKB + VOKB stay live as fallback per CONTEXT.md Deferred Ideas". The operator's 2026-06-09 visual review against `localhost:3002` (the legacy VOKB) showed that the unified viewer at `localhost:5173/viewer/{coding,okb,cap}` delivers ~15% of VOKB's surface area:

| VOKB capability | Unified viewer status |
|---|---|
| Stats bar (nodes, edges, evidence, patterns, orphans, connectivity %, LIVE indicator) | ❌ absent |
| Node shape encoding by entity type (squares / diamonds / circles) | ❌ all circles |
| Layer filter (Evidence / Pattern) | ❌ absent |
| Domain filter (RaaS / KPI-FW / General) | ❌ absent |
| Full Ontology Class tree with per-class counts | ⚠ flat class checklist, no counts |
| Show All Relations / Show Clusters / Merged Only / Hide Documentation toggles | ❌ absent |
| Trending Patterns sparklines sidebar | ❌ absent |
| Issue Triage tab + Knowledge Graph tab modes | ❌ absent |
| Entity Details sub-tabs (Default / Evolution / Confidence / Timeline) | ❌ flat panel |
| Relationships breakdown by edge type with counts | ❌ absent |
| Sources & Evidence with per-source icons | ❌ absent |
| Occurrence History | ❌ absent |
| Legend explaining colors / shapes / encoding | ❌ absent |

Plus three direct bugs the same review caught:

- **OKB tab shows the coding KG, not OKM data.** `system-endpoints.ts:18` maps `okb → localhost:3848` (semantic-analysis), which holds the same km-core LevelDB store as obs-api at `:12436`. So `Coding` and `OKB` tabs show functionally identical data — both the coding KG. The actual OKM knowledge graph lives in a different process (`:8090` locally or `https://okm.cc.bmwgroup.net` on BMW infra).
- **CAP tab error UX is misleading.** The viewer's red banner says "Browser blocked the request to https://okm.cc.bmwgroup.net (CORS)". The console shows `net::ERR_NAME_NOT_RESOLVED` — DNS failure, not CORS. The user needs "are you on the BMW VPN?" guidance, not a false-flag CORS message.
- **Markdown vs Entity tab UX inconsistency.** Markdown tab shows ONLY the description text — no metadata header, no Class chip, no Created/Last-confirmed. Entity tab shows the description PLUS the metadata. Markdown is strictly worse, plus a different side-panel width.

Phase 45 stays checked-off in the ROADMAP milestone log because the routing layer is real and useful (system-endpoints config, multi-base ApiClient, ontology display-overlay, view shell). Phase 55 picks up the UI work that should have been part of Phase 45 from the start.

## Phase Goal

Bring the unified viewer to ≥90% feature parity with VOKB (the richer of the two legacy viewers), fix the OKB-data-routing bug, and replace the CAP error UX with environment-aware guidance — so VKB and VOKB users can actually migrate without losing functionality.

## Success Criteria (Locked, from ROADMAP)

1. **Data routing correctness.** OKB tab fetches from actual OKM data source; a new visitor sees RaaS / KPI-FW / business entities, not `CodeAnalyzer` / `PersistenceAgent`.
2. **CAP environment-bound UX.** Detect DNS / TLS failure; show "OKM corporate URL unreachable — are you on the BMW VPN?" instead of misleading CORS banner.
3. **Legend present.** Color and shape encoding documented in an always-visible or one-click legend; mirrors VOKB's encoding wherever feasible.
4. **Node shape encoding by entity type.** Distinct shapes for distinct entity classes, matching VOKB's convention.
5. **Filter parity with VOKB.** Layer, Domain, full Ontology Class tree with per-class counts, plus Show All Relations / Show Clusters / Merged Only / Hide Documentation toggles.
6. **Header stats bar.** Total nodes, total edges, evidence count, pattern count, orphan count, connectivity %, LIVE indicator.
7. **Entity Details parity.** Sub-tabs (Default / Evolution / Confidence / Timeline), Relationships breakdown by edge type with counts, Sources & Evidence with per-source icons, Occurrence History.
8. **Markdown / Entity panel UX.** Markdown tab keeps metadata header + renders description as markdown; Entity tab unchanged; harmonized panel widths.
9. **Trending Patterns sidebar.** Sparklines for top patterns.
10. **Issue Triage mode.** A separate viewer mode targeting operational triage.

## Open Questions for the discuss-phase / researcher

These need operator decisions before plan-phase can produce concrete plans. `/gsd-discuss-phase 55` should ask them.

### Q-55-01: OKB data source — proxy or mirror?

The OKB tab needs to show OKM data, not coding KG data. Two architectural paths:

- **(a) Proxy to OKM's local server.** Change `system-endpoints.ts:18` from `okb → localhost:3848` to `okb → localhost:8090`. Document that OKM must be running locally (start its Express server). CORS needs to be configured on OKM's Express app for `localhost:5173` and `localhost:3032`. Lower architectural impact; requires OKM to be running for OKB tab to work.
- **(b) Mirror OKM data into coding's km-core.** Run a periodic sync that pulls OKM's exports into a separate domain of coding's km-core LevelDB store, mounted at `/api/v1/?domain=okm`. OKB tab reads from that. Higher architectural impact; OKB tab works without OKM running locally; data may be stale.

Recommendation: **(a) is cleaner for local dev; (b) only makes sense if there's a use case for "view OKM data without running OKM locally".** Defer to operator.

### Q-55-02: VOKB feature port — which to keep, which to drop?

Of the 12 missing VOKB capabilities in the table above, most should be ported. Some may be intentionally dropped (e.g., "Issue Triage tab mode" may be OKM-specific and not relevant to the coding KG). Inventory each VOKB feature and assign one of: `port-to-unified` / `defer` / `intentionally-drop`.

### Q-55-03: Node shape / color encoding semantics

VOKB encodes:
- **Color** = layer (Evidence vs Pattern) AND domain (RaaS green, KPI-FW orange, ...)
- **Shape** = entity class (square / diamond / circle)
- **Border** = orphan vs connected
- **Pulse** = recently updated (LIVE)

The unified viewer should adopt the same encoding system, but the underlying ontology is wider (coding's ontology has many classes that VOKB doesn't). Need to map every coding ontology class to a (shape, color) pair, and document the mapping in the legend.

### Q-55-04: Entity Details sub-tab data sources

VOKB's right-panel sub-tabs (Default / Evolution / Confidence / Timeline) read from km-core endpoints that may not all exist yet. Need to inventory which sub-tabs need new REST endpoints vs which can be derived from existing data.

### Q-55-05: Trending Patterns + Issue Triage data sources

"Trending Patterns" sparklines need time-windowed entity creation/update counts grouped by ontology class. Does km-core expose this? If not, may need a new REST endpoint.

"Issue Triage" mode in VOKB filters to entities with edges of type `INDICATES` / `HAS_ROOT_CAUSE` / `CAUSED`. Map to coding ontology's analogous edge types if any exist.

### Q-55-06: UI-SPEC scope

Phase 55 is UI-heavy. Should it spawn a UI-SPEC.md via `/gsd-ui-phase 55`? Probably yes — at minimum for the legend, header stats bar, node-encoding mapping, and Entity Details sub-tab structure.

## Decisions (to be locked by discuss-phase)

- D-55-01: OKB data source path (Q-55-01)
- D-55-02: VOKB feature port matrix (Q-55-02)
- D-55-03: Shape/color encoding mapping (Q-55-03)
- D-55-04: Entity Details sub-tab data sources (Q-55-04)
- D-55-05: Trending Patterns + Issue Triage data sources (Q-55-05)
- D-55-06: UI-SPEC scope (Q-55-06)

## Scope Boundaries

**In scope:**

- All ten SC items above.
- Fix-up of misleading CAP CORS error message (it's actually DNS).
- Documenting the OKB data-source decision in the unified-viewer README (which lives where? — `integrations/unified-viewer/README.md` if it exists; else create it).

**Out of scope (deferred):**

- BMW corporate CORS / DNS configuration for `https://okm.cc.bmwgroup.net` — environment-bound, not in this phase.
- Mirror pipeline implementation if Q-55-01 decides option (b) — separate phase.
- Migration of VKB / VOKB consumers off their legacy viewers — Phase 55 unblocks it; the consumer-side cutover is a separate operator decision.
- Production rollout of the unified viewer at `localhost:3032/viewer/*` to replace VKB / VOKB on host nav — Plan 45-06 already drafted this cutover; Phase 55's success criteria don't include flipping the cutover, just making the viewer fit-for-purpose.

## Cross-Phase Dependencies

- **Phase 45** (routing layer + display-overlay + UI shell) — Phase 55 extends this scaffold.
- **Phase 44** (REST / typed views) — some new endpoints may be required (Q-55-05).
- **Phase 43** (OKM cross-repo migration) — Q-55-01 (a) depends on OKM's Express server exposing `/api/v1/*` reachably + with CORS allowing the viewer's origin.

## Process Amendment (post-mortem on Phase 45)

Phase 55 also serves as a recorded process amendment:

- Every phase close-out MUST produce a VERIFICATION.md, even when the phase shipped under an MVP-fallback caveat. The verifier itself should distinguish `must_have failure` from `MVP-deferred`.
- For viewer-touching plans, the verifier MUST include a side-by-side screenshot comparison against the legacy viewer being replaced (or a documented justification for the absence).
- The "MVP shipped with X as fallback" framing is not a sign-off shortcut — it requires explicit operator approval naming the deferred items.

These rules apply going forward; Phase 55's own verifier MUST include the VOKB side-by-side comparison.

## Discussion Log

- 2026-06-09: Phase 55 captured by operator after Phase 45 visual review. Trigger: side-by-side screenshots of `localhost:5173/viewer/okb` vs `localhost:3002` (VOKB) showed the unified viewer is functionally a regression. Phase 45 stays checked-off in ROADMAP; the UI parity work becomes Phase 55.
