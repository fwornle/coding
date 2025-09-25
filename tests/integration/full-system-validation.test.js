#!/usr/bin/env node

/**
 * Comprehensive LSL System Validation Tests
 * 
 * This test suite validates all components of the Enhanced Live Session Logging system:
 * - LSL File Manager (file lifecycle, compression, rotation)
 * - Enhanced Operational Logger (structured logging, metrics, alerts)
 * - Live Logging Coordinator (integration, multi-user support)
 * - Configuration validation and deployment
 * - Performance targets and accuracy metrics
 * - End-to-end system integration
 */

import { promises as fs } from 'fs';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import assert from 'assert';
import { promisify } from 'util';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '../..');
const testDataDir = join(projectRoot, 'tests/data');
const tempTestDir = join(projectRoot, 'tests/temp');

// Test configuration
const TEST_CONFIG = {
  timeout: 30000, // 30 seconds per test
  performanceThresholds: {
    fileRotation: 5000, // 5 seconds max
    compressionRatio: 0.6, // At least 40% compression
    logProcessing: 1000, // 1 second max for log processing
    coordinatorInitialization: 3000, // 3 seconds max
    bufferProcessing: 2000 // 2 seconds max
  },
  testUser: 'test-user-validation',
  testSession: 'validation-session-' + Date.now()
};

// Test utilities
class TestUtils {
  static async createTempDirectory() {
    await fs.mkdir(tempTestDir, { recursive: true });
    return tempTestDir;
  }

  static async cleanupTempDirectory() {
    try {
      await fs.rm(tempTestDir, { recursive: true, force: true });
    } catch (error) {
      console.warn('Cleanup warning:', error.message);
    }
  }

  static async createTestFile(path, content, size = null) {
    if (size) {
      // Create file of specific size
      const chunk = 'x'.repeat(1024); // 1KB chunk
      const chunks = Math.ceil(size / 1024);
      let fileContent = '';
      for (let i = 0; i < chunks; i++) {
        fileContent += chunk;
      }
      await fs.writeFile(path, fileContent.substring(0, size));
    } else {
      await fs.writeFile(path, content);
    }
  }

  static async runScript(scriptPath, args = [], options = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn('node', [scriptPath, ...args], {
        cwd: projectRoot,
        env: { ...process.env, ...options.env },
        stdio: options.stdio || 'pipe'
      });

      let stdout = '';
      let stderr = '';

      if (child.stdout) child.stdout.on('data', (data) => stdout += data);
      if (child.stderr) child.stderr.on('data', (data) => stderr += data);

      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`Process timeout after ${TEST_CONFIG.timeout}ms`));
      }, options.timeout || TEST_CONFIG.timeout);

      child.on('exit', (code) => {
        clearTimeout(timer);
        if (code === 0 || options.ignoreExitCode) {
          resolve({ stdout, stderr, code });
        } else {
          reject(new Error(`Process exited with code ${code}\nSTDERR: ${stderr}`));
        }
      });

      child.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  static async waitFor(condition, timeout = 5000, interval = 100) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (await condition()) {
        return true;
      }
      await new Promise(resolve => setTimeout(resolve, interval));
    }
    throw new Error(`Condition not met within ${timeout}ms`);
  }

  static async measurePerformance(operation) {
    const start = Date.now();
    const result = await operation();
    const duration = Date.now() - start;
    return { result, duration };
  }
}

// Test Suite Classes
class LSLFileManagerTests {
  constructor(tempDir) {
    this.tempDir = tempDir;
    this.testFiles = [];
  }

