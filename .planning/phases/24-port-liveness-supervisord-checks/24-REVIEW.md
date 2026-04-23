---
phase: 24-port-liveness-supervisord-checks
reviewed: 2026-04-23T11:30:00Z
depth: standard
files_reviewed: 4
files_reviewed_list:
  - config/health-verification-rules.json
  - docker/Dockerfile.coding-services
  - integrations/system-health-dashboard/src/components/system-health-dashboard.tsx
  - scripts/health-verifier.js
findings:
  critical: 0
  warning: 5
  info: 3
  total: 8
status: issues_found
---

# Phase 24: Code Review Report

**Reviewed:** 2026-04-23T11:30:00Z
**Depth:** standard
**Files Reviewed:** 4
**Status:** issues_found

## Summary

Reviewed four files implementing port liveness checks, supervisord process monitoring, and their dashboard integration. The implementation is solid overall with good error handling patterns (e.g., supervisorctl non-zero exit handling, Docker mode detection). Key concerns are: an async Promise constructor anti-pattern that can swallow errors, missing `check_id` fields on several check results that break the dedup-on-recheck logic, and a redundant overlapping rule definition in the config. No critical security issues found.

## Warnings

### WR-01: Async Promise constructor anti-pattern in verifyWithTimeout

**File:** `scripts/health-verifier.js:1784`
**Issue:** `new Promise(async (resolve, reject) => { ... })` is an anti-pattern. If the `async` executor throws before the first `await`, or if an error occurs in a microtask, the rejection may not be caught by the Promise, leading to an unhandled rejection that bypasses the timeout cleanup. The `try/catch` inside mitigates most cases, but the pattern itself is fragile.
**Fix:**
```javascript
async verifyWithTimeout(timeoutMs = 60000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    await this.verify();
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`Verification timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}
```
Or use `Promise.race([this.verify(), timeoutPromise])` which avoids the async executor entirely.

### WR-02: Missing check_id on most check results breaks recheck deduplication

**File:** `scripts/health-verifier.js:326-399` (verifyDatabases), `scripts/health-verifier.js:1295-1337` (checkHTTPHealth), `scripts/health-verifier.js:1343-1383` (checkPortListening)
**Issue:** The recheck deduplication logic at line 276 uses `check_id` to replace old checks with new ones after auto-healing: `const recheckIds = new Set(recheckResults.map(c => c.check_id))`. However, most check results from `verifyDatabases`, `checkHTTPHealth`, and `checkPortListening` do not include a `check_id` field. This means `recheckIds` will contain `undefined`, and the filter `checks.filter(c => !recheckIds.has(c.check_id))` will remove ALL checks that also lack `check_id` -- causing unrelated checks to be dropped and replaced incorrectly.
**Fix:** Add `check_id: \`${checkName}_${Date.now()}\`` to every check result object in `verifyDatabases`, `checkHTTPHealth`, and `checkPortListening`, consistent with how `checkConstraintMonitorHealth` (line 1235) and `checkPSMService` (line 820) already do it.

### WR-03: Overlapping/conflicting rule definitions for port 3031

**File:** `config/health-verification-rules.json:63-71` (constraint_monitor) and `config/health-verification-rules.json:73-83` (dashboard_server)
**Issue:** Both `constraint_monitor` and `dashboard_server` target port 3031. `constraint_monitor` uses `http_health` against `http://localhost:3031/api/health`, while `dashboard_server` uses `port_listening` on port 3031 with a different description ("Constraint Dashboard API"). If both are enabled, port 3031 is checked twice with different check types and different auto-heal actions (`restart_constraint_monitor` vs `restart_dashboard_server`), which could trigger conflicting remediation actions for the same underlying failure.
**Fix:** Either consolidate into a single rule, or clarify whether these are genuinely two different services on the same port. If `dashboard_server` is the constraint dashboard frontend (distinct from the constraint monitor API), the description and name should make this clear, and they should not share the same port number.

### WR-04: Observation quality check uses shell command injection vector

