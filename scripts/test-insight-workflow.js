#!/usr/bin/env node
/**
 * Test Insight Workflow
 * 
 * End-to-end test of the automated insight extraction system:
 * - Creates test session content
 * - Triggers the insight orchestrator
 * - Verifies knowledge base updates
 * - Checks diagram generation
 */

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { CrossPlatformBridge } from './cross-platform-bridge.js';
import { AutoInsightTrigger } from './auto-insight-trigger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const CODING_ROOT = path.join(__dirname, '..');
const TEST_OUTPUT_DIR = path.join(CODING_ROOT, 'tmp', 'test-insight-workflow');

class InsightWorkflowTester {
  constructor() {
    this.logger = this.createLogger();
    this.testResults = {
      timestamp: new Date().toISOString(),
      tests: [],
      success: 0,
      failed: 0
    };
  }
  
  createLogger() {
    return {
      info: (msg) => console.log(`[${new Date().toISOString()}] TEST INFO: ${msg}`),
      warn: (msg) => console.log(`[${new Date().toISOString()}] TEST WARN: ${msg}`),
      error: (msg) => console.error(`[${new Date().toISOString()}] TEST ERROR: ${msg}`),
      debug: (msg) => {
        if (process.env.DEBUG) {
          console.log(`[${new Date().toISOString()}] TEST DEBUG: ${msg}`);
        }
      }
    };
  }
  