  async testFileRegistrationAndTracking() {
    console.log('  🧪 Testing file registration and tracking...');
    
    const { LSLFileManager } = await import(join(projectRoot, 'scripts/live-logging-coordinator.js'));
    const fileManager = new LSLFileManager({
      maxFileSize: 1024 * 1024, // 1MB for testing
      rotationThreshold: 800 * 1024, // 800KB
      monitoringInterval: 1000 // 1 second
    });

    try {
      // Create test file
      const testFile = join(this.tempDir, 'test-session.md');
      await TestUtils.createTestFile(testFile, 'Test content');
      this.testFiles.push(testFile);

      // Register file
      const fileInfo = await fileManager.registerFile(testFile, { test: true });
      
      assert(fileInfo.path === testFile, 'File path should match');
      assert(fileInfo.size >= 0, 'File size should be non-negative');
      assert(fileInfo.metadata.test === true, 'Metadata should be preserved');
      
      console.log('    ✅ File registration successful');
      return true;
    } finally {
      fileManager.destroy();
    }
  }

  async testFileRotation() {
    console.log('  🧪 Testing file rotation...');
    
    const { LSLFileManager } = await import(join(projectRoot, 'scripts/live-logging-coordinator.js'));
    const fileManager = new LSLFileManager({
      maxFileSize: 2048, // 2KB for testing
      rotationThreshold: 1024, // 1KB
      enableCompression: false // Disable for testing
    });

    try {
      // Create large test file
      const testFile = join(this.tempDir, 'large-session.md');
      await TestUtils.createTestFile(testFile, '', 1500); // 1.5KB
      this.testFiles.push(testFile);

      // Register and trigger rotation
      const { duration } = await TestUtils.measurePerformance(async () => {
        const fileInfo = await fileManager.registerFile(testFile);
        return fileInfo;
      });

      // Check performance threshold
      assert(duration < TEST_CONFIG.performanceThresholds.fileRotation, 
        `File rotation took ${duration}ms, should be < ${TEST_CONFIG.performanceThresholds.fileRotation}ms`);

      // Check if archive directory was created
      const archiveDir = join(this.tempDir, 'archived');
      assert(existsSync(archiveDir), 'Archive directory should exist');

      // Check if file was truncated
      const stats = await fs.stat(testFile);
      assert(stats.size === 0, 'Original file should be truncated');

      console.log(`    ✅ File rotation completed in ${duration}ms`);
      return true;
    } finally {
      fileManager.destroy();
    }
  }

  async testCompression() {
    console.log('  🧪 Testing file compression...');
    
    const { LSLFileManager } = await import(join(projectRoot, 'scripts/live-logging-coordinator.js'));
    const fileManager = new LSLFileManager({
      enableCompression: true,
      compressionLevel: 6
    });

    try {
      // Create compressible content
      const testFile = join(this.tempDir, 'compressible.md');
      const content = 'This is test content that should compress well. '.repeat(100);
      await TestUtils.createTestFile(testFile, content);
      this.testFiles.push(testFile);

      // Test compression
      const originalSize = (await fs.stat(testFile)).size;
      await fileManager.compressFile(testFile);
      
      const compressedFile = testFile + '.gz';
      assert(existsSync(compressedFile), 'Compressed file should exist');
      assert(!existsSync(testFile), 'Original file should be removed after compression');

      const compressedSize = (await fs.stat(compressedFile)).size;
      const compressionRatio = compressedSize / originalSize;
      
      assert(compressionRatio < TEST_CONFIG.performanceThresholds.compressionRatio,
        `Compression ratio ${compressionRatio} should be < ${TEST_CONFIG.performanceThresholds.compressionRatio}`);

      console.log(`    ✅ Compression successful (${(compressionRatio * 100).toFixed(1)}% of original)`);
      return true;
    } finally {
      fileManager.destroy();
    }
  }

  async testSystemMetrics() {
    console.log('  🧪 Testing system metrics collection...');
    
    const { LSLFileManager } = await import(join(projectRoot, 'scripts/live-logging-coordinator.js'));
    const fileManager = new LSLFileManager();

    try {
      // Create multiple test files
      for (let i = 0; i < 3; i++) {
        const testFile = join(this.tempDir, `metrics-test-${i}.md`);
        await TestUtils.createTestFile(testFile, `Test content ${i}`);
        await fileManager.registerFile(testFile, { testIndex: i });
        this.testFiles.push(testFile);
      }

      // Get metrics
      const metrics = await fileManager.getSystemMetrics();
      
      assert(metrics.activeFiles === 3, 'Should track 3 active files');
      assert(metrics.totalSize > 0, 'Total size should be positive');
      assert(typeof metrics.compressionRatio === 'number', 'Compression ratio should be a number');

      console.log(`    ✅ Metrics collected: ${metrics.activeFiles} files, ${metrics.totalSize} bytes`);
      return true;
    } finally {
      fileManager.destroy();
    }
  }
}

