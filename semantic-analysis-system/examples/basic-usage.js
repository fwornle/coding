#!/usr/bin/env node

/**
 * Basic Usage Examples for Semantic Analysis System
 * Demonstrates how to use the system programmatically
 */

import { SemanticAnalysisClient } from '../mcp-server/clients/semantic-analysis-client.js';
import { Logger } from '../shared/logger.js';

const logger = new Logger('examples');

async function runExamples() {
  const client = new SemanticAnalysisClient();
  
  try {
    // Connect to the system
    logger.info('Connecting to Semantic Analysis System...');
    await client.connect();
    
    // Example 1: Analyze a repository
    logger.info('Example 1: Repository Analysis');
    const repoAnalysis = await client.analyzeRepository({
      repository: process.cwd(), // Analyze current directory
      depth: 5,
      significanceThreshold: 6
    });
    
    console.log('Repository Analysis Results:');
    console.log(`- Total commits analyzed: ${repoAnalysis.totalCommits}`);
    console.log(`- Significant findings: ${repoAnalysis.analyzedCommits}`);
    console.log(`- Patterns detected: ${repoAnalysis.patterns?.total || 0}`);
    
    // Example 2: Web search for technical information
    logger.info('Example 2: Web Search');
    const searchResults = await client.searchWeb({
      query: 'Node.js agent architecture patterns',
      maxResults: 5
    });
    
    console.log('\nWeb Search Results:');
    searchResults.results.slice(0, 3).forEach((result, index) => {
      console.log(`${index + 1}. ${result.title}`);
      console.log(`   URL: ${result.url}`);
      console.log(`   Relevance: ${Math.round((result.relevanceScore || 0) * 100)}%`);
    });
    
    // Example 3: Create a knowledge entity
    logger.info('Example 3: Knowledge Entity Creation');
    const entity = await client.createKnowledgeEntity({
      name: 'Multi-Agent System Pattern',
      entityType: 'ArchitecturalPattern',
      significance: 8,
      observations: [
        'Uses MQTT for event-driven communication',
        'Implements JSON-RPC for synchronous operations',
        'Provides MCP integration for tool exposure',
        'Supports multiple LLM providers with fallback'
      ],
      metadata: {
        source: 'example-usage',
        technologies: ['Node.js', 'MQTT', 'JSON-RPC', 'MCP'],
        createdBy: 'basic-usage-example'
      }
    });
    
    console.log('\nKnowledge Entity Created:');
    console.log(`- Name: ${entity.name}`);
    console.log(`- Type: ${entity.entityType}`);
    console.log(`- Significance: ${entity.significance}/10`);
    console.log(`- ID: ${entity.id}`);
    
    // Example 4: Start a workflow
    logger.info('Example 4: Workflow Orchestration');
    const workflow = await client.startWorkflow('repository-analysis', {
      repository: process.cwd(),
      depth: 3,
      includeSearch: true
    });
    
    console.log('\nWorkflow Started:');
    console.log(`- Workflow ID: ${workflow.workflowId}`);
    console.log(`- Status: ${workflow.status}`);
    
    // Wait a moment then check status
    setTimeout(async () => {
      try {
        const status = await client.getWorkflowStatus(workflow.workflowId);
        console.log(`- Progress: ${status.progress}%`);
        console.log(`- Current Step: ${status.currentStep?.name || 'N/A'}`);
      } catch (error) {
        logger.debug('Workflow status check failed:', error.message);
      }
    }, 2000);
    
    // Example 5: Search existing knowledge
    logger.info('Example 5: Knowledge Search');
    const knowledgeResults = await client.searchKnowledge({
      query: 'agent pattern',
      maxResults: 5
    });
    
    console.log('\nKnowledge Search Results:');
    knowledgeResults.slice(0, 3).forEach((entity, index) => {
      console.log(`${index + 1}. ${entity.name} (${entity.entityType})`);
      console.log(`   Significance: ${entity.significance}/10`);
      console.log(`   Observations: ${entity.observations?.length || 0}`);
    });
    
    // Example 6: Sync with UKB
    logger.info('Example 6: UKB Synchronization');
    const syncResult = await client.syncWithUkb('to-ukb');
    
    console.log('\nUKB Sync Results:');
    if (syncResult.export) {
      console.log(`- Entities synced: ${syncResult.export.syncedEntities}/${syncResult.export.totalEntities}`);
    }
    console.log(`- Status: ${syncResult.status}`);
    
    // Example 7: Get system status
    logger.info('Example 7: System Status');
    const systemStatus = await client.getSystemStatus();
    
    console.log('\nSystem Status:');
    console.log(`- Overall Status: ${systemStatus.status}`);
    console.log(`- Active Agents: ${systemStatus.activeAgents}`);
    console.log(`- Running Workflows: ${systemStatus.runningWorkflows}`);
    console.log(`- Uptime: ${Math.round(systemStatus.health?.uptime || 0)}s`);
    
    console.log('\n✅ All examples completed successfully!');
    
  } catch (error) {
    logger.error('Example execution failed:', error);
    console.error('\n❌ Example failed:', error.message);
  } finally {
    // Disconnect from system
    await client.disconnect();
    logger.info('Disconnected from Semantic Analysis System');
  }
}

// Run examples if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runExamples().catch(error => {
    console.error('Failed to run examples:', error);
    process.exit(1);
  });
}

export { runExamples };