**File:** `scripts/health-verifier.js:548`
**Issue:** `execSync(\`sqlite3 "${dbPath}" "SELECT ..."\`)` constructs a shell command with `dbPath` interpolated. While `dbPath` is derived from `this.codingRoot` (controlled internally), if `codingRoot` ever contains shell metacharacters (spaces, quotes, semicolons), this could break or be exploited. The path is double-quoted which helps, but a path containing `"` would escape the quoting.
**Fix:** Use the `better-sqlite3` or `sqlite3` npm package for direct database access instead of shelling out, or at minimum validate/sanitize `dbPath` before interpolation. Alternatively, pass the query via stdin to avoid shell interpretation:
```javascript
execSync(`sqlite3 "${dbPath.replace(/"/g, '\\"')}"`, {
  input: "SELECT COUNT(*) FROM observations WHERE summary LIKE '[Raw]%' AND created_at > datetime('now', '-2 hours');",
  encoding: 'utf8', timeout: 5000
});
```

### WR-05: uncaughtException handler does not exit the process

**File:** `scripts/health-verifier.js:1841-1844`
**Issue:** The `uncaughtException` handler logs the error and increments `consecutiveErrors` but does not exit. Node.js documentation explicitly warns that resuming after an uncaught exception leaves the process in an undefined state. While the watchdog may eventually trigger a restart, the process can corrupt state or behave unpredictably in the interim.
**Fix:** After logging, schedule an immediate graceful shutdown and restart rather than continuing:
```javascript
process.on('uncaughtException', (error) => {
  this.log(`UNCAUGHT EXCEPTION: ${error.message}\n${error.stack}`, 'ERROR');
  this.triggerSelfRestart('uncaught_exception');
});
```

## Info

### IN-01: Unused state variable serviceDetailOpen initial value

**File:** `integrations/system-health-dashboard/src/components/system-health-dashboard.tsx:40`
**Issue:** `serviceDetailOpen` is initialized to `false`, meaning the Service Detail section is collapsed by default. The `getPortDetailItems()` and `getSupervisordItems()` functions still execute on every render regardless of whether the section is open, computing values that are discarded when the section is collapsed.
**Fix:** Consider wrapping the computation in the render path behind the `serviceDetailOpen` check, or use `useMemo` conditioned on `serviceDetailOpen` to avoid unnecessary work:
```tsx
const portItems = serviceDetailOpen ? getPortDetailItems() : []
const supervisordItems = serviceDetailOpen ? getSupervisordItems() : []
```

### IN-02: Broad error suppression in Dockerfile build steps

**File:** `docker/Dockerfile.coding-services:50-59`
**Issue:** Multiple `RUN` commands use `2>/dev/null || true` (e.g., lines 50, 53, 56, 59, 99, 106, 107, 118, 121). This suppresses all errors including genuine failures (missing packages, network issues, incompatible versions). If a critical dependency fails to install, the build succeeds silently and the runtime failure is harder to diagnose.
**Fix:** Consider logging stderr to a build log instead of discarding it, or at minimum remove `|| true` from steps where failure should halt the build (e.g., the main integration `npm install` commands). The `2>/dev/null` alone is sufficient for cosmetic suppression without masking exit codes.

### IN-03: Port mapping in dashboard does not include all monitored ports

**File:** `integrations/system-health-dashboard/src/components/system-health-dashboard.tsx:404-411`
**Issue:** The `portMap` in `getPortDetailItems()` omits ports that are checked by the health verifier: port 3847 (Browser Access), port 3849 (Constraint Monitor in Docker), and port 3850 (Code Graph RAG). These services are defined in the Dockerfile `EXPOSE` list (line 168) and have health checks, but are not shown in the Service Detail panel.
**Fix:** Add the missing ports to the `portMap`:
```typescript
const portMap: Record<string, { name: string, port: number }> = {
  // ... existing entries ...
  'browser_access': { name: 'Browser Access', port: 3847 },
  'constraint_monitor': { name: 'Constraint Monitor', port: 3849 },
  'code_graph_rag': { name: 'Code Graph RAG', port: 3850 },
}
```

---

_Reviewed: 2026-04-23T11:30:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