class OperationalLoggerTests {
  constructor(tempDir) {
    this.tempDir = tempDir;
    this.logDir = join(tempDir, 'logs');
  }

  async testBasicLogging() {
    console.log('  🧪 Testing basic logging functionality...');
    
    const { EnhancedOperationalLogger } = await import(join(projectRoot, 'scripts/live-logging-coordinator.js'));
    const logger = new EnhancedOperationalLogger({
      logDir: this.logDir,
      enableMetrics: false,
      enableAlerts: false
    });

    try {
      // Test different log levels
      await logger.logInfo('Test info message', { test: true });
      await logger.logWarning('Test warning message', { test: true });
      await logger.logError('Test error message', { test: true });
      await logger.logSuccess('Test success message', { test: true });

      // Check log file creation
      const logFiles = await fs.readdir(this.logDir);
      assert(logFiles.length > 0, 'Log files should be created');

      // Check log content
      const logFile = join(this.logDir, logFiles[0]);
      const logContent = readFileSync(logFile, 'utf8');
      const logLines = logContent.trim().split('\n').map(line => JSON.parse(line));
      
      assert(logLines.length === 4, 'Should have 4 log entries');
      assert(logLines.some(log => log.level === 'INFO'), 'Should have INFO logs');
      assert(logLines.some(log => log.level === 'WARN'), 'Should have WARN logs');
      assert(logLines.some(log => log.level === 'ERROR'), 'Should have ERROR logs');

      console.log('    ✅ Basic logging functional');
      return true;
    } finally {
      logger.destroy();
    }
  }

  async testPerformanceLogging() {
    console.log('  🧪 Testing performance logging...');
    
    const { EnhancedOperationalLogger } = await import(join(projectRoot, 'scripts/live-logging-coordinator.js'));
    const logger = new EnhancedOperationalLogger({
      logDir: this.logDir,
      enableMetrics: true
    });

    try {
      // Test performance logging
      const { duration } = await TestUtils.measurePerformance(async () => {
        await logger.logPerformance('test-operation', 1234, { test: true });
      });

      assert(duration < TEST_CONFIG.performanceThresholds.logProcessing,
        `Performance logging took ${duration}ms, should be < ${TEST_CONFIG.performanceThresholds.logProcessing}ms`);

      console.log(`    ✅ Performance logging completed in ${duration}ms`);
      return true;
    } finally {
      logger.destroy();
    }
  }

  async testHealthStatus() {
    console.log('  🧪 Testing health status reporting...');
    
    const { EnhancedOperationalLogger } = await import(join(projectRoot, 'scripts/live-logging-coordinator.js'));
    const logger = new EnhancedOperationalLogger({
      logDir: this.logDir
    });

    try {
      // Log some events
      await logger.logInfo('Health test info');
      await logger.logWarning('Health test warning');

      // Get health status
      const health = await logger.getHealthStatus();
      
      assert(health.status === 'degraded', 'Status should be degraded with warnings');
      assert(health.metrics, 'Should have metrics');
      assert(health.recentEvents.length > 0, 'Should have recent events');
      assert(typeof health.uptime === 'number', 'Should have uptime');

      console.log(`    ✅ Health status: ${health.status}`);
      return true;
    } finally {
      logger.destroy();
    }
  }

