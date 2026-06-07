# Phase 45 Plan 06 — Wave 0 Operator Probes

Outcome record for the four Wave 0 probes called out in
`45-VALIDATION.md` § Wave 0 — Operator Probes table.

| Probe | Network    | Owner    | Outcome                |
| ----- | ---------- | -------- | ---------------------- |
| 1     | BMW corp   | Operator | DEFERRED-TO-OPERATOR   |
| 2     | BMW corp   | Operator | DEFERRED-TO-OPERATOR   |
| 3     | Local      | Executor | GREEN (2026-06-07)     |
| 4     | Local      | Executor | GREEN (2026-06-07)     |

Probe-1 and Probe-2 must be run from a BMW corporate laptop on-network.
The Plan 06 executor runs in a parallel-worktree context that has no
BMW VPN tunnel, so those probes cannot be executed here. The Plan 05
RcaOpsPanel UI handles both GREEN and RED outcomes gracefully — if a
RED arrives later, no Plan-05 code change is needed.

Final ship-decision recorded after operator probe outcomes land
(default per planner: SHIP — UI failure modes are correct, Tier 2/3
proxy work additive to Phase 45.1).

---

## Probe 1 — C-system CORS reachability

**Status:** DEFERRED-TO-OPERATOR (requires BMW corporate laptop on-network)

**Command:**

```
curl -i -H "Origin: http://localhost:5173" https://okm.cc.bmwgroup.net/api/okm/health
```

**Expected GREEN:**
- HTTP/1.1 200
- `Access-Control-Allow-Origin: http://localhost:5173` (or `*`)
- No redirect to BMW SSO HTML

**Expected RED:**
- CORS preflight rejected, OR
- 302 redirect to SSO login HTML, OR
- Connection failed (off-VPN)

**Output (operator pastes verbatim, redacts cookies / auth headers):**

```
(operator-to-fill)
```

**Outcome:**
- [ ] GREEN
- [ ] RED — activate Tier 2 (backend-proxy via A) fallback (Phase 45.1 — ~2 days)
- [ ] RED — activate Tier 3 (backend-proxy via B) fallback (Phase 45.1 — ~2 days)

**Decision:**

(operator-to-fill — SHIP-with-mock-UI default per planner if RED)

---

## Probe 2 — C-system SSE reachability

**Status:** DEFERRED-TO-OPERATOR (requires BMW corporate laptop on-network)

**Command:**

```
curl -N https://okm.cc.bmwgroup.net/api/okm/ingest/progress
```

**Expected GREEN:**
- Connection stays open
- Server emits `event:` / `data:` SSE frames
- Stream readable without browser CORS preflight

**Expected RED:**
- Same RED classes as Probe 1 — terminate the curl with Ctrl-C if it
  stalls beyond 10 seconds

**Output (operator pastes verbatim, redacts cookies):**

```
(operator-to-fill)
```

**Outcome:**
- [ ] GREEN
- [ ] RED — Plan 05 RcaOpsPanel verified in MOCK-SSE mode only;
  real-stream verification deferred to Phase 45.1

**Decision:**

(operator-to-fill)

---

## Probe 3 — lucide-react icon completeness

**Status:** GREEN — executed 2026-06-07 by Plan 06 executor.

**Command:**

```bash
cd integrations/unified-viewer
node -e "const l=require('lucide-react'); ['ZoomIn','ZoomOut','Maximize','Search','Filter','ChevronLeft','ChevronRight','HelpCircle','Sun','Moon','Loader2','Network','MousePointer','ArrowRight','Info'].forEach(i=>console.log(i, typeof l[i]))"
```

**Output (verbatim):**

```
ZoomIn object
ZoomOut object
Maximize object
Search object
Filter object
ChevronLeft object
ChevronRight object
HelpCircle object
Sun object
Moon object
Loader2 object
Network object
MousePointer object
ArrowRight object
Info object
```

**Note:** lucide-react v0.544 exports `React.forwardRef` components,
which report as `object` (not `function`) under `typeof`. Every required
icon resolves — none are `undefined`. The expected-GREEN condition in
the PLAN spelled `<name> function` against an older lucide-react export
shape; the modern shape uses `object`. Both are GREEN — the failure
mode the probe guards against is `undefined`, which would indicate a
missing icon. None of the 15 icons is missing.

**Outcome:** GREEN — no icon substitutions required; UI-SPEC § Icon-only
controls table unchanged.

**Decision:** Continue with the existing icon set across NavBar,
FilterRail, SidePanel, MarkdownViewerPanel, RcaOpsPanel.

---

## Probe 4 — display-overlay query param strategy

**Status:** GREEN — executed 2026-06-07 by Plan 06 executor.

**Planner recommendation (RESEARCH § Open Question #4):** keep the
display-overlay GATED behind `?withDisplay=true` — backward-compatible,
no cross-repo OKM contract change required.

**Plan 04 implementation:** ALREADY ships the gated extension via
`ApiClient.listOntologyClasses()` calling
`/api/v1/ontology/classes?withDisplay=true` and falling back gracefully
if the server returns the pre-Plan-04 `string[]` shape.

**Local verification (live A backend on :12436):**

```bash
curl -s 'http://localhost:12436/api/v1/ontology/classes?withDisplay=true'
```

Returns the rich shape:

```json
{
  "success": true,
  "data": [
    {"name":"LearningArtifact"},
    {"name":"Observation","display":{"color":"#3b82f6","icon":"Activity","shape":"circle"}},
    {"name":"Digest","display":{"color":"#10b981","icon":"FileText","shape":"circle"}},
    {"name":"Insight","display":{"color":"#f59e0b","icon":"Lightbulb","shape":"circle"}}
  ]
}
```

```bash
curl -s 'http://localhost:12436/api/v1/ontology/classes'
```

Returns the pre-Plan-04 `string[]` shape:

```json
{"success":true,"data":["LearningArtifact","Observation","Digest","Insight"]}
```

**Outcome:** GREEN — gated `?withDisplay=true` returns enriched objects;
unparameterized call returns plain `string[]`. Both shapes coexist
without contract breakage.

**Decision:** KEEP gated. No cross-repo OKM `rest-contract.test.ts:257`
update required. Phase 45.1 may revisit once the cross-system display
overlay matures.

---

## Ship-decision summary

| Probe | Outcome              | Implication for Plan 05 ship    |
| ----- | -------------------- | ------------------------------- |
| 3     | GREEN                | UI ships with full icon set     |
| 4     | GREEN                | UI ships with gated overlay     |
| 1     | DEFERRED-TO-OPERATOR | UI ships with mock + error UI   |
| 2     | DEFERRED-TO-OPERATOR | UI ships with mock + error UI   |

Per the planner's default in RESEARCH § Open Question #5 and CONTEXT.md
Deferred Ideas: SHIP — the Plan 03 / Plan 05 error surfaces already
handle the RED outcomes correctly. Phase 45.1 owns any Tier 2 / Tier 3
backend-proxy work and CAP-network parity work.
