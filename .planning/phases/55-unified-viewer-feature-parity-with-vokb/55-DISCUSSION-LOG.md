# Phase 55: Unified Viewer Feature Parity with VOKB — Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in 55-CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-09
**Phase:** 55-unified-viewer-feature-parity-with-vokb
**Areas discussed:** Existing CONTEXT handling, OKB data source (Q-55-01), CAP tab (Q-55-01b), VOKB feature port matrix (Q-55-02), Coding-specific extras, Node encoding (Q-55-03), Backend endpoints (Q-55-04/05), UI-SPEC scope (Q-55-06), Final notes

---

## Existing CONTEXT.md handling

| Option | Description | Selected |
|--------|-------------|----------|
| Update in place | Keep problem-statement intro + open-questions framing; append locked decisions | ✓ (per rule: same topic = update in place) |
| Replace with standard CONTEXT | Overwrite with canonical /gsd-discuss-phase template | |
| View current file first | Summarize before deciding | |

**User's choice:** "If it's the same rough topic area, update in place. If the existing 55 is something completely different, choose a free phase to fix this viewer mess."
**Notes:** Same topic — Phase 55 IS the unified-viewer parity work. The existing file was the operator's 2026-06-09 problem-statement capture (Q-55-01..06 enumerated, no decisions locked). Updated in place; preserved Why-This-Phase-Exists narrative, gap table, and Process Amendments. Added Implementation Decisions, Canonical References, Code Insights, Specifics, Deferred sections.

---

## Q-55-01: OKB data source

| Option | Description | Selected |
|--------|-------------|----------|
| (a) Proxy to OKM :8090 (one-line fix) | Change `okb → 'http://localhost:8090'`; OKM project must be running | |
| (b) Mirror OKM into coding's km-core under `domain=okm` | Periodic sync; works offline; adds sync pipeline phase | |
| (c) Hybrid: (a) for dev + (b) for CI/no-OKM | Both code paths + sync infra | |
| **(generalize) unified-viewer reads any km-core data dir via HTTP wrapper** | Per-project `(slug, label, baseUrl)` tuples; scales to N projects | ✓ |

**User's choice:** "Generalize" + freeform clarification: "each project has its own data source. Technologically, they are all based on km-core (levelDB, graphology, JSON exports). Project coding has it's data in coding/.data (repo: github.com/fwornle, public) -- project okb in ..../rapid-automations/integration/operational-knowledge-management/.data (repo: bmw.ghe.com, corporate) -- project CAP (what is this anyway??) --> ? -- nothing is on a repo called okm.cc.bmwgroup.net -> you hallucinated this repo. As a rule: nothing is on cc.bmwgroup.net"
**Notes:**
- Locked as **D-55-01a** (generalized routing) + **D-55-01c** (no `cc.bmwgroup.net` rule).
- Concrete mapping: coding → `localhost:12436` (obs-api); okb → `localhost:8090` (OKM Express).
- Researcher MUST verify OKM Express conforms to Phase 44 `/api/v1/*` Zod contract; adapter required if not.
- Two Phase 45 hallucinations exposed: (1) `okb → :3848` was coding's KG, not OKB's; (2) `cap → https://okm.cc.bmwgroup.net` is a hallucinated URL.

---

## Q-55-01b: CAP tab

| Option | Description | Selected |
|--------|-------------|----------|
| **Drop the CAP tab entirely** | Remove from VALID_SYSTEMS, routes, env vars; 2-system viewer (coding + okb) | ✓ |
| CAP is a real project — operator names it | Operator provides name + data-dir + base URL | |
| Keep CAP as a placeholder slot | Wired but points at sentinel; friendly empty-state | |

**User's choice:** Drop CAP entirely.
**Notes:** Operator's freeform earlier ("project CAP (what is this anyway??) --> ?") confirms CAP was never a real system — Phase 45 invented it alongside the hallucinated URL. Locked as **D-55-01b**.

---

## Q-55-02: VOKB feature port matrix

| Option | Description | Selected |
|--------|-------------|----------|
| Port everything; planner escalates if domain-incompatible | Default port-to-unified, no silent drops | |
| Triage each feature now (12-question pass) | Walk feature-by-feature; locks plan count | |
| **Port everything + add coding-specific features** | Feature-superset, not just parity | ✓ |

**User's choice:** Port everything + add coding-specific features (feature-superset).
**Notes:** Locked as **D-55-02a** (12 ports + exact-parity rule) + opened follow-up for additions. Combined with the exact-parity rule that emerged mid-conversation (see below), this means: researcher reads VOKB source for every ported feature; "roughly similar from screenshots" is insufficient.

### Mid-conversation operator rule (CRITICAL)

> "in terms of parity, note that it is insufficient for you to roughly make something similar (eg. from a screenshot) - I want the EXACT same functionality and exact same rendering. So, you need to look up in the original code, how this is produced and re-build this based on the unified UI framework we made"

Saved as feedback memory `feedback_exact_ui_parity.md` and pinned in MEMORY.md. Locked in 55-CONTEXT.md as the binding constraint on D-55-02a — every ported feature requires a "Source files read: <list>" line in the plan and side-by-side screenshot in verification.

---

## Coding-specific extras (D-55-02b follow-up)