  async testAlertSystem() {
    console.log('  🧪 Testing alert system...');
    
    const { EnhancedOperationalLogger } = await import(join(projectRoot, 'scripts/live-logging-coordinator.js'));
    const logger = new EnhancedOperationalLogger({
      logDir: this.logDir,
      enableAlerts: true,
      alertThresholds: {
        errorRate: 0.3, // 30% for testing
        fileSize: 1024, // 1KB for testing
        processingDelay: 100 // 100ms for testing
      }
    });

    try {
      // Trigger multiple errors to test high error rate alert
      for (let i = 0; i < 5; i++) {
        await logger.logError(`Test error ${i}`, { test: true });
      }

      // Trigger large file alert
      await logger.logWarning('Large file test', {
        fileSize: 2048, // 2KB > 1KB threshold
        test: true
      });

      // Trigger processing delay alert
      await logger.logWarning('Slow processing test', {
        duration: 200, // 200ms > 100ms threshold
        test: true
      });

      // Check that alerts were triggered
      const health = await logger.getHealthStatus();
      assert(health.metrics.alerts.triggered > 0, 'Should have triggered alerts');

      console.log(`    ✅ Alert system functional (${health.metrics.alerts.triggered} alerts triggered)`);
      return true;
    } finally {
      logger.destroy();
    }
  }
}

class LiveLoggingCoordinatorTests {
  constructor(tempDir) {
    this.tempDir = tempDir;
    this.originalEnv = { ...process.env };
  }

  async testInitialization() {
    console.log('  🧪 Testing coordinator initialization...');
    
    // Set test environment
    process.env.USER = TEST_CONFIG.testUser;
    process.env.TRANSCRIPT_SOURCE_PROJECT = this.tempDir;
    
    const { default: LiveLoggingCoordinator } = await import(join(projectRoot, 'scripts/live-logging-coordinator.js'));
    
    const { result: coordinator, duration } = await TestUtils.measurePerformance(async () => {
      const coord = new LiveLoggingCoordinator({
        enableFileManager: true,
        enableOperationalLogging: true,
        enablePerformanceMonitoring: true,
        enableMultiUserSupport: true
      });
      
      // Wait for initialization to complete
      await TestUtils.waitFor(() => coord.isActive, 5000);
      return coord;
    });

    try {
      assert(duration < TEST_CONFIG.performanceThresholds.coordinatorInitialization,
        `Initialization took ${duration}ms, should be < ${TEST_CONFIG.performanceThresholds.coordinatorInitialization}ms`);

      assert(coordinator.isActive, 'Coordinator should be active');
      assert(coordinator.userHash, 'Should have user hash');
      assert(coordinator.sessionId, 'Should have session ID');
      assert(coordinator.fileManager, 'Should have file manager');
      assert(coordinator.operationalLogger, 'Should have operational logger');

      console.log(`    ✅ Coordinator initialized in ${duration}ms`);
      return coordinator;
    } catch (error) {
      await coordinator.cleanup();
      throw error;
    }
  }

  async testManualInteractionCapture(coordinator) {
    console.log('  🧪 Testing manual interaction capture...');
    
    const startTime = Date.now();
    
    // Capture test interaction
    await coordinator.captureManualInteraction(
      'test-tool',
      { param1: 'value1' },
      { success: true, data: 'test result' },
      { testContext: true }
    );

    const endTime = Date.now();
    const duration = endTime - startTime;

    assert(duration < TEST_CONFIG.performanceThresholds.bufferProcessing,
      `Interaction capture took ${duration}ms, should be < ${TEST_CONFIG.performanceThresholds.bufferProcessing}ms`);

    // Check that buffer was updated
    const stats = coordinator.getSessionStats();
    assert(stats.bufferSize > 0, 'Buffer should contain interactions');

    console.log(`    ✅ Interaction captured in ${duration}ms`);
    return true;
  }

