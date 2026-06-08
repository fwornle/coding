---
phase: 46
phase_name: Per-System Documentation & Onboarding
captured: 2026-06-08
purpose: Plan-author and executor-shared patterns for Phase 46. Encodes the planner-resolvable items from 46-RESEARCH.md so every plan can reference them by ID instead of re-deriving.
---

# Phase 46 Patterns

## P-1: README 6-Section Skeleton (locked by D-46-02)

Every Phase 46 README (A, B, C, KM-Core) MUST contain these six sections, in this order, with these exact headings (so a contributor jumping between READMEs finds the same section names in the same positions — direct support for SC-1 and SC-4):

1. `# {System Name}` — one-sentence role in the KM unification
2. `## Configurations Owned` — bullet list of config domains (ontology / LLM / ingest / domain eval). For slots the system does NOT own, write `— (owned by KM-Core / B / etc.)` rather than omitting the line, so the contract is visible.
3. `## Architecture` — embedded PNG + 3–5 sentence box summary (NOT a long discussion)
4. `## Where to Edit` — markdown table mapping `To add…` → `Edit…` → `Verify` (this table is the SC-1 enforcement surface — every row MUST give a path AND a verification command)
5. `## Related Systems` — link to KM-Core + the other two systems (this table is the SC-4 enforcement surface)
6. `## Tests / Verify` — system-specific verification snippet. For KM-Core only: includes a link to `docs/ONBOARDING.md`.

The literal markdown skeleton with `{placeholder}` syntax lives at `lib/km-core/docs/README-TEMPLATE.md` (created in Plan 46-01) — downstream README rewrites copy-paste-and-fill from it.

## P-2: PUML Authoring + Two-Image-Dir Duplication (locked by D-46-03)

**Mandatory invocation order for any diagram task:**

1. First action in any task touching `.puml` or `.png` files: invoke the `documentation-style` skill (`.claude/commands/documentation-style.md`). The skill defines hard placement rules enforced by the constraint monitor.
2. PUML sources land in `docs/puml/` (or `lib/km-core/docs/puml/` for KM-Core-scoped diagrams).
3. PUML preamble (verified pattern from `docs/puml/adaptive-lsl-system.puml:1-2`): every PUML file's first two lines are the start-uml directive with a lowercase-hyphenated diagram name followed by an include of `_standard-style.puml` (relative path from the PUML's own directory). See `docs/puml/adaptive-lsl-system.puml` for the canonical pattern. For PUMLs under `lib/km-core/docs/puml/`, the include path resolves as `../../../docs/puml/_standard-style.puml` relative to the PUML's own directory.
4. Render via the `plantuml` CLI — NEVER `java -jar plantuml.jar`. CLAUDE.md mandate.
5. **Two-image-dir duplication is mandatory** (per `feedback_mkdocs_two_image_dirs.md`):
   - Move generated PNG to `docs/images/<name>.png`
   - Copy (NOT move) to `docs-content/images/<name>.png`
   - Both paths MUST be in `files_modified` and both MUST exist after the task.
6. README image refs use relative paths from each README's location to `docs/images/<name>.png`. For KM-Core's README at `lib/km-core/README.md`, that's `../../docs/images/km-core-architecture.png`.

## P-3: Onboarding Exercise Canon (locked by D-46-04 + RESEARCH § Step 4)

The onboarding guide uses these verified-during-research facts. Executors MUST NOT alter without re-verification:

| Claim | Verified Source | Value |
|---|---|---|
| Canonical write endpoint | `lib/km-core/src/api/handlers/entities.ts:110-145` | `POST /api/v1/entities` (NOT `POST /api/v1/ingest` — researcher A1, resolved by planner) |
| obs-api host port | RESEARCH § Sources + `lib/km-core/tests/fixtures/b-coding-snapshot.json` | `localhost:12436` |
| `LiveLoggingSystem` is a Component instance, NOT an ontology class | `general.json` + `.data/ontologies/coding-ontology.json` (verified by researcher) | Tutorial entity has `entityType: "SubComponent"` + `componentName: "LiveLoggingSystem"` — new SubComponent INSTANCE, not a new class |
| SubComponent properties | `coding-ontology.json` classes.SubComponent.properties | `componentName`, `parentComponent`, `level` |
| Cleanup script | `scripts/purge-knowledge-entities.js` (verified present) | `node scripts/purge-knowledge-entities.js <YYYY-MM-DD> --name=LslHeartbeatRotator --verbose` |
| Phase 45 viewer URL for Step 6 verification | Phase 45-06 SUMMARY | `http://localhost:3032/viewer/coding` |
| Viewer precheck (avoid false-fail on Step 6) | RESEARCH Pitfall #8 | `curl http://localhost:3032/api/health` BEFORE opening viewer |

The full 7-step script lives in 46-RESEARCH.md § "Onboarding Exercise Script" and is transcribed verbatim into `lib/km-core/docs/ONBOARDING.md` by Plan 46-05.

## P-4: OKM Repo Coordination (planner-resolvable item, resolved)

The OKM README lives in an **external BMW GHE repo** accessed via the `_work/rapid-automations` parent submodule at `/Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/` — NOT under the coding repo. Phase 46 plan-state on this:

