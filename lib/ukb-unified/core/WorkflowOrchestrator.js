/**
 * WorkflowOrchestrator - Abstraction layer for MCP semantic-analysis workflows
 *
 * Decouples UKB from MCP implementation details by providing a clean interface
 * for executing workflows via the mcp-server-semantic-analysis.
 *
 * This allows us to:
 * - Easily swap MCP implementations
 * - Test workflow logic without MCP server
 * - Handle retries and error recovery
 * - Transform MCP results into UKB-compatible format
 */

export class WorkflowOrchestrator {
  constructor(config, options = {}) {
    this.config = config;
    this.debug = options.debug || false;
    this.mcpToolsAvailable = this.checkMCPToolsAvailability();
  }

  /**
   * Check if MCP tools are available (running in Claude Code with MCP server)
   */
  checkMCPToolsAvailability() {
    // In Claude Code environment, MCP tools will be available as global functions
    // Check if the main workflow execution tool is available
    return typeof mcp__semantic_analysis__execute_workflow === 'function' &&
           typeof mcp__semantic_analysis__test_connection === 'function';
  }

  /**
   * Execute incremental workflow (DEFAULT for `ukb` command)
   * Analyzes only the gap since last checkpoint
   */
  async executeIncrementalWorkflow(scope, options = {}) {
    this.log('Executing incremental-update workflow...');

    if (!this.mcpToolsAvailable) {
      return this.mockIncrementalWorkflow(scope, options);
    }

    const workflowParams = {
      workflow_name: 'incremental-analysis',
      parameters: {
        repository: scope.codingRepo || process.cwd(),
        sinceCommit: scope.sinceCommit,
        sinceTimestamp: scope.sinceTimestamp?.toISOString(),
        commits: scope.commits.map(c => c.sha),
        sessions: scope.sessions.map(s => s.path),
        maxCommits: options.maxCommits || 100,
        maxSessions: options.maxSessions || 50,
        significanceThreshold: options.significanceThreshold || 5
      }
    };

    try {
      const result = await this.callMCPWorkflow(workflowParams);
      return this.transformWorkflowResult(result, 'incremental-update');

    } catch (error) {
      this.log(`Error executing workflow: ${error.message}`);
      throw new Error(`Workflow execution failed: ${error.message}`);
    }
  }

  /**
   * Execute full analysis workflow (for --full flag or first run)
   */
  async executeFullWorkflow(options = {}) {
    this.log('Executing complete-analysis workflow...');

    if (!this.mcpToolsAvailable) {
      return this.mockFullWorkflow(options);
    }

    const workflowParams = {
      workflow_name: 'complete-analysis',
      parameters: {
        repository: options.repository || process.cwd(),
        depth: options.depth || 200,
        daysBack: options.daysBack || 90,
        includeGit: options.includeGit !== false,
        includeVibe: options.includeVibe !== false,
        includeWeb: options.includeWeb || false,
        significanceThreshold: options.significanceThreshold || 6
      }
    };

    try {
      const result = await this.callMCPWorkflow(workflowParams);
      return this.transformWorkflowResult(result, 'complete-analysis');

    } catch (error) {
      this.log(`Error executing workflow: ${error.message}`);
      throw new Error(`Workflow execution failed: ${error.message}`);
    }
  }

  /**
   * Execute specific workflow by name
   */
  async executeWorkflow(workflowName, parameters = {}) {
    this.log(`Executing ${workflowName} workflow...`);

    if (!this.mcpToolsAvailable) {
      return this.mockWorkflow(workflowName, parameters);
    }

    const workflowParams = {
      workflow_name: workflowName,
      parameters
    };

    try {
      const result = await this.callMCPWorkflow(workflowParams);
      return this.transformWorkflowResult(result, workflowName);

    } catch (error) {
      this.log(`Error executing workflow: ${error.message}`);
      throw new Error(`Workflow execution failed: ${error.message}`);
    }
  }

  /**
   * Call MCP semantic-analysis workflow tool
   * This is where we actually invoke the MCP tool
   */
  async callMCPWorkflow(params) {
    // Verify MCP tools are available
    if (!this.mcpToolsAvailable) {
      throw new Error('MCP tools not available - this must be run within Claude Code with semantic-analysis MCP server configured');
    }

    this.log(`Calling MCP workflow: ${params.workflow_name}`);

    try {
      // Call the MCP semantic-analysis execute_workflow tool
      const result = await mcp__semantic_analysis__execute_workflow({
        workflow_name: params.workflow_name,
        parameters: params.parameters
      });

      this.log(`MCP workflow completed: ${result.success ? 'SUCCESS' : 'FAILED'}`);

      return result;
    } catch (error) {
      this.log(`MCP workflow error: ${error.message}`);
      throw new Error(`MCP workflow execution failed: ${error.message}`);
    }
  }

  /**
   * Test MCP connection health
   * Verifies that the semantic-analysis MCP server is reachable and responding
   */
  async testMCPConnection() {
    if (!this.mcpToolsAvailable) {
      return {
        available: false,
        message: 'MCP tools not available - not running in Claude Code environment'
      };
    }

    try {
      this.log('Testing MCP connection...');
      await mcp__semantic_analysis__test_connection();

      this.log('MCP connection test successful');
      return {
        available: true,
        message: 'MCP semantic-analysis server is available and responding'
      };
    } catch (error) {
      this.log(`MCP connection test failed: ${error.message}`);
      return {
        available: false,
        message: `MCP connection failed: ${error.message}`
      };
    }
  }