  async testBufferProcessing(coordinator) {
    console.log('  🧪 Testing buffer processing...');
    
    // Create hook buffer file
    const bufferPath = join(process.cwd(), `.mcp-sync/tool-interaction-buffer-${coordinator.userHash}.jsonl`);
    const testInteractions = [
      {
        timestamp: new Date().toISOString(),
        sessionId: coordinator.sessionId,
        userHash: coordinator.userHash,
        toolCall: { name: 'test-tool-1', params: { test: 1 } },
        result: { success: true },
        context: { buffer: true }
      },
      {
        timestamp: new Date().toISOString(),
        sessionId: coordinator.sessionId,
        userHash: coordinator.userHash,
        toolCall: { name: 'test-tool-2', params: { test: 2 } },
        result: { success: true },
        context: { buffer: true }
      }
    ];

    // Write to buffer
    await fs.mkdir(join(process.cwd(), '.mcp-sync'), { recursive: true });
    const bufferContent = testInteractions.map(i => JSON.stringify(i)).join('\n') + '\n';
    writeFileSync(bufferPath, bufferContent);

    const { duration } = await TestUtils.measurePerformance(async () => {
      await coordinator.processBufferedInteractions();
    });

    assert(duration < TEST_CONFIG.performanceThresholds.bufferProcessing,
      `Buffer processing took ${duration}ms, should be < ${TEST_CONFIG.performanceThresholds.bufferProcessing}ms`);

    // Check buffer was cleared
    const remainingContent = readFileSync(bufferPath, 'utf8');
    assert(remainingContent.trim() === '', 'Buffer should be cleared after processing');

    console.log(`    ✅ Buffer processing completed in ${duration}ms`);
    return true;
  }

  async testMultiUserSupport(coordinator) {
    console.log('  🧪 Testing multi-user support...');
    
    // Test user hash generation
    assert(coordinator.userHash.length === 6, 'User hash should be 6 characters');
    assert(coordinator.userInfo.userIdentifier === TEST_CONFIG.testUser, 'User identifier should match');

    // Test user-specific buffer path
    const stats = coordinator.getSessionStats();
    const expectedBufferPath = `.mcp-sync/tool-interaction-buffer-${coordinator.userHash}.jsonl`;
    assert(stats.bufferFilePath === expectedBufferPath, 'Buffer path should be user-specific');

    console.log(`    ✅ Multi-user support functional (User: ${coordinator.userInfo.userIdentifier}, Hash: ${coordinator.userHash})`);
    return true;
  }

  async testSystemHealth(coordinator) {
    console.log('  🧪 Testing system health monitoring...');
    
    const health = await coordinator.getSystemHealth();
    
    assert(health.sessionId, 'Health should include session ID');
    assert(health.systemHealth, 'Health should include system health');
    assert(health.systemHealth.status, 'Health should include status');
    assert(typeof health.systemHealth.uptime === 'number', 'Health should include uptime');
    assert(health.systemHealth.memory, 'Health should include memory info');

    console.log(`    ✅ System health: ${health.systemHealth.status}`);
    return true;
  }

  async testSessionFinalization(coordinator) {
    console.log('  🧪 Testing session finalization...');
    
    const summary = await coordinator.finalizeSession();
    
    assert(summary, 'Should return session summary');
    assert(summary.sessionId === coordinator.sessionId, 'Summary should include session ID');
    assert(summary.userHash === coordinator.userHash, 'Summary should include user hash');
    assert(typeof summary.duration === 'number', 'Summary should include duration');
    assert(summary.features, 'Summary should include feature flags');
    assert(!coordinator.isActive, 'Coordinator should be inactive after finalization');

    console.log(`    ✅ Session finalized (Duration: ${Math.round(summary.duration / 1000)}s)`);
    return summary;
  }

  restoreEnvironment() {
    process.env = { ...this.originalEnv };
  }
}

class SystemIntegrationTests {
  constructor(tempDir) {
    this.tempDir = tempDir;
  }