- **Recommended PR target (resolved):** Land the new C README on the **currently-checked-out branch `gsd/44-09-rest-cutover-v2`** in the OKM repo. Rationale: that branch is the active integration branch for the Phase 44 REST cutover (whose contract this Phase 46 README documents); merging to upstream main against an older snapshot would diverge from the wire-shape the README describes. The Phase 44 cutover PR will fold this README in when it lands upstream.
- **Commit path:** Commit + push on the OKM repo (HTTPS — per `feedback_bmw_ghe_https.md`, SSH fails for BMW GHE). Coding repo does NOT track `rapid-automations` as a submodule — no submodule pointer bump on the coding side. (RESEARCH OQ-1 confirmed.)
- **Authoring approach:** Cherry-pick content from OKM's existing `docs/index.md`, `docs/architecture.md`, `docs/api-reference.md` — do NOT duplicate long-form prose; link to it. The new README is a navigation entry point, not a content fork.
- **Plan 46-04 handles this** end-to-end (author + commit + push on OKM branch). Executor will be required to operate in the OKM working tree, NOT the coding tree, for that plan's write step.

## P-5: B Submodule Push (planner-resolvable item, resolved)

`integrations/mcp-server-semantic-analysis` is a git submodule pointing at `fwornle/mcp-server-semantic-analysis`. Phase 46 plan-state on this:

- **Recommended PR target:** main branch of the submodule's upstream (the README rewrite is independent of any Phase 44/45 cutover branch on that submodule).
- **Commit path:** Commit inside the submodule working tree, push to its `origin/main`, then commit the **submodule pointer bump** in the coding repo as a follow-up step. (Distinct from the OKM case: the coding repo DOES track this submodule.)
- **No build/Docker rebuild needed** for the README + AGENTS.md changes (per CLAUDE.md submodule build pipeline section — only TS source changes need rebuild).
- **AGENTS.md companion:** Per RESEARCH OQ-3, the existing 573-line B README is split — Configurations-Owned section stays in README.md (≤ ~150 lines for 5-min readability), per-agent enhancement narratives + MCP tool catalog + use cases + project structure move to `integrations/mcp-server-semantic-analysis/docs/AGENTS.md` (NEW). README.md preserves the 14-agent catalog inline (just names + 1-line roles) and links to AGENTS.md for the detail.

## P-6: documentation-style Skill — Output-Dir Convention (planner-resolvable item, resolved)

The `documentation-style` skill (`.claude/commands/documentation-style.md`) defines hard placement rules enforced by the constraint monitor. Phase 46 plan-state on this:

- **Skill output-dir convention aligns with P-2** above. Specifically: `.puml` → `docs/puml/`; generated `.png` → `docs/images/`; image references use `![alt](docs/images/file.png)` relative-to-repo (NOT `./file.png`, NOT absolute paths).
- **For KM-Core-scoped PUMLs** (`lib/km-core/docs/puml/`): the placement constraint targets the canonical `docs/puml/` root. The skill's regex MAY false-positive on the alternative location. **Mitigation (encoded in Plan 46-01):** include an `OVERRIDE_CONSTRAINT: documentation-filename-format` annotation with rationale ("KM-Core scope; PUML stays with its source code per submodule-locality principle"). The PNG outputs still land in the canonical `docs/images/` and `docs-content/images/` — only the .puml source location differs.
- **Mandatory pre-PUML step:** every PUML-touching task starts with "invoke documentation-style skill" as its first concrete action. Plans hardcode this as the first sub-step.

## P-7: Threat Model Pattern (low severity, doc-rot dominant)

Phase 46 produces docs only. STRIDE-aligned threats:

| Threat ID | Category | Component | Disposition | Mitigation |
|---|---|---|---|---|
| T-46-DOC-ROT | Information disclosure (stale info misleads contributor) | All 4 READMEs + ONBOARDING.md | mitigate | Acceptance greps verify section presence; cross-ref sweep (Plan 46-06) verifies inbound links resolve |
| T-46-PNG-DRIFT | Tampering (image vs PUML drift) | `docs/images/*.png` vs `docs/puml/*.puml` | mitigate | Wave 0 sanity probe: both PNGs in `docs/images/` and `docs-content/images/` after every render task |
| T-46-BROKEN-XREF | Information disclosure (broken cross-ref strands contributor) | Related Systems section in all 4 READMEs | mitigate | Plan 46-06 final cross-ref sweep with `grep -F` per link |
| T-46-CONSTRAINT-EVASION | Tampering (silent constraint dodge) | PUML placement, documentation-filename-format | mitigate | `OVERRIDE_CONSTRAINT` annotations include rationale; no silent evasions |
| T-46-CLEANUP-AMNESIA | Tampering (tutorial entity pollutes live KG) | ONBOARDING.md Step 7 | mitigate | Cleanup step in `!!! danger` admonition + Plan 46-05 verifier task |

No code-execution surface, no auth/authz changes, no untrusted input handling — STRIDE Spoofing / Repudiation / DoS / Elevation are N/A for Phase 46.

## P-8: Wave Structure (locked by orchestrator)

Per orchestrator's suggested slicing:

- **Wave 1:** Plan 46-01 (README-TEMPLATE.md + KM-Core README + KM-Core PUMLs + KM-Core PNGs). KM-Core is the canonical template anchor + has the heaviest diagram work.
- **Wave 2:** Plans 46-02, 46-03, 46-04 in parallel (A README, B README+AGENTS+PUML, C README in OKM repo). All three depend on the template from Plan 46-01 but have zero file overlap with each other.
- **Wave 3:** Plan 46-05 (ONBOARDING.md). Depends on KM-Core README being current (Plan 46-01) — references the same endpoint/path facts.
- **Wave 4:** Plan 46-06 (cross-reference sweep). Depends on ALL READMEs landing first to verify SC-4.
