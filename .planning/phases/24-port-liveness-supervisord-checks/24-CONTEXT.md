# Phase 24: Port Liveness & Supervisord Checks - Context

**Gathered:** 2026-04-23
**Status:** Ready for planning

<domain>
## Phase Boundary

The health system detects any crashed service within 60 seconds via port probes and supervisord status reads. This is primarily a **fix and audit** phase — the health verifier (2064 lines, `scripts/health-verifier.js`) already has most check types implemented. The problem is that checks are disabled or missing, not that the infrastructure doesn't exist.

</domain>

<decisions>
## Implementation Decisions

### D-01: Audit-first approach
Systematically audit every rule in `config/health-verification-rules.json` against what actually runs in the coding stack. Fix all gaps in one pass rather than incremental patching.

### D-02: Root causes identified — three specific gaps
1. **Port 3030 (constraint dashboard):** Check explicitly disabled at `health-verifier.js:140-143` with incorrect comment "doesn't exist in Docker." It DOES run in Docker (supervisord manages it). Re-enable.
2. **Port 3848 (semantic analysis SSE):** No check rule exists at all in `health-verification-rules.json`. Add it.
3. **Supervisord status:** Zero integration. The verifier runs alongside supervisord but never calls `supervisorctl status`. FATAL/STOPPED processes go undetected. Add a `supervisord_status` check type.

### D-03: Supervisord integration — report only, no auto-restart
Detect FATAL/STOPPED supervisord processes and report them as critical violations in the health report. Do NOT auto-restart from the health verifier — let supervisord's own `autorestart=true` policy handle restarts. The verifier's job is detection and visibility, not competing with supervisord's restart logic.

### D-04: Dashboard display — add service detail card
Keep existing 5-card grouping (Databases, Services, Processes, API Quota, UKB) with accurate data. Add a new "Service Detail" expandable section showing per-port and per-supervisord-process status. This surfaces the granular information without cluttering the overview.

### D-05: Host vs container check routing
The verifier runs inside Docker. Port checks to `localhost` reach container-internal services (3030, 3032, 3033, 3848, 8080). Port checks to `host.docker.internal` reach host-side services (12435 LLM proxy). PSM checks reach host-side processes (ETM) via shared filesystem. This split is already working for some checks — extend it consistently to all services.

### Claude's Discretion
- How to implement the supervisord status check (exec `supervisorctl status` or use the XML-RPC API)
- Whether to add the new check rules to the existing JSON config or as code-level checks
- Health report format for the new supervisord data

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Health Verifier
- `scripts/health-verifier.js` — Main health verifier (2064 lines). Lines 130-160: Docker mode overrides where checks get disabled. Lines 402-512: service check implementations. Lines 1215+: `checkPortListening()` method.
- `config/health-verification-rules.json` — All check rules (databases, services, processes). The single source of truth for what gets checked.

### Docker Infrastructure
- `docker/supervisord.conf` — 9 managed processes with autorestart. Groups: mcp-servers (priority 100), web-services (priority 50), monitoring (priority 200).
- `docker/docker-compose.yml` — Port mappings, volume mounts, service definitions.

### Dashboard
- `integrations/system-health-dashboard/src/components/health-status-card.tsx` — Health card rendering (129 lines)
- `integrations/system-health-dashboard/src/components/system-health-dashboard.tsx` — Main dashboard with 5-card layout
- `integrations/system-health-dashboard/server.js` — API endpoints: `/api/health-verifier/status`, `/api/health-verifier/report`

### Port Configuration
- `.env.ports` — Full port map for all services

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `health-verifier.js:checkPortListening()` — Already implements TCP port probe with timeout. Reuse for new ports.
- `health-verifier.js:checkHTTPHealth()` — HTTP health check with endpoint URL. Use for services with `/health` endpoints.
- `health-verifier.js:performAutoHealing()` — Auto-heal framework with cooldown, max attempts, backoff. Already works for multiple service types.
- `HealthStatusCard` component — Renders status items with icons, badges, and action buttons. Reuse for new service detail section.

### Established Patterns
- Check rules defined in JSON config → verifier reads and executes → writes report JSON → dashboard API serves → frontend renders
- Docker mode overrides in constructor at lines 130-160 — this is where checks get enabled/disabled per environment
- Auto-heal actions defined as string names → mapped to methods in the verifier

### Integration Points
- New supervisord check would add to the `verifyProcesses()` method (lines 866-928)
- New service rules add to `health-verification-rules.json` services section
- Dashboard API already serves the full report — new checks appear automatically if the report format stays compatible
- New dashboard section would be added to `system-health-dashboard.tsx` alongside existing cards

</code_context>

<specifics>
## Specific Ideas

- The constraint dashboard check was disabled with an incorrect comment. The fix is literally removing 3 lines and updating the comment.
- The semantic analysis SSE server (port 3848) needs a new rule entry matching the pattern of existing service checks.
- For supervisord, `supervisorctl status` returns a simple parseable format: `process_name STATUS pid UPTIME`. The verifier could exec this command every check cycle.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 24-port-liveness-supervisord-checks*
*Context gathered: 2026-04-23*
