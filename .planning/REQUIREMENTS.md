# Requirements: Coding Project — Service Reliability

**Defined:** 2026-04-23
**Core Value:** If any service in the coding stack dies, the health system detects it within 60 seconds, shows it as unhealthy, and attempts auto-healing.

## v5.0 Requirements

Requirements for service reliability milestone. Each maps to roadmap phases.

### Port Liveness

- [ ] **PORT-01**: Health verifier checks all expected ports (3030, 3032, 3033, 3848, 8080, 12435) and reports unreachable ones as failures
- [ ] **PORT-02**: Port check runs every 30 seconds with configurable timeout
- [ ] **PORT-03**: Dashboard health card shows per-port status (green/red) with last-checked timestamp
- [ ] **PORT-04**: Auto-restart triggered when a port is unreachable for 2 consecutive checks

### Supervisord Integration

- [ ] **SUPV-01**: Health verifier reads supervisord process status from inside the container
- [ ] **SUPV-02**: FATAL or STOPPED processes are reported as critical health violations
- [ ] **SUPV-03**: Auto-restart attempted for FATAL processes via supervisord API
- [ ] **SUPV-04**: Dashboard shows supervisord process list with status (RUNNING/FATAL/STOPPED)

### Database Health

- [ ] **DBHL-01**: SQLite integrity check runs periodically (PRAGMA integrity_check) and reports corruption
- [ ] **DBHL-02**: Malformed JSON rows in observations DB detected and reported
- [ ] **DBHL-03**: Auto-repair available: dump valid data, rebuild DB, restore (with user confirmation via dashboard)
- [ ] **DBHL-04**: WAL checkpoint management prevents unbounded WAL growth

### Process Lifecycle

- [ ] **PROC-01**: Stale PID files detected — PID gone but status file says "running"
- [ ] **PROC-02**: Host-side processes monitored (ETM, LLM proxy) with health checks
- [ ] **PROC-03**: PSM (Process Supervisor Manager) coverage extended to all host-side services
- [ ] **PROC-04**: Status file staleness check — if last_updated > 5 minutes and process not running, flag as stale

### Dashboard Accuracy

- [ ] **DASH-01**: Health status on dashboard reflects actual service state — no false greens
- [ ] **DASH-02**: Statusline hook reports accurate health (matches dashboard)
- [ ] **DASH-03**: Per-service health cards on dashboard with failure reason and last-seen timestamp
- [ ] **DASH-04**: Failure history timeline — when services went down and came back

### Insight Validation

- [ ] **IVAL-01**: Validate button on each insight card triggers codebase verification
- [ ] **IVAL-02**: Validator extracts file paths and function names from insight text and checks they exist
- [ ] **IVAL-03**: Stale claims flagged with specific details (file moved, function renamed, etc.)
- [ ] **IVAL-04**: Validation results shown inline on insight card (verified/stale/unknown per claim)

## v6.0 Requirements

Deferred to future release.

### Advanced Monitoring

- **ADVM-01**: Metrics collection (uptime percentage, MTTR per service)
- **ADVM-02**: Alert channels (Slack, email) for critical failures
- **ADVM-03**: Dependency graph — which services depend on which, cascade failure prediction

## Out of Scope

| Feature | Reason |
|---------|--------|
| External monitoring (Datadog, Grafana Cloud) | Overkill for local dev environment |
| Multi-machine monitoring | Single-machine setup only |
| Custom alerting rules UI | Fixed thresholds sufficient for v5.0 |
| Load testing / performance monitoring | Not a reliability concern |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| PORT-01 | TBD | Pending |
| PORT-02 | TBD | Pending |
| PORT-03 | TBD | Pending |
| PORT-04 | TBD | Pending |
| SUPV-01 | TBD | Pending |
| SUPV-02 | TBD | Pending |
| SUPV-03 | TBD | Pending |
| SUPV-04 | TBD | Pending |
| DBHL-01 | TBD | Pending |
| DBHL-02 | TBD | Pending |
| DBHL-03 | TBD | Pending |
| DBHL-04 | TBD | Pending |
| PROC-01 | TBD | Pending |
| PROC-02 | TBD | Pending |
| PROC-03 | TBD | Pending |
| PROC-04 | TBD | Pending |
| DASH-01 | TBD | Pending |
| DASH-02 | TBD | Pending |
| DASH-03 | TBD | Pending |
| DASH-04 | TBD | Pending |
| IVAL-01 | TBD | Pending |
| IVAL-02 | TBD | Pending |
| IVAL-03 | TBD | Pending |
| IVAL-04 | TBD | Pending |

**Coverage:**
- v5.0 requirements: 24 total
- Mapped to phases: 0
- Unmapped: 24

---
*Requirements defined: 2026-04-23*
*Last updated: 2026-04-23 after initial definition*