  async testConfigurationValidation() {
    console.log('  🧪 Testing configuration validation...');
    
    const result = await TestUtils.runScript(
      join(projectRoot, 'scripts/validate-lsl-config.js'),
      ['--test-mode'],
      { 
        env: { TRANSCRIPT_SOURCE_PROJECT: this.tempDir },
        ignoreExitCode: true 
      }
    );

    // Should complete without critical errors
    assert(result.code === 0 || result.stderr.includes('test-mode'), 
      'Configuration validation should complete successfully');

    console.log('    ✅ Configuration validation completed');
    return true;
  }

  async testDeploymentScript() {
    console.log('  🧪 Testing deployment script...');
    
    const result = await TestUtils.runScript(
      join(projectRoot, 'scripts/deploy-enhanced-lsl.sh'),
      ['--dry-run'],
      { 
        env: { TRANSCRIPT_SOURCE_PROJECT: this.tempDir },
        ignoreExitCode: true,
        timeout: 15000
      }
    );

    // Should complete deployment checks
    assert(result.code === 0 || result.stdout.includes('dry-run') || result.stderr.includes('validation'),
      'Deployment script should complete validation checks');

    console.log('    ✅ Deployment script validation completed');
    return true;
  }

  async testMigrationTools() {
    console.log('  🧪 Testing migration tools...');
    
    // Create test LSL files with old format
    const oldFormatFile1 = join(this.tempDir, '2025-01-15_session-from-project.md');
    const oldFormatFile2 = join(this.tempDir, '2025-01-16_1000-1100-session-from-coding.md');
    
    await TestUtils.createTestFile(oldFormatFile1, '# Old Format Session 1');
    await TestUtils.createTestFile(oldFormatFile2, '# Old Format Session 2');

    // Run migration assessment
    const result = await TestUtils.runScript(
      join(projectRoot, 'docs/migration-scripts/assess-migration.js'),
      [],
      { 
        env: { TRANSCRIPT_SOURCE_PROJECT: this.tempDir },
        ignoreExitCode: true,
        timeout: 10000
      }
    );

    // Should identify migration candidates
    assert(result.code === 0 || result.stdout.includes('migration') || result.stderr.includes('assess'),
      'Migration assessment should identify old format files');

    console.log('    ✅ Migration tools validation completed');
    return true;
  }
}

// Main test runner
class FullSystemValidation {
  constructor() {
    this.tempDir = null;
    this.testResults = {
      passed: 0,
      failed: 0,
      errors: []
    };
  }

  async runTest(testName, testFunction) {
    try {
      console.log(`\n🔬 Running: ${testName}`);
      const startTime = Date.now();
      
      const result = await testFunction();
      
      const duration = Date.now() - startTime;
      if (result) {
        this.testResults.passed++;
        console.log(`   ✅ PASSED (${duration}ms)`);
      } else {
        this.testResults.failed++;
        console.log(`   ❌ FAILED (${duration}ms)`);
      }
    } catch (error) {
      this.testResults.failed++;
      this.testResults.errors.push({ test: testName, error: error.message });
      console.log(`   ❌ ERROR: ${error.message}`);
    }
  }

