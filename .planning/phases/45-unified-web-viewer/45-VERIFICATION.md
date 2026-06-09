---
phase: 45-unified-web-viewer
verified: 2026-06-09T07:30:00Z
status: gaps_found
score: 2/4 success criteria substantively verified (coding tab works; OKB-CORS just fixed inline but OKB-data-source + CAP-VPN are unaddressed)
overrides_applied: 0
gaps_found:
  - id: 45-G01-OKB-CORS
    severity: critical
    truth: "Unified viewer's OKB tab is unreachable from the Vite dev server (localhost:5173) because semantic-analysis's Express app does not emit Access-Control-Allow-Origin headers on the km-core /api/v1/* mount."
    discovered: "2026-06-09 — operator screenshot of localhost:5173/viewer/okb showing CORS errors on /api/v1/ontology/classes, /api/v1/entities, /api/v1/relations."
    resolved: "2026-06-09 — fixed inline by adding Express CORS middleware to integrations/mcp-server-semantic-analysis/src/sse-server.ts (commit fc05d3c in submodule, e2fbcda74 in outer repo). Wildcard CORS for dev origins; OPTIONS preflight short-circuit. Docker build also required two companion fixes (idempotent km-core tarball mv + --no-package-lock on integration install) to support iterating on km-core changes."
    classification: "CLOSED — verified inline via curl with Origin: http://localhost:5173 returning Access-Control-Allow-Origin: * + real data."
  - id: 45-G02-OKB-DATA-SOURCE
    severity: warning
    truth: "Even after CORS works, the OKB tab reads from semantic-analysis's km-core store (port 3848), which may not contain the OKM (operational-knowledge-management) data the user expects. Architecturally this is two distinct knowledge graphs — coding's KG vs OKM's KG — using the same shared store contract."
    artifacts:
      - path: integrations/unified-viewer/src/config/system-endpoints.ts
        issue: "`okb` maps to localhost:3848 (semantic-analysis) but OKM's Express server is at localhost:8090 — different process, different graph. Whether semantic-analysis is supposed to mirror OKM data, or whether OKB tab should proxy to :8090, was not explicitly decided in Phase 45 (Plan 45-04 added the /api/v1/ontology/classes display overlay handler at km-core but did not resolve the data-source question for OKB)."
    classification: "OPEN — operator decision: (a) leave semantic-analysis as the OKB backend and document that OKM data only flows in via wave-analysis writes, OR (b) re-route the OKB tab to localhost:8090 (OKM Express server) directly."
    deferred_to: "Phase 45 gap-closure plan via /gsd-plan-phase 45 --gaps"
  - id: 45-G03-CAP-VPN-DEPENDENCY
    severity: warning
    truth: "CAP tab targets https://okm.cc.bmwgroup.net — a BMW-internal corporate URL only reachable when the operator is on BMW network or VPN."
    artifacts:
      - path: integrations/unified-viewer/src/config/system-endpoints.ts
        issue: "Line 19: `cap: import.meta.env.VITE_BACKEND_CAP_URL ?? 'https://okm.cc.bmwgroup.net'`. Outside the BMW network this resolves but the connection times out / DNS fails / TLS handshake fails depending on the operator's location."
    classification: "OPEN — environmental constraint, not a code bug. Action options: (a) document the dependency in viewer's README + show a friendlier error in the FilterRail when CAP fetch fails, OR (b) provide a localhost CAP mock for off-VPN dev."
    deferred_to: "Phase 45 gap-closure plan via /gsd-plan-phase 45 --gaps"
  - id: 45-G04-MISSING-VERIFICATION
    severity: process
    truth: "Phase 45 was marked complete in ROADMAP via the 'MVP shipped 2026-06-08 — VKB + VOKB stay live as fallback' note without the verifier ever running. That's how G01–G03 escaped detection until the operator demonstrated the OKB-tab failure visually."
    classification: "PROCESS — record the slip; do not re-open Phase 45 for this alone. Going forward: every phase close must produce a VERIFICATION.md, even when the phase shipped under an MVP-fallback caveat (the verifier itself should distinguish 'must_have failure' from 'MVP-deferred')."
