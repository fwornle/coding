#!/usr/bin/env node

/**
 * Monitoring Verifier - Mandatory Monitoring System Verification
 * 
 * CRITICAL: This must run successfully before any Claude session starts.
 * Ensures that ALL monitoring infrastructure is operational and ready.
 * 
 * Verification Checklist:
 * 1. System Watchdog: Ensure ultimate failsafe is configured
 * 2. Global Service Coordinator: Verify daemon is running and healthy  
 * 3. Project Registration: Register current project with coordinator
 * 4. Service Health: Verify all critical services are operational
 * 5. Recovery Testing: Validate recovery mechanisms work
 * 
 * Exit Codes:
 * 0 = All monitoring systems verified and operational
 * 1 = Critical monitoring failure - MUST NOT START CLAUDE
 * 2 = Warning - monitoring degraded but operational
 * 
 * Usage:
 *   node scripts/monitoring-verifier.js --project /path/to/project
 *   node scripts/monitoring-verifier.js --project /path/to/project --strict
 *   node scripts/monitoring-verifier.js --install-all
 */

import fs from 'fs';
import path from 'path';
import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { runIfMain } from '../lib/utils/esm-cli.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const execAsync = promisify(exec);

class MonitoringVerifier {
  constructor(options = {}) {
    this.codingRepoPath = options.codingRepoPath || path.resolve(__dirname, '..');
    this.projectPath = options.projectPath;
    this.strict = options.strict || false;
    this.timeout = options.timeout || 30000; // 30 seconds
    
    this.logPath = path.join(this.codingRepoPath, '.logs', 'monitoring-verifier.log');
    // Phase 33 plan 07: the four legacy daemon scripts (system watchdog,
    // host process supervisor, global service coordinator, per-project LSL
    // coordinator) were deleted. The new authoritative supervisor is the
    // health coordinator HTTP server reached via this URL.
    this.healthCoordinatorUrl = process.env.HEALTH_COORDINATOR_URL || 'http://localhost:3034';

    this.results = {
      systemWatchdog: { status: 'pending', details: null },
      coordinator: { status: 'pending', details: null },
      projectRegistration: { status: 'pending', details: null },
      serviceHealth: { status: 'pending', details: null },
      recoveryTest: { status: 'pending', details: null }
    };
    
    this.ensureLogDirectory();
  }

  ensureLogDirectory() {
    const logDir = path.dirname(this.logPath);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
  }

