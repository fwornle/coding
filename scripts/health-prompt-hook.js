#!/usr/bin/env node

/**
 * Health Verification Pre-Prompt Hook
 *
 * Purpose: Ensure system health is verified before every Claude prompt
 * - Checks if health data is stale (> 5 minutes)
 * - Triggers async verification if stale
 * - Provides health status context to Claude
 * - Blocks critical failures
 *
 * Hook Type: UserPromptSubmit
 * Execution: Before every user prompt is processed
 */

import { readFileSync, writeFileSync, existsSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const codingRoot = process.env.CODING_TOOLS_PATH || join(__dirname, '..');

// Configuration
const STALENESS_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
const STATUS_FILE = join(codingRoot, '.health/verification-status.json');
const VERIFIER_SCRIPT = join(codingRoot, 'scripts/health-verifier.js');

/**
 * Main hook execution
 */
async function main() {
    try {
        // Read hook input from stdin
        const input = await readStdin();
        const hookData = JSON.parse(input);

        // Check health status staleness
        const healthStatus = checkHealthStatus();

        // If services aren't available, exit gracefully (running outside coding environment)
        if (!healthStatus.servicesAvailable) {
            // No output needed - just allow Claude to continue normally
            process.exit(0);
        }

        // If stale, trigger async verification (don't wait for it)
        if (healthStatus.isStale) {
            triggerAsyncVerification();
        }

        // Determine if we should block the prompt
        if (healthStatus.shouldBlock) {
            // Block critical failures
            outputBlockedResponse(healthStatus);
            process.exit(0);
        }

        // Normal flow: provide health context to Claude
        outputHealthContext(healthStatus);
        process.exit(0);

    } catch (error) {
        // On any error, don't block Claude - just log and continue
        console.error(`Health hook error: ${error.message}`);
        process.exit(0);
    }
}

/**
 * Check current health status and staleness
 */
function checkHealthStatus() {
    // Check if health verifier exists (indicates we're in coding environment)
    if (!existsSync(VERIFIER_SCRIPT)) {
        return {
            exists: false,
            isStale: false,
            shouldBlock: false,
            servicesAvailable: false,
            message: 'Health services not available (running outside coding environment)',
            ageMs: null
        };
    }

    if (!existsSync(STATUS_FILE)) {
        return {
            exists: false,
            isStale: true,
            shouldBlock: false,
            servicesAvailable: true,
            message: 'Health verification pending (first run)',
            ageMs: null
        };
    }

    const status = JSON.parse(readFileSync(STATUS_FILE, 'utf-8'));
    const stats = statSync(STATUS_FILE);
    const ageMs = Date.now() - new Date(stats.mtime).getTime();
    const isStale = ageMs > STALENESS_THRESHOLD_MS;

    // Block only if critical issues exist and data is recent
    const shouldBlock = !isStale &&
                       status.criticalCount > 0 &&
                       status.overallStatus === 'critical';

    return {
        exists: true,
        isStale,
        shouldBlock,
        servicesAvailable: true,
        status,
        ageMs,
        message: isStale
            ? `Health data stale (${Math.floor(ageMs / 1000)}s old) - refreshing...`
            : `System healthy (verified ${Math.floor(ageMs / 1000)}s ago)`
    };
}

/**
 * Trigger async health verification (non-blocking)
 */
function triggerAsyncVerification() {
    // Only trigger if verifier script exists
    if (!existsSync(VERIFIER_SCRIPT)) {
        return;
    }

    try {
        const child = spawn('node', [VERIFIER_SCRIPT, 'verify'], {
            detached: true,
            stdio: 'ignore',
            cwd: codingRoot,
            env: {
                ...process.env,
                CODING_TOOLS_PATH: codingRoot
            }
        });

        child.unref(); // Allow parent to exit without waiting
    } catch (error) {
        // Fail silently - we're in a degraded environment
    }
}

/**
 * Output blocked response for critical failures
 */
function outputBlockedResponse(healthStatus) {
    const response = {
        decision: 'block',
        reason: `🚨 CRITICAL SYSTEM FAILURE DETECTED\n\n${healthStatus.status.criticalCount} critical issues prevent operation.\n\nRun: node scripts/health-verifier.js --auto-heal`,
        hookSpecificOutput: {
            hookEventName: 'UserPromptSubmit'
        }
    };

    console.log(JSON.stringify(response, null, 2));
}

/**
 * Independent LSL health check — runs regardless of health verifier status.
 * Checks whether the transcript monitor is actively producing session logs.
 * If LSL is down, attempts auto-recovery before reporting.
 * Returns a warning string if LSL is down, empty string if healthy.
 */
function checkLSLHealth() {
    try {
        const healthFile = join(codingRoot, '.health', 'coding-transcript-monitor-health.json');
        const isDown = !existsSync(healthFile);
        let isStopped = false;
        let isStale = false;
        let ageSec = 0;

        if (!isDown) {
            const health = JSON.parse(readFileSync(healthFile, 'utf-8'));
            const ageMs = Date.now() - (health.timestamp || 0);
            ageSec = Math.floor(ageMs / 1000);
            isStopped = health.status === 'stopped';
            isStale = ageMs > 120_000; // 2 minutes
        }

        if (isDown || isStopped || isStale) {
            // Attempt auto-recovery: spawn global-lsl-coordinator in background
            // Rate-limited by a lockfile to prevent spawning on every prompt
            const lockFile = join(codingRoot, '.health', '.lsl-recovery-lock');
            let shouldRecover = true;
            if (existsSync(lockFile)) {
                try {
                    const lockAge = Date.now() - statSync(lockFile).mtimeMs;
                    shouldRecover = lockAge > 60_000; // At most once per minute
                } catch { /* proceed with recovery */ }
            }

            if (shouldRecover) {
                try {
                    // Touch lockfile
                    writeFileSync(lockFile, String(Date.now()));
                    // Fire-and-forget: spawn coordinator to restart monitor
                    const coordinator = spawn('node', [
                        join(codingRoot, 'scripts', 'global-lsl-coordinator.js'),
                        'ensure',
                        codingRoot
                    ], { detached: true, stdio: 'ignore', cwd: codingRoot });
                    coordinator.unref();
                } catch { /* recovery is best-effort */ }

                return '🔴 LSL DOWN: Transcript monitor stopped. Session history is NOT being recorded. Auto-recovery attempted.\n';
            }

            if (isDown) return '🔴 LSL DOWN: No transcript monitor health file found. Session history is NOT being recorded.\n';
            if (isStopped) return '🔴 LSL DOWN: Transcript monitor stopped. Session history is NOT being recorded.\n';
            return `🔴 LSL STALE: Transcript monitor health not updated for ${ageSec}s. LSL may have crashed.\n`;
        }

        return ''; // Healthy
    } catch {
        // If we can't check, don't block — but warn
        return '⚠️ LSL: Unable to verify transcript monitor status\n';
    }
}

/**
 * Output health context for Claude (normal flow)
 * Simplified: no counts, just status. Details on dashboard.
 */
function outputHealthContext(healthStatus) {
    let context = '';

    // Always check LSL independently — this must never be suppressed
    const lslWarning = checkLSLHealth();

    if (healthStatus.isStale) {
        context = `🔄 System Health: Verification triggered (data was stale)\n`;
    } else if (healthStatus.exists && healthStatus.status) {
        const ageSeconds = Math.floor(healthStatus.ageMs / 1000);
        const criticalCount = healthStatus.status.criticalCount || 0;
        const violations = healthStatus.status.violationCount || 0;

        if (violations === 0 && !lslWarning) {
            context = `✅ System Health: All systems operational (verified ${ageSeconds}s ago)\n`;
        } else if (criticalCount > 0) {
            context = `❌ System Health: Critical issues detected - check dashboard\n`;
        } else if (lslWarning) {
            context = lslWarning;
        } else {
            context = `⚠️ System Health: Issues detected - auto-healing active\n`;
        }
    } else {
        context = `🔄 System Health: Initial verification in progress\n`;
    }

    // Output as JSON for structured response
    const response = {
        hookSpecificOutput: {
            hookEventName: 'UserPromptSubmit',
            additionalContext: context
        }
    };

    console.log(JSON.stringify(response, null, 2));
}

/**
 * Read all data from stdin
 */
function readStdin() {
    return new Promise((resolve, reject) => {
        const chunks = [];

        process.stdin.on('data', chunk => chunks.push(chunk));
        process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
        process.stdin.on('error', reject);
    });
}

// Execute
main().catch(error => {
    console.error(`Fatal error in health hook: ${error.message}`);
    process.exit(0); // Don't block Claude on errors
});