| Option | Description | Selected |
|--------|-------------|----------|
| **Component hierarchy view (Project → Component → SubComponent → Detail / L0–L3)** | Tree navigator for coding's 4-level structure; VOKB has flat ontology | ✓ |
| **Session timeline / LSL strip** | Horizontal timeline of LSL session boundaries; coding-only | ✓ |
| **Live observation stream (ETM tail)** | Sidebar streaming real-time obs as ETM writes them | ✓ |
| **Workflow execution status (ukb / wave-analysis)** | Inline UKB-Ops panel | ✓ |

**User's choice:** All four.
**Notes:** Locked as **D-55-02b**. Each surface gated by `system === 'coding'` (OKB stays VOKB-parity only). Plan count expanded from "6–8" to "10–14+".

---

## Q-55-03: Node visual encoding

| Option | Description | Selected |
|--------|-------------|----------|
| Per-system display overlay JSON, hand-authored, extend display block to 4 dimensions | Operator/researcher hand-authors mapping | |
| Derive automatically: shape = hierarchy level, color = hash(class) | Zero hand-authoring; loses VOKB semantic | |
| **VOKB-derived: researcher reads VOKB's encoding code and produces coding-equivalent overlay** | Same end-state as (1) but researcher does the authoring; matches exact-parity rule | ✓ |

**User's choice:** VOKB-derived (researcher authors from source).
**Notes:** Locked as **D-55-03**. Schema extension: `display.borderStyle` (solid/dashed for orphan) and `display.pulseRule` (e.g. `lastUpdatedWithin:60s`). Overlay at `coding/.data/ontologies/coding.display.json`. OKB overlay is OKM-repo work, deferred.

---

## Q-55-04/05: New backend endpoints

| Option | Description | Selected |
|--------|-------------|----------|
| **Researcher inventories existing /api/v1/* + identifies gaps; planner proposes per-feature additions following Phase 44 contract** | RESEARCH.md produces feature→endpoint matrix; operator reviews before plan-phase | ✓ |
| Polling only — no SSE/WebSocket additions | Hard constraint on streaming | |
| Streaming where natural (ETM tail, LIVE) + polling elsewhere | SSE on obs-api for live surfaces | |

**User's choice:** Researcher matrix + per-feature planner proposal; no blanket SSE/polling constraint.
**Notes:** Locked as **D-55-04/05**. Endpoints follow Phase 44 lock (`/api/v1/*`, Zod-typed, camelCase). SSE vs polling decided per-feature. Operator review gate before plan-phase decomposes per-feature plans.

---

## Q-55-06: UI-SPEC scope

| Option | Description | Selected |
|--------|-------------|----------|
| **Yes — full UI-SPEC.md via /gsd-ui-phase 55** | Covers layout, component inventory (16 surfaces), encoding mapping, interaction patterns | ✓ |
| Targeted UI-SPEC — only new surfaces (4 coding extras + encoding overlay) | Faster; risks layout inconsistency | |
| No UI-SPEC — researcher's port-spec + screenshots are sufficient | Lightest workflow; relies on researcher quality | |

**User's choice:** Full UI-SPEC.
**Notes:** Locked as **D-55-06**. `/gsd-ui-phase 55` runs AFTER this CONTEXT commits and BEFORE `/gsd-plan-phase 55`.

---

## Final notes (multi-select)

| Option | Description | Selected |
|--------|-------------|----------|
| **Amend Phase 45 D-45-02 in CONTEXT.md** | Explicit "Amends Phase 45 D-45-02" note (CAP dropped, OKB routing rule changed) | ✓ |
| **Lock 'no SSH to bmw.ghe.com' / 'no cc.bmwgroup.net' rule** | Disallowed sources section | ✓ |
| Defer OKM repo PR for display-overlay schema | Document as deferred follow-up | (added to Deferred Ideas regardless; not picked as "must-call-out") |
| **Preserve Phase 45 process amendments** | VERIFICATION.md mandatory, side-by-side screenshots, MVP-fallback naming | ✓ |

**Notes:** All three picked items reflected in CONTEXT.md. The OKM-repo PR is in Deferred Ideas even though not picked here — preserving it avoids losing the follow-up.

---

## Claude's Discretion

- Plan decomposition (10–14 plans is a sizing estimate, not a cap)
- SSE-vs-polling choice per individual feature within D-55-04/05's matrix
- Keyboard shortcut assignments for new surfaces
- Internal Zustand slice organization for new state (mirror VOKB's Redux slices where porting; new state can follow unified-viewer's existing conventions)

## Deferred Ideas

- OKM-repo PR for `okb.display.json` (out of scope for Phase 55 source-tree)
- Consumer-side cutover from VKB/VOKB to unified-viewer (separate operator decision after parity verified)
- Production rollout at `localhost:3032/viewer/*` (Plan 45-06 drafted mechanics)
- Mirror OKM data into coding's km-core (rejected here in favor of direct routing; separate phase if use case emerges)
- Generalize to N > 2 projects (architecture supports it; Phase 55 ships only coding + okb)
- Add CAP back if it becomes a real system (just another `(slug, label, baseUrl)` tuple if so)

## Process Amendments (binding for Phase 55 and going forward)

1. Every phase close-out MUST produce VERIFICATION.md (even MVP-fallback).
2. Viewer-touching plans MUST include side-by-side screenshot vs legacy viewer.
3. "MVP shipped with X as fallback" requires explicit operator approval naming deferred items.
4. (NEW) UI feature-parity work MUST read the source, not screenshots. Plans list "Source files read"; verifier compares pixel-by-pixel via `gsd-browser`.
5. (NEW) No `cc.bmwgroup.net` references anywhere. Corporate Git is `bmw.ghe.com` (HTTPS-token via gh CLI, not SSH).