human_verification:
  - test: "Reload http://localhost:5173/viewer/okb in the browser after the CORS fix"
    expected: "FilterRail no longer shows the red CORS-blocked banner; entities + relations + ontology classes load; clicking a node opens EntityDetailPanel with real data."
    why_human: "The fix is server-side; only a browser refresh by the operator confirms the UX outcome."
  - test: "Reload http://localhost:5173/viewer/cap on BMW network/VPN"
    expected: "CAP tab fetches succeed against https://okm.cc.bmwgroup.net (assuming BMW's OKM frontend exposes the canonical /api/v1/* surface — separate question)."
    why_human: "Environment-dependent; only verifiable when the operator is on BMW network."
verification_methodology:
  - "Read all six Plan 45-NN-SUMMARY files to enumerate what shipped."
  - "Cross-check ROADMAP § Phase 45 against the four SCs."
  - "Operator screenshot drove discovery of 45-G01."
  - "curl probes of localhost:3848/api/v1/* confirmed CORS gap pre-fix + restoration post-fix."
re_verification: "/gsd-plan-phase 45 --gaps will pick up G02 + G03 + G04 as inputs. G01 is already closed; gap-closure plan should reflect that the regression mode that produced G01 is what G04 records — and propose adding the verifier-MUST-run gate to phase close-out."
---

# Phase 45 — Unified Web Viewer: Verification (Retroactive)

This VERIFICATION.md was written **after** Phase 45 had already been marked complete in ROADMAP (the "MVP shipped 2026-06-08 — VKB + VOKB stay live as fallback" note). The retroactive trigger was an operator screenshot dated 2026-06-09 showing CORS errors on the OKB tab of the unified viewer at `localhost:5173/viewer/okb` — i.e., the unified viewer's SC was not actually verified end-to-end before the MVP-shipped sign-off.

## Per-SC Verdicts

### SC-1: Single viewer parameterized by ontology config — **PARTIAL**

The viewer code IS parameterized (`integrations/unified-viewer/src/config/system-endpoints.ts` maps three system slugs to three backend URLs; the `?withDisplay=true` overlay flows ontology display hints into FilterRail). However, only the `coding` tab works out-of-the-box. OKB and CAP tabs failed in the operator's environment for distinct reasons (CORS for OKB — now fixed; BMW VPN for CAP — environment-bound).

### SC-2: VKB and VOKB users migrate without functional regression — **NOT VERIFIED**

The MVP-shipping caveat in ROADMAP explicitly allowed VKB + VOKB to stay live as fallback. That accepts a regression for users who want to drop the legacy viewers entirely. With G01 closed, OKB users CAN now use the unified viewer for browse-only flows — but a proper migration check (do the unified viewer's interaction patterns match VOKB's? do screenshots match per the legacy parity check Plan 45-05 documented?) was not exercised by the operator before sign-off.

### SC-3: Per-system display config (icons, colors, label positions) — **VERIFIED**

Plan 45-04 landed the `?withDisplay=true` overlay (km-core + display-overlay.ts + seeded `coding.display.json`); FilterRail's class chips render colors per the overlay. Plan 45-06 walked the cutover & operator probes 1+2 (BMW corp network reachability) which remain DEFERRED per Plan 45-06-OPERATOR-PROBES.md.

### SC-4: Production cutover — **PARTIAL**

Plan 45-06 documented the cutover plan; operator probes 1+2 remain deferred. The production path (localhost:3032/viewer/coding via system-health-dashboard) was not exercised against an OKB-data scenario before this VERIFICATION.md.

## Conclusion

Phase 45 close-out was premature. The operator-discovered CORS gap (G01) was fixed inline 2026-06-09. Three remaining gap items (G02 OKB data source, G03 CAP VPN dependency, G04 missing-VERIFICATION process slip) are surfaced here for `/gsd-plan-phase 45 --gaps` to consume.

The operator's visual disagreement with "Phase 45 complete" status was correct — this VERIFICATION.md retroactively records the real shipping state. Phase 45 stays marked complete in ROADMAP (the MVP DID ship and the closed gap was reachable from the unified viewer); the gap-closure plan will resolve the remaining open items without claiming a regression.