  /**
   * Run all tests
   */
  async runAllTests() {
    this.logger.info('Starting insight workflow tests...');
    
    try {
      // Setup test environment
      await this.setupTestEnvironment();
      
      // Test 1: Basic session analysis
      await this.testBasicSessionAnalysis();
      
      // Test 2: Multi-source analysis
      await this.testMultiSourceAnalysis();
      
      // Test 3: Cross-platform bridge
      await this.testCrossPlatformBridge();
      
      // Test 4: Auto trigger functionality
      await this.testAutoTrigger();
      
      // Test 5: Diagram generation
      await this.testDiagramGeneration();
      
      // Generate test report
      await this.generateTestReport();
      
      this.logger.info(`Tests completed: ${this.testResults.success} passed, ${this.testResults.failed} failed`);
      
      return this.testResults;
      
    } catch (error) {
      this.logger.error(`Test suite failed: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Setup test environment
   */
  async setupTestEnvironment() {
    this.logger.info('Setting up test environment...');
    
    try {
      // Create test output directory
      await fs.mkdir(TEST_OUTPUT_DIR, { recursive: true });
      
      // Create test session file
      await this.createTestSessionFile();
      
      this.addTestResult('Environment Setup', true, 'Test environment created successfully');
    } catch (error) {
      this.addTestResult('Environment Setup', false, error.message);
      throw error;
    }
  }
  
  /**
   * Create test session file
   */
  async createTestSessionFile() {
    const testSessionContent = `# Test Development Session

## Exchange 1

**User:**
I need to implement a Redux pattern for state management in our React application. We're having issues with prop drilling across 15+ components.

**Assistant:**
I'll help you implement a Redux pattern with TypeScript for better state management. Here's the approach:

\`\`\`typescript
// store/index.ts
import { configureStore } from '@reduxjs/toolkit';
import { uiSlice } from './slices/uiSlice';
import { dataSlice } from './slices/dataSlice';

export const store = configureStore({
  reducer: {
    ui: uiSlice.reducer,
    data: dataSlice.reducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
\`\`\`

\`\`\`typescript
// hooks/redux.ts
import { useDispatch, useSelector } from 'react-redux';
import type { RootState, AppDispatch } from '../store';

export const useAppDispatch = useDispatch.withTypes<AppDispatch>();
export const useAppSelector = useSelector.withTypes<RootState>();
\`\`\`

This solution eliminates prop drilling by providing centralized state management with full TypeScript support.

## Exchange 2

**User:**
That looks great! How do we handle async operations like API calls?

**Assistant:**
For async operations, we'll use Redux Toolkit's createAsyncThunk. Here's how to implement it:

\`\`\`typescript
// slices/dataSlice.ts
import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';

export const fetchUserData = createAsyncThunk(
  'data/fetchUserData',
  async (userId: string) => {
    const response = await fetch(\`/api/users/\${userId}\`);
    return response.json();
  }
);

const dataSlice = createSlice({
  name: 'data',
  initialState: {
    users: [],
    loading: false,
    error: null,
  },
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchUserData.pending, (state) => {
        state.loading = true;
      })
      .addCase(fetchUserData.fulfilled, (state, action) => {
        state.loading = false;
        state.users.push(action.payload);
      })
      .addCase(fetchUserData.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message;
      });
  },
});
\`\`\`

This provides a clean way to handle loading states and errors for async operations.

## Summary

- **Problem**: Prop drilling across 15+ React components
- **Solution**: Redux Toolkit with TypeScript integration
- **Technologies**: React, Redux, TypeScript
- **Benefits**: Centralized state, type safety, predictable updates
- **Pattern**: Redux Pattern with async thunk support
`;

    const testSessionPath = path.join(TEST_OUTPUT_DIR, 'test-session.md');
    await fs.writeFile(testSessionPath, testSessionContent);
    
    this.logger.debug(`Created test session file: ${testSessionPath}`);
  }
  
  /**
   * Test basic session analysis
   */
  async testBasicSessionAnalysis() {
    this.logger.info('Testing basic session analysis...');
    
    try {
      const bridge = new CrossPlatformBridge();
      
      const testContent = await fs.readFile(
        path.join(TEST_OUTPUT_DIR, 'test-session.md'), 
        'utf8'
      );
      
      const result = await bridge.extractInsights({
        source: 'manual',
        sessionContent: testContent,
        significance: 8,
        webSearch: false, // Disable for test
        generateDiagrams: true
      });
      
      if (result.message || result.triggered) {
        this.addTestResult('Basic Session Analysis', true, 'Session analysis completed successfully');
      } else {
        this.addTestResult('Basic Session Analysis', false, 'No insights generated');
      }
      
    } catch (error) {
      this.addTestResult('Basic Session Analysis', false, error.message);
    }
  }
  
  /**
   * Test multi-source analysis
   */
  async testMultiSourceAnalysis() {
    this.logger.info('Testing multi-source analysis...');
    
    try {
      // Simulate repository changes
      const mockRepoChanges = {
        commits: [
          { hash: 'abc123', message: 'feat: implement Redux state management' },
          { hash: 'def456', message: 'refactor: update component structure' }
        ],
        filesChanged: [
          'src/store/index.ts',
          'src/hooks/redux.ts',
          'src/slices/dataSlice.ts'
        ]
      };
      
      // Test repository analysis
      const bridge = new CrossPlatformBridge();
      const result = await bridge.extractInsights({
        source: 'claude-code',
        mcpTool: 'analyze_repository',
        significance: 7
      });
      
      this.addTestResult('Multi-Source Analysis', true, 'Repository analysis completed');
      
    } catch (error) {
      this.addTestResult('Multi-Source Analysis', false, error.message);
    }
  }
  
  /**
   * Test cross-platform bridge
   */
  async testCrossPlatformBridge() {
    this.logger.info('Testing cross-platform bridge...');
    
    try {
      const bridge = new CrossPlatformBridge();
      
      // Test different source types
      const testRequests = [
        { source: 'claude-code', mcpTool: 'trigger_analysis' },
        { source: 'manual', action: 'status' },
        { source: 'copilot', vscodeExtension: true, workspace: '/test/workspace' }
      ];
      
      let successCount = 0;
      for (const request of testRequests) {
        try {
          await bridge.extractInsights(request);
          successCount++;
        } catch (error) {
          this.logger.debug(`Bridge test failed for ${request.source}: ${error.message}`);
        }
      }
      
      if (successCount > 0) {
        this.addTestResult('Cross-Platform Bridge', true, `${successCount}/${testRequests.length} sources working`);
      } else {
        this.addTestResult('Cross-Platform Bridge', false, 'No sources working');
      }
      
    } catch (error) {
      this.addTestResult('Cross-Platform Bridge', false, error.message);
    }
  }
  
  /**
   * Test auto trigger functionality
   */
  async testAutoTrigger() {
    this.logger.info('Testing auto trigger functionality...');
    
    try {
      const trigger = new AutoInsightTrigger();
      
      // Test status check
      const status = await trigger.getStatus();
      
      if (status && typeof status === 'object') {
        this.addTestResult('Auto Trigger', true, 'Auto trigger status check working');
      } else {
        this.addTestResult('Auto Trigger', false, 'Invalid status response');
      }
      
    } catch (error) {
      this.addTestResult('Auto Trigger', false, error.message);
    }
  }
  
  /**
   * Test diagram generation
   */
  async testDiagramGeneration() {
    this.logger.info('Testing diagram generation...');
    
    try {
      // Check if diagram files were created
      const pumlDir = path.join(CODING_ROOT, 'knowledge-management', 'insights', 'puml');
      const imagesDir = path.join(CODING_ROOT, 'knowledge-management', 'insights', 'images');
      
      let diagramsFound = 0;
      
      try {
        const pumlFiles = await fs.readdir(pumlDir);
        diagramsFound += pumlFiles.filter(f => f.endsWith('.puml')).length;
      } catch (error) {
        this.logger.debug('PUML directory not found');
      }
      
      try {
        const imageFiles = await fs.readdir(imagesDir);
        diagramsFound += imageFiles.filter(f => f.endsWith('.png')).length;
      } catch (error) {
        this.logger.debug('Images directory not found');
      }
      
      if (diagramsFound > 0) {
        this.addTestResult('Diagram Generation', true, `${diagramsFound} diagram files found`);
      } else {
        this.addTestResult('Diagram Generation', false, 'No diagram files generated');
      }
      
    } catch (error) {
      this.addTestResult('Diagram Generation', false, error.message);
    }
  }
  
  /**
   * Add test result
   */
  addTestResult(testName, success, message) {
    this.testResults.tests.push({
      name: testName,
      success,
      message,
      timestamp: new Date().toISOString()
    });
    
    if (success) {
      this.testResults.success++;
      this.logger.info(`✅ ${testName}: ${message}`);
    } else {
      this.testResults.failed++;
      this.logger.error(`❌ ${testName}: ${message}`);
    }
  }
  
  /**
   * Generate test report
   */
  async generateTestReport() {
    const reportContent = `# Insight Workflow Test Report

**Generated:** ${this.testResults.timestamp}
**Total Tests:** ${this.testResults.tests.length}
**Passed:** ${this.testResults.success}
**Failed:** ${this.testResults.failed}

## Test Results

${this.testResults.tests.map(test => `
### ${test.name}
- **Status:** ${test.success ? '✅ PASSED' : '❌ FAILED'}
- **Message:** ${test.message}
- **Time:** ${test.timestamp}
`).join('')}

## Summary

${this.testResults.failed === 0 
  ? '🎉 All tests passed! The insight workflow system is working correctly.'
  : `⚠️ ${this.testResults.failed} test(s) failed. Review the results above for details.`
}

## Next Steps

${this.testResults.failed === 0 
  ? '- The automated insight extraction system is ready for production use\\n- Consider enabling auto-triggering in your development workflow'
  : '- Fix the failing tests before deploying to production\\n- Check logs for detailed error information'
}
`;

    const reportPath = path.join(TEST_OUTPUT_DIR, 'test-report.md');
    await fs.writeFile(reportPath, reportContent);
    
    this.logger.info(`Test report generated: ${reportPath}`);
  }
}

// CLI interface
if (import.meta.url === `file://${process.argv[1]}`) {
  const tester = new InsightWorkflowTester();
  
  tester.runAllTests().then(results => {
    console.log('\\n📊 Test Summary:');
    console.log(`Total: ${results.tests.length}, Passed: ${results.success}, Failed: ${results.failed}`);
    
    if (results.failed > 0) {
      console.log('\\n❌ Some tests failed. Check the test report for details.');
      process.exit(1);
    } else {
      console.log('\\n✅ All tests passed! The insight workflow system is ready.');
      process.exit(0);
    }
  }).catch(error => {
    console.error('Test suite failed:', error);
    process.exit(1);
  });
}

export { InsightWorkflowTester };