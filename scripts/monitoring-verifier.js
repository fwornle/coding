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
    this.systemWatchdogScript = path.join(this.codingRepoPath, 'scripts', 'system-monitor-watchdog.js');
    this.coordinatorScript = path.join(this.codingRepoPath, 'scripts', 'global-service-coordinator.js');
    this.registryPath = path.join(this.codingRepoPath, '.global-service-registry.json');
    
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
   * STEP 1: Verify System Watchdog is configured and operational
   */
  async verifySystemWatchdog() {
    this.log('🔍 STEP 1: Verifying System Watchdog...');
    
    try {
      // Check if watchdog script exists
      if (!fs.existsSync(this.systemWatchdogScript)) {
        this.results.systemWatchdog = {
          status: 'error',
          details: 'System watchdog script not found'
        };
        return false;
      }

      // Run watchdog status check
      const { stdout } = await execAsync(`node "${this.systemWatchdogScript}" --status`);
      const status = this.parseJsonFromOutput(stdout);
      
      if (status.coordinator.alive) {
        this.results.systemWatchdog = {
          status: 'success',
          details: `Coordinator healthy (PID: ${status.coordinator.pid})`
        };
        this.success('✅ System Watchdog: Coordinator verified healthy');
        return true;
      } else {
        // Watchdog detected dead coordinator - trigger recovery
        this.warn('⚠️ System Watchdog: Coordinator dead, triggering recovery...');

        try {
          await execAsync(`node "${this.systemWatchdogScript}"`);
          // If we get here, recovery succeeded (exit code 0)
          this.results.systemWatchdog = {
            status: 'warning',
            details: 'Coordinator was dead but successfully recovered'
          };
          this.success('✅ System Watchdog: Recovery successful');
          return true;
        } catch (recoveryError) {
          // Recovery failed (non-zero exit code)
          this.results.systemWatchdog = {
            status: 'error',
            details: 'Coordinator dead and recovery failed'
          };
          this.error(`❌ System Watchdog: Recovery failed - ${recoveryError.message}`);
          return false;
        }
      }

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
   * STEP 2: Verify Global Service Coordinator is running and healthy
   */
  async verifyCoordinator() {
    this.log('🔍 STEP 2: Verifying Global Service Coordinator...');
    
    try {
      // Check if coordinator script exists
      if (!fs.existsSync(this.coordinatorScript)) {
        this.results.coordinator = {
          status: 'error',
          details: 'Coordinator script not found'
        };
        return false;
      }

      // Check coordinator status
      const { stdout } = await execAsync(`node "${this.coordinatorScript}" --status`);
      const status = this.parseJsonFromOutput(stdout);
      
      if (status.coordinator.healthy && status.coordinator.pid) {
        this.results.coordinator = {
          status: 'success',
          details: `Coordinator running (PID: ${status.coordinator.pid}, uptime: ${status.coordinator.uptime}ms)`
        };
        this.success(`✅ Global Coordinator: Healthy (${status.services} services, ${status.projects} projects)`);
        return true;
      } else {
        // Start coordinator
        this.warn('⚠️ Global Coordinator: Not running, starting daemon...');
        
        const startCommand = `nohup node "${this.coordinatorScript}" --daemon > /dev/null 2>&1 &`;
        await execAsync(startCommand);
        
        // Wait for startup
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // Verify startup
        const { stdout: newStatus } = await execAsync(`node "${this.coordinatorScript}" --status`);
        const verifyStatus = this.parseJsonFromOutput(newStatus);
        
        if (verifyStatus.coordinator.healthy) {
          this.results.coordinator = {
            status: 'warning',
            details: 'Coordinator was not running but successfully started'
          };
          this.success('✅ Global Coordinator: Started successfully');
          return true;
        } else {
          this.results.coordinator = {
            status: 'error',
            details: 'Failed to start coordinator'
          };
          return false;
        }
      }

    } catch (error) {
      this.results.coordinator = {
        status: 'error',
        details: `Coordinator verification failed: ${error.message}`
      };
      this.error(`❌ Global Coordinator: ${error.message}`);
      return false;
    }
  }

  /**
   * STEP 3: Register current project with coordinator
   */
  async verifyProjectRegistration() {
    this.log('🔍 STEP 3: Verifying Project Registration...');
    
    if (!this.projectPath) {
      this.results.projectRegistration = {
        status: 'error',
        details: 'No project path provided'
      };
      return false;
    }

    try {
      const projectName = path.basename(this.projectPath);
      
      // Register project with coordinator
      await execAsync(`node "${this.coordinatorScript}" --register-project "${this.projectPath}"`);
      
      // Verify registration
      const { stdout } = await execAsync(`node "${this.coordinatorScript}" --status`);
      const status = this.parseJsonFromOutput(stdout);
      
      const projectRegistered = status.registry.projects[projectName];
      if (projectRegistered) {
        this.results.projectRegistration = {
          status: 'success',
          details: `Project "${projectName}" registered with coordinator`
        };
        this.success(`✅ Project Registration: ${projectName} registered`);
        return true;
      } else {
        this.results.projectRegistration = {
          status: 'error',
          details: 'Project registration failed'
        };
        return false;
      }

    } catch (error) {
      this.results.projectRegistration = {
        status: 'error',
        details: `Project registration failed: ${error.message}`
      };
      this.error(`❌ Project Registration: ${error.message}`);
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
        { name: 'Enhanced Transcript Monitor', healthFile: 'transcript-monitor-health.json', useCentralizedHealth: true }
        // MCP services are managed by claude-mcp, not by project monitoring
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
      // For now, just verify that the recovery infrastructure exists
      const recoveryComponents = [
        this.systemWatchdogScript,
        this.coordinatorScript,
        this.registryPath
      ];
      
      const missingComponents = recoveryComponents.filter(component => !fs.existsSync(component));
      
      if (missingComponents.length === 0) {
        this.results.recoveryTest = {
          status: 'success',
          details: 'All recovery components present'
        };
        this.success('✅ Recovery Test: All components verified');
        return true;
      } else {
        this.results.recoveryTest = {
          status: 'error',
          details: `Missing components: ${missingComponents.join(', ')}`
        };
        this.error(`❌ Recovery Test: Missing ${missingComponents.length} components`);
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
      
      // Determine overall result
      let overallResult = 'success';
      let exitCode = 0;
      
      if (passedSteps === 5) {
        this.success(`🎉 MONITORING VERIFICATION COMPLETE: All 5 steps passed (${totalTime}ms)`);
        overallResult = 'success';
        exitCode = 0;
      } else if (passedSteps >= 3 && !this.strict) {
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
   * Install all monitoring components
   */
  async installAll() {
    this.log('🔧 Installing all monitoring components...');
    
    try {
      // Install system watchdog
      await execAsync(`node "${this.systemWatchdogScript}" --install-launchd`);
      this.success('✅ System watchdog launchd configuration installed');
      
      // Start coordinator if not running
      await this.verifyCoordinator();
      
      this.success('🎉 All monitoring components installed and configured');
      return true;
      
    } catch (error) {
      this.error(`Installation failed: ${error.message}`);
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

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error(`Monitoring verifier error: ${error.message}`);
    process.exit(1);
  });
}

export default MonitoringVerifier;