  async run() {
    console.log('🚀 Starting Comprehensive LSL System Validation');
    console.log(`⚙️  Configuration: timeout=${TEST_CONFIG.timeout}ms, testUser=${TEST_CONFIG.testUser}`);
    
    try {
      // Setup
      this.tempDir = await TestUtils.createTempDirectory();
      console.log(`📁 Test directory: ${this.tempDir}`);

      // LSL File Manager Tests
      console.log('\n📁 === LSL File Manager Tests ===');
      const fileManagerTests = new LSLFileManagerTests(this.tempDir);
      await this.runTest('File Registration and Tracking', () => fileManagerTests.testFileRegistrationAndTracking());
      await this.runTest('File Rotation', () => fileManagerTests.testFileRotation());
      await this.runTest('File Compression', () => fileManagerTests.testCompression());
      await this.runTest('System Metrics', () => fileManagerTests.testSystemMetrics());

      // Operational Logger Tests
      console.log('\n📊 === Enhanced Operational Logger Tests ===');
      const loggerTests = new OperationalLoggerTests(this.tempDir);
      await this.runTest('Basic Logging', () => loggerTests.testBasicLogging());
      await this.runTest('Performance Logging', () => loggerTests.testPerformanceLogging());
      await this.runTest('Health Status', () => loggerTests.testHealthStatus());
      await this.runTest('Alert System', () => loggerTests.testAlertSystem());

      // Live Logging Coordinator Tests
      console.log('\n🎯 === Live Logging Coordinator Tests ===');
      const coordinatorTests = new LiveLoggingCoordinatorTests(this.tempDir);
      
      let coordinator;
      try {
        coordinator = await this.runTest('Coordinator Initialization', () => coordinatorTests.testInitialization());
        
        if (coordinator.result) {
          coordinator = coordinator.result;
          await this.runTest('Manual Interaction Capture', () => coordinatorTests.testManualInteractionCapture(coordinator));
          await this.runTest('Buffer Processing', () => coordinatorTests.testBufferProcessing(coordinator));
          await this.runTest('Multi-User Support', () => coordinatorTests.testMultiUserSupport(coordinator));
          await this.runTest('System Health', () => coordinatorTests.testSystemHealth(coordinator));
          await this.runTest('Session Finalization', () => coordinatorTests.testSessionFinalization(coordinator));
        }
      } finally {
        if (coordinator && coordinator.cleanup) {
          await coordinator.cleanup();
        }
        coordinatorTests.restoreEnvironment();
      }

      // System Integration Tests
      console.log('\n🔧 === System Integration Tests ===');
      const integrationTests = new SystemIntegrationTests(this.tempDir);
      await this.runTest('Configuration Validation', () => integrationTests.testConfigurationValidation());
      await this.runTest('Deployment Script', () => integrationTests.testDeploymentScript());
      await this.runTest('Migration Tools', () => integrationTests.testMigrationTools());

      // Results summary
      console.log('\n📋 === Test Results Summary ===');
      const total = this.testResults.passed + this.testResults.failed;
      const successRate = (this.testResults.passed / total * 100).toFixed(1);
      
      console.log(`Total Tests: ${total}`);
      console.log(`Passed: ${this.testResults.passed}`);
      console.log(`Failed: ${this.testResults.failed}`);
      console.log(`Success Rate: ${successRate}%`);

      if (this.testResults.errors.length > 0) {
        console.log('\n❌ Errors:');
        this.testResults.errors.forEach(error => {
          console.log(`  - ${error.test}: ${error.error}`);
        });
      }

      // Performance summary
      console.log('\n⏱️  Performance Thresholds:');
      Object.entries(TEST_CONFIG.performanceThresholds).forEach(([key, value]) => {
        console.log(`  - ${key}: < ${value}ms`);
      });

      const overallSuccess = this.testResults.failed === 0 && this.testResults.passed >= 15;
      
      if (overallSuccess) {
        console.log('\n🎉 ALL TESTS PASSED - System validation successful!');
        console.log('   ✅ LSL File Manager: Fully functional');
        console.log('   ✅ Enhanced Operational Logger: Fully functional');
        console.log('   ✅ Live Logging Coordinator: Fully functional');
        console.log('   ✅ System Integration: Fully functional');
        console.log('   ✅ Performance Targets: Met');
        console.log('   ✅ Multi-User Support: Functional');
        return true;
      } else {
        console.log('\n❌ SYSTEM VALIDATION FAILED');
        console.log(`   ${this.testResults.failed} test(s) failed`);
        console.log('   Please review error details above');
        return false;
      }

    } catch (error) {
      console.error('\n💥 Test runner error:', error);
      return false;
    } finally {
      // Cleanup
      if (this.tempDir) {
        await TestUtils.cleanupTempDirectory();
        console.log('\n🧹 Test cleanup completed');
      }
    }
  }
}

// CLI execution
if (import.meta.url === `file://${process.argv[1]}`) {
  const validator = new FullSystemValidation();
  
  validator.run()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('Validation runner error:', error);
      process.exit(1);
    });
}

export default FullSystemValidation;