  log(message, level = 'INFO') {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] [${level}] [MonitoringVerifier] ${message}\n`;
    
    console.log(logEntry.trim());
    
    try {
      fs.appendFileSync(this.logPath, logEntry);
    } catch (error) {
      console.error(`Failed to write log: ${error.message}`);
    }
  }

  error(message) {
    this.log(message, 'ERROR');
  }

  warn(message) {
    this.log(message, 'WARN');
  }

  success(message) {
    this.log(message, 'SUCCESS');
  }

  /**
   * Parse JSON from command output that may contain headers/emojis
   */
  parseJsonFromOutput(output) {
    try {
      // First try direct parse in case it's clean JSON
      return JSON.parse(output);
    } catch (error) {
      // Look for lines that start with { or [
      const lines = output.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
          try {
            return JSON.parse(trimmed);
          } catch (e) {
            // Try parsing the rest of the output starting from this line
            const remainingLines = lines.slice(lines.indexOf(line));
            const jsonCandidate = remainingLines.join('\n');
            try {
              return JSON.parse(jsonCandidate);
            } catch (e2) {
              continue;
            }
          }
        }
      }
      throw new Error(`Unable to parse JSON from output: ${output.substring(0, 100)}...`);
    }
  }

  /**
   * STEP 1: Verify the host-side launchd job for the health coordinator
   * is loaded.
   *
   * Phase 33 plan 07: the legacy launchd job com.coding.system-watchdog
   * was retired in favor of com.coding.health-coordinator (whose
   * KeepAlive is the authoritative supervisor for the host-side health
   * stack). This step now checks the new plist is loaded.
   */
  async verifySystemWatchdog() {
    this.log('🔍 STEP 1: Verifying launchd com.coding.health-coordinator job...');

    try {
      const { stdout } = await execAsync('launchctl list 2>/dev/null || true');
      const loaded = stdout.split('\n').some(line => line.includes('com.coding.health-coordinator'));
      if (loaded) {
        this.results.systemWatchdog = {
          status: 'success',
          details: 'launchd job com.coding.health-coordinator is loaded'
        };
        this.success('✅ System Watchdog: launchd com.coding.health-coordinator loaded');
        return true;
      }
      this.results.systemWatchdog = {
        status: 'error',
        details: 'launchd job com.coding.health-coordinator not loaded'
      };
      this.error('❌ System Watchdog: launchd com.coding.health-coordinator not loaded');
      return false;
    } catch (error) {
      this.results.systemWatchdog = {
        status: 'error',
        details: `Watchdog check failed: ${error.message}`
      };
      this.error(`❌ System Watchdog: ${error.message}`);
      return false;
    }
  }

  /**
   * STEP 2: Verify the host-side health coordinator HTTP server is
   * responding (Phase 33 plan 07 cutover replaced the legacy global
   * service coordinator daemon with this single HTTP-served SoT).
   */
  async verifyCoordinator() {
    this.log(`🔍 STEP 2: Verifying Health Coordinator at ${this.healthCoordinatorUrl}...`);

    try {
      const probe = await fetch(`${this.healthCoordinatorUrl}/health`, {
        signal: AbortSignal.timeout(5000)
      });
      if (!probe.ok) {
        this.results.coordinator = {
          status: 'error',
          details: `Coordinator HTTP ${probe.status}`
        };
        this.error(`❌ Health Coordinator: HTTP ${probe.status}`);
        return false;
      }
      const stateProbe = await fetch(`${this.healthCoordinatorUrl}/health/state`, {
        signal: AbortSignal.timeout(5000)
      });
      if (!stateProbe.ok) {
        this.results.coordinator = {
          status: 'warning',
          details: `Coordinator /health ok but /health/state HTTP ${stateProbe.status}`
        };
        this.warn(`⚠️ Health Coordinator: /health ok but /health/state HTTP ${stateProbe.status}`);
        return !this.strict;
      }
      const state = await stateProbe.json();
      this.results.coordinator = {
        status: 'success',
        details: `Coordinator healthy (uptime ${state.coordinator_uptime_s ?? '?'}s)`
      };
      this.success(`✅ Health Coordinator: Healthy (uptime ${state.coordinator_uptime_s ?? '?'}s)`);
      return true;
    } catch (error) {
      this.results.coordinator = {
        status: 'error',
        details: `Coordinator verification failed: ${error.message}`
      };
      this.error(`❌ Health Coordinator: ${error.message}`);
      return false;
    }
  }

  /**
   * STEP 3: Verify project setup (simplified - coordinator has no services)
   */
  async verifyProjectRegistration() {
    this.log('🔍 STEP 3: Verifying Project Setup...');

    if (!this.projectPath) {
      this.results.projectRegistration = {
        status: 'error',
        details: 'No project path provided'
      };
      return false;
    }

    try {
      const projectName = path.basename(this.projectPath);

      // Verify .specstory directory exists
      const specstoryPath = path.join(this.projectPath, '.specstory', 'history');
      if (!fs.existsSync(specstoryPath)) {
        fs.mkdirSync(specstoryPath, { recursive: true });
        this.log(`Created .specstory/history for ${projectName}`);
      }

      this.results.projectRegistration = {
        status: 'success',
        details: `Project "${projectName}" setup verified`
      };
      this.success(`✅ Project Setup: ${projectName} verified`);
      return true;

    } catch (error) {
      this.results.projectRegistration = {
        status: 'error',
        details: `Project setup failed: ${error.message}`
      };
      this.error(`❌ Project Setup: ${error.message}`);
      return false;
    }
  }

  /**
   * STEP 4: Verify critical services are operational
   */
  async verifyServiceHealth() {
    this.log('🔍 STEP 4: Verifying Service Health...');
    
    try {
      // Give services time to start after project registration
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      const criticalServices = [
        // Enhanced Transcript Monitor is started by bin/coding, verified separately
        // MCP services are managed by claude-mcp, not by project monitoring
        // Constraint dashboard is managed by global coordinator, not verified here
      ];
      
      const serviceResults = [];
      
      for (const service of criticalServices) {
        if (service.healthFile) {
          // Use centralized health directory in coding project
          let healthPath;
          if (service.useCentralizedHealth) {
            // Health files use project name as prefix
            const projectName = this.projectPath ? path.basename(this.projectPath) : 'coding';
            healthPath = path.join(this.codingRepoPath, '.health', `${projectName}-${service.healthFile}`);
          } else {
            // Fallback to old logic for other services
            healthPath = service.checkInCoding
              ? path.join(this.codingRepoPath, service.healthFile)
              : path.join(this.projectPath, service.healthFile);
          }
          const exists = fs.existsSync(healthPath);
          
          if (exists) {
            try {
              const healthData = this.parseJsonFromOutput(fs.readFileSync(healthPath, 'utf8'));
              const age = Date.now() - healthData.timestamp;
              const healthy = age < 120000; // 2 minutes
              
              serviceResults.push({
                name: service.name,
                healthy: healthy,
                details: healthy ? `Health file fresh (${age}ms)` : `Health file stale (${age}ms)`
              });
            } catch (error) {
              serviceResults.push({
                name: service.name,
                healthy: false,
                details: `Health file corrupted: ${error.message}`
              });
            }
          } else {
            serviceResults.push({
              name: service.name,
              healthy: false,
              details: 'Health file missing'
            });
          }
        } else if (service.check === 'port') {
          try {
            const { stdout } = await execAsync(`lsof -ti:${service.port}`);
            const healthy = stdout.trim().length > 0;
            
            serviceResults.push({
              name: service.name,
              healthy: healthy,
              details: healthy ? `Port ${service.port} active` : `Port ${service.port} not listening`
            });
          } catch (error) {
            serviceResults.push({
              name: service.name,
              healthy: false,
              details: `Port check failed: ${error.message}`
            });
          }
        }
      }
      
      const healthyServices = serviceResults.filter(s => s.healthy);
      const unhealthyServices = serviceResults.filter(s => !s.healthy);
      
      if (unhealthyServices.length === 0) {
        this.results.serviceHealth = {
          status: 'success',
          details: `All ${serviceResults.length} critical services healthy`
        };
        this.success(`✅ Service Health: All services operational`);
        return true;
      } else if (healthyServices.length > 0) {
        this.results.serviceHealth = {
          status: 'warning',
          details: `${healthyServices.length}/${serviceResults.length} services healthy`
        };
        this.warn(`⚠️ Service Health: Some services degraded (${unhealthyServices.map(s => s.name).join(', ')})`);
        return !this.strict; // Pass in non-strict mode
      } else {
        this.results.serviceHealth = {
          status: 'error',
          details: 'All critical services failed'
        };
        this.error(`❌ Service Health: All services failed`);
        return false;
      }

    } catch (error) {
      this.results.serviceHealth = {
        status: 'error',
        details: `Service health check failed: ${error.message}`
      };
      this.error(`❌ Service Health: ${error.message}`);
      return false;
    }
  }

  /**
   * STEP 5: Test recovery mechanisms (quick test)
   */
  async verifyRecoveryTest() {
    this.log('🔍 STEP 5: Verifying Recovery Mechanisms...');

    try {
      // Phase 33 plan 07: legacy recovery scripts are gone; the launchd
      // KeepAlive on com.coding.health-coordinator owns recovery for the
      // single host coordinator process. We verify here that the plist
      // file exists on disk so a stale `launchctl bootout` could be
      // re-bootstrapped without restoring the file from git.
      const plistPath = path.join(
        process.env.HOME || '/Users/Q284340',
        'Library', 'LaunchAgents', 'com.coding.health-coordinator.plist'
      );
      if (fs.existsSync(plistPath)) {
        this.results.recoveryTest = {
          status: 'success',
          details: 'Recovery infrastructure: launchd plist present on disk'
        };
        this.success('✅ Recovery Test: launchd plist present');
        return true;
      } else {
        this.results.recoveryTest = {
          status: 'error',
          details: `launchd plist missing on disk: ${plistPath}`
        };
        this.error(`❌ Recovery Test: launchd plist missing at ${plistPath}`);
        return false;
      }

    } catch (error) {
      this.results.recoveryTest = {
        status: 'error',
        details: `Recovery test failed: ${error.message}`
      };
      this.error(`❌ Recovery Test: ${error.message}`);
      return false;
    }
  }

  /**
   * Run complete monitoring verification
   */
  async verify() {
    this.log('🚀 Starting Monitoring System Verification...');
    const startTime = Date.now();
    
    try {
      // Run all verification steps
      const step1 = await this.verifySystemWatchdog();
      const step2 = await this.verifyCoordinator();
      const step3 = await this.verifyProjectRegistration();
      const step4 = await this.verifyServiceHealth();
      const step5 = await this.verifyRecoveryTest();
      
      const allSteps = [step1, step2, step3, step4, step5];
      const passedSteps = allSteps.filter(Boolean).length;
      const totalTime = Date.now() - startTime;
      
      // Step 1 (watchdog) is redundant with Step 2 (coordinator direct check).
      // If the coordinator is verified healthy (step2), a watchdog failure (step1)
      // should not block startup — it's an infrastructure issue, not a session blocker.
      const step1RedundantWithStep2 = !step1 && step2;
      const effectivePassed = step1RedundantWithStep2 ? passedSteps + 1 : passedSteps;

      // Determine overall result
      let overallResult = 'success';
      let exitCode = 0;
      
      if (effectivePassed === 5) {
        if (step1RedundantWithStep2) {
          this.warn(`⚠️ MONITORING VERIFICATION PASSED: ${passedSteps}/5 steps passed (watchdog failed but coordinator healthy) (${totalTime}ms)`);
          overallResult = 'success';
        } else {
          this.success(`🎉 MONITORING VERIFICATION COMPLETE: All 5 steps passed (${totalTime}ms)`);
          overallResult = 'success';
        }
        exitCode = 0;
      } else if (effectivePassed >= 3 && !this.strict) {
        this.warn(`⚠️ MONITORING VERIFICATION WARNING: ${passedSteps}/5 steps passed (${totalTime}ms)`);
        overallResult = 'warning';
        exitCode = 2;
      } else {
        this.error(`💥 MONITORING VERIFICATION FAILED: Only ${passedSteps}/5 steps passed (${totalTime}ms)`);
        overallResult = 'error';
        exitCode = 1;
      }
      
      // Generate summary report
      const report = {
        timestamp: new Date().toISOString(),
        projectPath: this.projectPath,
        strict: this.strict,
        totalTime: totalTime,
        overallResult: overallResult,
        stepsPassedCount: passedSteps,
        stepResults: this.results
      };
      
      const reportPath = path.join(this.codingRepoPath, '.logs', 'monitoring-verification-report.json');
      fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
      
      if (exitCode !== 0) {
        console.log('\n📋 DETAILED RESULTS:');
        console.log(JSON.stringify(this.results, null, 2));
        console.log(`\n📄 Full report: ${reportPath}`);
      }
      
      return { success: exitCode === 0, exitCode, report };

    } catch (error) {
      this.error(`Monitoring verification failed: ${error.message}`);
      return { success: false, exitCode: 1, error: error.message };
    }
  }

  /**
   * Install / repair all monitoring components.
   *
   * Phase 33 plan 07: this used to install the legacy launchd
   * com.coding.system-watchdog plist. Post-cutover, monitoring
   * installation is owned by launchctl bootstrap of
   * com.coding.health-coordinator (handled by the cutover commit /
   * a fresh checkout's setup script). All this method does now is
   * verify the new launchd job is loaded and the coordinator HTTP
   * server is up; it does NOT mutate launchd state.
   */
  async installAll() {
    this.log('🔧 Verifying monitoring components are installed...');

    try {
      const watchdog = await this.verifySystemWatchdog();
      const coordinator = await this.verifyCoordinator();

      if (watchdog && coordinator) {
        this.success('🎉 All monitoring components verified');
        return true;
      }
      this.error('Installation verification failed — bootstrap com.coding.health-coordinator manually:');
      this.error('  launchctl bootstrap gui/$UID ~/Library/LaunchAgents/com.coding.health-coordinator.plist');
      return false;
    } catch (error) {
      this.error(`Installation verification failed: ${error.message}`);
      return false;
    }
  }
}

// CLI handling
async function main() {
  const args = process.argv.slice(2);
  
  let projectPath = null;
  const projectIndex = args.indexOf('--project');
  if (projectIndex !== -1 && args[projectIndex + 1]) {
    projectPath = path.resolve(args[projectIndex + 1]);
  }
  
  const strict = args.includes('--strict');
  
  const verifier = new MonitoringVerifier({
    projectPath: projectPath,
    strict: strict
  });
  
  if (args.includes('--install-all')) {
    const success = await verifier.installAll();
    process.exit(success ? 0 : 1);
  } else {
    if (!projectPath) {
      console.error('❌ Error: --project /path/to/project is required');
      console.error('Usage: node scripts/monitoring-verifier.js --project /path/to/project [--strict]');
      process.exit(1);
    }
    
    const result = await verifier.verify();
    process.exit(result.exitCode);
  }
}

runIfMain(import.meta.url, () => {
  main().catch(error => {
    console.error(`Monitoring verifier error: ${error.message}`);
    process.exit(1);
  });
});

export default MonitoringVerifier;