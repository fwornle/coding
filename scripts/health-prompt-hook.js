#!/usr/bin/env node

/**
 * Health Verification Pre-Prompt Hook (Phase 33-05)
 *
 * Purpose: Provide a one-line system-health summary to Claude before every
 * user prompt is processed. Reads the canonical SoT from the host
 * health-coordinator (`/health/state`) — never from `.health/*.json` files.
 *
 * Hook Type: UserPromptSubmit
 * Execution: Before every user prompt is processed.
 *
 * Phase 33 contract:
 *   - SPEC R6: never silently treat exceptions as 'healthy'. Coordinator
 *     unreachable / HTTP error / JSON parse error / unknown shape ALL
 *     surface as `overallStatus: 'unknown'`.
 *   - SPEC R8: output JSON shape preserved —
 *       { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext } }
 *   - Q3 carve-out: when invoked outside the coding repo (heuristic:
 *     scripts/health-verifier.js does not exist next to this script),
 *     return the same SPEC-R8 envelope with `additionalContext: ''` and
 *     exit 0. SPEC R6's no-fallback-to-healthy applies to coordinator-side
 *     checks, not to this consumer-side env-detection branch.
 *
 * The hook MUST always `process.exit(0)` so Claude never blocks on errors.
 */

import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const codingRoot = process.env.CODING_TOOLS_PATH || join(__dirname, '..');

// Verifier script is the heuristic for "running inside the coding repo".
// We do NOT spawn it (legacy behaviour); we only check existence so the
// out-of-coding-env graceful no-op branch (Q3) still fires.
const VERIFIER_SCRIPT = join(codingRoot, 'scripts/health-verifier.js');

/**
 * Main hook execution. Always exits 0 so Claude never blocks.
 */
async function main() {
    try {
        const input = await readStdin();
        const hookData = input ? JSON.parse(input) : {};

        const healthStatus = await checkHealthStatus();

        // Q3: outside coding repo — emit empty additionalContext, exit 0.
        if (!healthStatus.servicesAvailable) {
            outputEnvelope('');
            process.exit(0);
        }

        outputHealthContext(healthStatus, hookData);
        process.exit(0);
    } catch (error) {
        // SPEC R8: preserve envelope shape even on fatal errors so Claude
        // sees a well-formed hook response. Hooks must never block.
        process.stderr.write(`Health hook error: ${error.message}\n`);
        try { outputEnvelope(''); } catch { /* last-ditch */ }
        process.exit(0);
    }
}

/**
 * Single coordinator fetch — the only data source for this hook (Phase 33).
 *
 * Returns one of these shapes (always):
 *   { servicesAvailable: false, exists: false, isStale: false,
 *     shouldBlock: false, status: null }
 *     -> Q3 carve-out: outside coding repo. Hook emits empty
 *        additionalContext.
 *
 *   { servicesAvailable: true, exists: true, isStale: false,
 *     shouldBlock: false, status: { overallStatus: 'healthy' | 'unhealthy' | 'unknown', ... } }
 *     -> Inside coding repo. Coordinator reachable or surfacing 'unknown'.
 */
async function checkHealthStatus() {
    // Q3 carve-out: outside the coding repo. Maintain the existing graceful
    // no-op branch — SPEC R6's no-fallback-to-healthy applies to
    // coordinator-side checks, not to this consumer-side env-detection.
    if (!existsSync(VERIFIER_SCRIPT)) {
        return {
            servicesAvailable: false,
            exists: false,
            isStale: false,
            shouldBlock: false,
            status: null
        };
    }

    const coordinator = process.env.HEALTH_COORDINATOR_URL || 'http://localhost:3034';
    try {
        const r = await fetch(`${coordinator}/health/state`);
        if (!r.ok) {
            return {
                servicesAvailable: true,
                exists: true,
                isStale: false,
                shouldBlock: false,
                status: { overallStatus: 'unknown', upstream: `http_${r.status}` }
            };
        }
        const state = await r.json();
        return {
            servicesAvailable: true,
            exists: true,
            isStale: false,
            shouldBlock: false,
            status: deriveSummary(state)
        };
    } catch (err) {
        // SPEC R6: NOT 'healthy' on exception. Surface 'unknown'.
        return {
            servicesAvailable: true,
            exists: true,
            isStale: false,
            shouldBlock: false,
            status: { overallStatus: 'unknown', upstream: 'unreachable', error: err.message }
        };
    }
}

/**
 * Reduce coordinator state to the prompt-hook's summary shape. Only
 * extracts known fields and converts each to a fixed-format string —
 * no unsanitised passthrough (T-33-05-02 mitigation).
 */
function deriveSummary(state) {
    const issues = [];
    if (state && state.container && state.container.healthcheck === 'unhealthy') {
        issues.push('container unhealthy');
    }
    if (state && state.databases && state.databases.status && state.databases.status !== 'healthy') {
        issues.push(`db ${state.databases.status}`);
    }
    if (state && Array.isArray(state.services)) {
        for (const svc of state.services) {
            if (svc && svc.status && svc.status !== 'running') {
                issues.push(`service ${svc.name} ${svc.status}`);
            }
        }
    }
    if (state && state.lsl_by_project && typeof state.lsl_by_project === 'object') {
        for (const [project, status] of Object.entries(state.lsl_by_project)) {
            if (status !== 'healthy') {
                issues.push(`LSL ${project} ${status}`);
            }
        }
    }
    return {
        overallStatus: issues.length === 0 ? 'healthy' : 'unhealthy',
        issues,
        generated_at: state && state.generated_at
    };
}

/**
 * Output the SPEC R8 envelope:
 *   { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext } }
 */
function outputEnvelope(additionalContext) {
    const response = {
        hookSpecificOutput: {
            hookEventName: 'UserPromptSubmit',
            additionalContext: typeof additionalContext === 'string' ? additionalContext : ''
        }
    };
    process.stdout.write(JSON.stringify(response, null, 2));
    process.stdout.write('\n');
}

/**
 * Output health context for Claude (normal flow). Preserves SPEC R8 shape;
 * only the additionalContext STRING content varies.
 */
function outputHealthContext(healthStatus /*, hookData */) {
    let context = '';
    const status = healthStatus.status;

    if (!status) {
        context = '';
    } else if (status.overallStatus === 'unknown') {
        const reason = status.upstream || 'unknown';
        context = `⚪ System Health: unknown (${reason})\n`;
    } else if (status.overallStatus === 'unhealthy') {
        const issues = Array.isArray(status.issues) ? status.issues : [];
        const summary = issues.length ? issues.slice(0, 3).join(', ') : 'see dashboard';
        context = `⚠️ System Health: ${summary}\n`;
    } else {
        context = '✅ System Health: All systems operational\n';
    }

    outputEnvelope(context);
}

/**
 * Read all data from stdin.
 */
function readStdin() {
    return new Promise((resolve, reject) => {
        const chunks = [];
        // If stdin is a TTY (e.g. invoked manually with no pipe), resolve immediately.
        if (process.stdin.isTTY) {
            resolve('');
            return;
        }
        process.stdin.on('data', chunk => chunks.push(chunk));
        process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
        process.stdin.on('error', reject);
    });
}

// Execute
main().catch(error => {
    process.stderr.write(`Fatal error in health hook: ${error.message}\n`);
    try { outputEnvelope(''); } catch { /* last-ditch */ }
    process.exit(0);
});
