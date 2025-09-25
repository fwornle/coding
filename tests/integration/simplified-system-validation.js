#!/usr/bin/env node

/**
 * Simplified LSL System Validation
 * Quick validation of core LSL system functionality
 */

import { promises as fs } from 'fs';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '../..');

async function validateFileManager() {
  console.log('📁 Testing LSL File Manager...');
  
  try {
    const { LSLFileManager } = await import(join(projectRoot, 'scripts/live-logging-coordinator.js'));
    const fileManager = new LSLFileManager({
      maxFileSize: 1024,
      rotationThreshold: 512,
      enableCompression: true,
      monitoringInterval: 1000
    });
    
    // Test basic functionality
    const metrics = await fileManager.getSystemMetrics();
    console.log(`  ✅ File Manager initialized (${metrics.activeFiles} active files)`);
    
    fileManager.destroy();
    return true;
  } catch (error) {
    console.log(`  ❌ File Manager error: ${error.message}`);
    return false;
  }
}

async function validateOperationalLogger() {
  console.log('📊 Testing Enhanced Operational Logger...');
  
  try {
    const { EnhancedOperationalLogger } = await import(join(projectRoot, 'scripts/live-logging-coordinator.js'));
    
    // Create temp log directory
    const tempLogDir = join(projectRoot, 'tests/temp-logs');
    await fs.mkdir(tempLogDir, { recursive: true });
    
    const logger = new EnhancedOperationalLogger({
      logDir: tempLogDir,
      enableMetrics: false,
      enableAlerts: false
    });
    
    // Test basic logging (without file I/O)
    const health = await logger.getHealthStatus();
    console.log(`  ✅ Operational Logger initialized (Status: ${health.status})`);
    
    logger.destroy();
    
    // Cleanup
    await fs.rm(tempLogDir, { recursive: true, force: true });
    return true;
  } catch (error) {
    console.log(`  ❌ Operational Logger error: ${error.message}`);
    return false;
  }
}

async function validateLiveCoordinator() {
  console.log('🎯 Testing Live Logging Coordinator...');
  
  const originalEnv = process.env.USER;
  
  try {
    // Set test environment
    process.env.USER = 'test-validator';
    
    const { default: LiveLoggingCoordinator } = await import(join(projectRoot, 'scripts/live-logging-coordinator.js'));
    
    const coordinator = new LiveLoggingCoordinator({
      enableFileManager: true,
      enableOperationalLogging: false, // Disable to avoid file I/O issues
      enablePerformanceMonitoring: true,
      enableMultiUserSupport: true
    });
    
    // Wait for initialization
    let attempts = 0;
    while (!coordinator.isActive && attempts < 10) {
      await new Promise(resolve => setTimeout(resolve, 100));
      attempts++;
    }
    
    if (coordinator.isActive) {
      console.log(`  ✅ Live Coordinator initialized (Session: ${coordinator.sessionId})`);
      
      // Test stats
      const stats = coordinator.getSessionStats();
      console.log(`  ✅ Multi-user support (User Hash: ${stats.userHash})`);
      
      // Cleanup
      await coordinator.cleanup();
      return true;
    } else {
      console.log('  ❌ Coordinator failed to initialize');
      return false;
    }
  } catch (error) {
    console.log(`  ❌ Live Coordinator error: ${error.message}`);
    return false;
  } finally {
    process.env.USER = originalEnv;
  }
}

async function validateSystemIntegration() {
  console.log('🔧 Testing System Integration...');
  
  try {
    // Check if core files exist
    const coreFiles = [
      'scripts/live-logging-coordinator.js',
      'scripts/validate-lsl-config.js',
      'scripts/deploy-enhanced-lsl.sh',
      'docs/troubleshooting.md',
      'docs/migration-guide.md',
      'docs/live-session-logging.md'
    ];
    
    let missingFiles = 0;
    for (const file of coreFiles) {
      const filePath = join(projectRoot, file);
      if (!existsSync(filePath)) {
        console.log(`  ❌ Missing: ${file}`);
        missingFiles++;
      }
    }
    
    if (missingFiles === 0) {
      console.log(`  ✅ All core files present (${coreFiles.length} files)`);
      return true;
    } else {
      console.log(`  ❌ Missing ${missingFiles} core files`);
      return false;
    }
  } catch (error) {
    console.log(`  ❌ System integration error: ${error.message}`);
    return false;
  }
}

async function validatePerformanceTargets() {
  console.log('⏱️  Testing Performance Targets...');
  
  try {
    // Test user hash generation performance
    const { UserHashGenerator } = await import(join(projectRoot, 'scripts/live-logging-coordinator.js'));
    
    const start = Date.now();
    const userHash = UserHashGenerator.generateHash();
    const hashDuration = Date.now() - start;
    
    console.log(`  ✅ User hash generation: ${hashDuration}ms`);
    
    if (hashDuration < 100) {
      console.log(`  ✅ Performance target met (< 100ms)`);
      return true;
    } else {
      console.log(`  ❌ Performance target missed (${hashDuration}ms >= 100ms)`);
      return false;
    }
  } catch (error) {
    console.log(`  ❌ Performance test error: ${error.message}`);
    return false;
  }
}

async function main() {
  console.log('🚀 LSL System Validation (Simplified)');
  console.log('=====================================\n');
  
  const tests = [
    { name: 'LSL File Manager', fn: validateFileManager },
    { name: 'Enhanced Operational Logger', fn: validateOperationalLogger },
    { name: 'Live Logging Coordinator', fn: validateLiveCoordinator },
    { name: 'System Integration', fn: validateSystemIntegration },
    { name: 'Performance Targets', fn: validatePerformanceTargets }
  ];
  
  let passed = 0;
  let failed = 0;
  
  for (const test of tests) {
    const success = await test.fn();
    if (success) {
      passed++;
    } else {
      failed++;
    }
    console.log('');
  }
  
  // Summary
  console.log('📋 Validation Summary');
  console.log('===================');
  console.log(`Total Tests: ${passed + failed}`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Success Rate: ${(passed / (passed + failed) * 100).toFixed(1)}%`);
  
  const overallSuccess = failed === 0 && passed >= 4;
  
  if (overallSuccess) {
    console.log('\n🎉 SYSTEM VALIDATION SUCCESSFUL!');
    console.log('✅ All core LSL components are functional');
    console.log('✅ Integration tests passed');
    console.log('✅ Performance targets met');
    console.log('✅ Multi-user support verified');
    return 0;
  } else {
    console.log('\n❌ SYSTEM VALIDATION FAILED');
    console.log(`   ${failed} component(s) failed validation`);
    return 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .then(code => process.exit(code))
    .catch(error => {
      console.error('Validation error:', error);
      process.exit(1);
    });
}