  /**
   * Transform MCP workflow result into UKB-compatible format
   */
  transformWorkflowResult(mcpResult, workflowType) {
    // Extract relevant data from MCP result
    // MCP result structure (expected):
    // {
    //   success: true,
    //   workflow: 'incremental-analysis',
    //   results: {
    //     entitiesCreated: 15,
    //     relationsCreated: 42,
    //     insightsGenerated: 8,
    //     ...
    //   },
    //   metadata: { ... }
    // }

    return {
      success: mcpResult.success,
      workflowType,
      stats: {
        entitiesCreated: mcpResult.results?.entitiesCreated || 0,
        relationsCreated: mcpResult.results?.relationsCreated || 0,
        insightsGenerated: mcpResult.results?.insightsGenerated || 0,
        commitsAnalyzed: mcpResult.results?.commitsAnalyzed || 0,
        sessionsAnalyzed: mcpResult.results?.sessionsAnalyzed || 0,
        duration: mcpResult.metadata?.duration || 0
      },
      lastCommit: mcpResult.metadata?.lastCommit,
      lastSession: mcpResult.metadata?.lastSession,
      details: mcpResult.results
    };
  }

  /**
   * Mock incremental workflow (for testing without MCP)
   */
  async mockIncrementalWorkflow(scope, options) {
    this.log('[MOCK] Simulating incremental workflow...');

    // Simulate processing time
    await this.delay(2000);

    const commitsAnalyzed = scope.commits.length;
    const sessionsAnalyzed = scope.sessions.length;

    return {
      success: true,
      workflowType: 'incremental-update',
      stats: {
        entitiesCreated: Math.floor(commitsAnalyzed * 2.5 + sessionsAnalyzed * 3),
        relationsCreated: Math.floor(commitsAnalyzed * 6 + sessionsAnalyzed * 8),
        insightsGenerated: Math.floor((commitsAnalyzed + sessionsAnalyzed) * 0.8),
        commitsAnalyzed,
        sessionsAnalyzed,
        duration: 2000
      },
      lastCommit: scope.commits[scope.commits.length - 1]?.sha || null,
      lastSession: scope.sessions[scope.sessions.length - 1]?.filename || null,
      details: {
        mock: true,
        message: 'This is a mock result - MCP semantic-analysis server not available'
      }
    };
  }

  /**
   * Mock full workflow (for testing without MCP)
   */
  async mockFullWorkflow(options) {
    this.log('[MOCK] Simulating complete-analysis workflow...');

    // Simulate processing time
    await this.delay(5000);

    return {
      success: true,
      workflowType: 'complete-analysis',
      stats: {
        entitiesCreated: 150,
        relationsCreated: 420,
        insightsGenerated: 80,
        commitsAnalyzed: 200,
        sessionsAnalyzed: 50,
        duration: 5000
      },
      lastCommit: 'mock-commit-sha',
      lastSession: 'mock-session-file.md',
      details: {
        mock: true,
        message: 'This is a mock result - MCP semantic-analysis server not available'
      }
    };
  }

  /**
   * Mock generic workflow
   */
  async mockWorkflow(workflowName, parameters) {
    this.log(`[MOCK] Simulating ${workflowName} workflow...`);

    await this.delay(3000);

    return {
      success: true,
      workflowType: workflowName,
      stats: {
        entitiesCreated: 50,
        relationsCreated: 120,
        insightsGenerated: 20,
        commitsAnalyzed: 0,
        sessionsAnalyzed: 0,
        duration: 3000
      },
      details: {
        mock: true,
        message: `Mock result for ${workflowName} workflow`
      }
    };
  }

  /**
   * List available workflows
   */
  async listAvailableWorkflows() {
    return [
      {
        name: 'incremental-update',
        description: 'Analyze gap since last checkpoint (DEFAULT)',
        parameters: ['sinceCommit', 'sinceTimestamp', 'commits', 'sessions']
      },
      {
        name: 'complete-analysis',
        description: 'Full repository analysis',
        parameters: ['depth', 'daysBack', 'includeGit', 'includeVibe', 'includeWeb']
      },
      {
        name: 'pattern-extraction',
        description: 'Focus on extracting reusable patterns',
        parameters: ['focusAreas', 'significanceThreshold']
      },
      {
        name: 'git-only',
        description: 'Analyze git history only',
        parameters: ['depth', 'sinceCommit']
      },
      {
        name: 'vibe-only',
        description: 'Analyze session logs only',
        parameters: ['daysBack', 'sessions']
      }
    ];
  }

  /**
   * Get workflow status (for long-running workflows)
   */
  async getWorkflowStatus(workflowId) {
    // TODO: Implement workflow status checking via MCP
    return {
      id: workflowId,
      status: 'unknown',
      message: 'Workflow status tracking not yet implemented'
    };
  }

  /**
   * Validate workflow parameters
   */
  validateWorkflowParams(workflowName, parameters) {
    const errors = [];

    // Basic validation - can be extended based on workflow requirements
    if (workflowName === 'incremental-update') {
      if (!parameters.commits && !parameters.sessions) {
        errors.push('Incremental workflow requires either commits or sessions');
      }
    }

    if (workflowName === 'complete-analysis') {
      if (parameters.depth && parameters.depth < 1) {
        errors.push('Depth must be at least 1');
      }
      if (parameters.daysBack && parameters.daysBack < 1) {
        errors.push('DaysBack must be at least 1');
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Delay helper for mocking
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Debug logging
   */
  log(message) {
    if (this.debug) {
      console.log(`[WorkflowOrchestrator] ${message}`);
    }
  }
}
