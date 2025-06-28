#!/usr/bin/env node

/**
 * Workflow Examples for Semantic Analysis System
 * Demonstrates advanced workflow orchestration capabilities
 */

import { WorkflowBuilder } from '../agents/coordinator/builders/workflow-builder.js';
import { SemanticAnalysisClient } from '../mcp-server/clients/semantic-analysis-client.js';
import { Logger } from '../shared/logger.js';

const logger = new Logger('workflow-examples');

async function demonstrateWorkflows() {
  const client = new SemanticAnalysisClient();
  const workflowBuilder = new WorkflowBuilder();
  
  try {
    await client.connect();
    logger.info('Connected to system for workflow demonstration');
    
    // Example 1: Custom Technology Research Workflow
    logger.info('Example 1: Custom Technology Research Workflow');
    
    const techResearchWorkflow = {
      name: 'Advanced Technology Research',
      description: 'Comprehensive technology analysis with competitive research',
      steps: [
        {
          name: 'primary-documentation-search',
          type: 'agent-call',
          config: {
            agent: 'web-search',
            action: 'technical-docs',
            parameters: {
              technology: '${context.technology}',
              topic: 'documentation tutorial getting-started'
            }
          },
          outputMapping: {
            primaryDocs: 'result'
          }
        },
        {
          name: 'best-practices-search',
          type: 'agent-call',
          config: {
            agent: 'web-search',
            action: 'best-practices',
            parameters: {
              technology: '${context.technology}',
              category: 'patterns architecture performance'
            }
          },
          outputMapping: {
            bestPractices: 'result'
          }
        },
        {
          name: 'competitive-analysis',
          type: 'agent-call',
          config: {
            agent: 'web-search',
            action: 'tech-comparison',
            parameters: {
              technologies: '${context.technology} ${context.competitors}',
              criteria: 'performance scalability ecosystem adoption'
            }
          },
          outputMapping: {
            competitiveAnalysis: 'result'
          }
        },
        {
          name: 'synthesize-research',
          type: 'agent-call',
          config: {
            agent: 'semantic-analysis',
            action: 'analyze-content',
            parameters: {
              content: {
                documentation: '${context.primaryDocs}',
                bestPractices: '${context.bestPractices}',
                competition: '${context.competitiveAnalysis}'
              },
              analysisType: 'technology-synthesis'
            }
          },
          outputMapping: {
            synthesis: 'result'
          }
        },
        {
          name: 'create-research-entity',
          type: 'agent-call',
          config: {
            agent: 'knowledge-graph',
            action: 'create-entity',
            parameters: {
              name: 'Technology Research: ${context.technology}',
              entityType: 'TechnologyResearch',
              significance: 8,
              observations: [
                'Comprehensive research including documentation, best practices, and competitive analysis',
                'Primary docs sources: ${context.primaryDocs.results.length}',
                'Best practices sources: ${context.bestPractices.results.length}',
                'Competitive insights: ${context.competitiveAnalysis.results.length}'
              ],
              metadata: {
                technology: '${context.technology}',
                competitors: '${context.competitors}',
                researchDate: new Date().toISOString(),
                synthesis: '${context.synthesis}'
              }
            }
          }
        }
      ]
    };
    
    const workflow1 = await workflowBuilder.createWorkflow(techResearchWorkflow);
    const execution1 = await client.startWorkflow('custom', {
      workflow: workflow1,
      technology: 'Next.js',
      competitors: 'React, Vue, Angular'
    });
    
    console.log('Technology Research Workflow Started:');
    console.log(`- Workflow ID: ${execution1.workflowId}`);
    console.log(`- Technology: Next.js`);
    console.log(`- Competitors: React, Vue, Angular`);
    
    // Example 2: Code Quality Assessment Workflow
    logger.info('Example 2: Code Quality Assessment Workflow');
    
    const codeQualityWorkflow = {
      name: 'Code Quality Assessment',
      description: 'Multi-dimensional code quality analysis',
      steps: [
        {
          name: 'analyze-recent-commits',
          type: 'agent-call',
          config: {
            agent: 'semantic-analysis',
            action: 'analyze-code',
            parameters: {
              repository: '${context.repository}',
              depth: '${context.depth}',
              significanceThreshold: 5
            }
          },
          outputMapping: {
            commitAnalysis: 'result'
          }
        },
        {
          name: 'extract-technologies',
          type: 'transform',
          config: {
            transform: {
              detectedTechnologies: 'commitAnalysis.technologies',
              codePatterns: 'commitAnalysis.patterns'
            }
          }
        },
        {
          name: 'search-quality-standards',
          type: 'agent-call',
          config: {
            agent: 'web-search',
            action: 'best-practices',
            parameters: {
              technologies: '${context.detectedTechnologies}',
              patterns: 'code quality standards testing practices'
            }
          },
          conditions: [
            { field: 'context.detectedTechnologies', operator: 'exists' }
          ],
          outputMapping: {
            qualityStandards: 'result'
          }
        },
        {
          name: 'assess-technical-debt',
          type: 'agent-call',
          config: {
            agent: 'semantic-analysis',
            action: 'analyze-patterns',
            parameters: {
              patterns: '${context.codePatterns}',
              context: {
                type: 'technical-debt-assessment',
                repository: '${context.repository}'
              }
            }
          },
          outputMapping: {
            techDebtAssessment: 'result'
          }
        },
        {
          name: 'generate-quality-report',
          type: 'agent-call',
          config: {
            agent: 'knowledge-graph',
            action: 'extract-insights',
            parameters: {
              analysisData: {
                commits: '${context.commitAnalysis}',
                standards: '${context.qualityStandards}',
                techDebt: '${context.techDebtAssessment}'
              },
              context: {
                source: 'code-quality-assessment',
                repository: '${context.repository}'
              }
            }
          },
          outputMapping: {
            qualityReport: 'result'
          }
        }
      ]
    };
    
    const workflow2 = await workflowBuilder.createWorkflow(codeQualityWorkflow);
    const execution2 = await client.startWorkflow('custom', {
      workflow: workflow2,
      repository: process.cwd(),
      depth: 15
    });
    
    console.log('\nCode Quality Assessment Workflow Started:');
    console.log(`- Workflow ID: ${execution2.workflowId}`);
    console.log(`- Repository: ${process.cwd()}`);
    console.log(`- Analysis Depth: 15 commits`);
    
    // Example 3: Knowledge Mining Workflow
    logger.info('Example 3: Knowledge Mining Workflow');
    
    const knowledgeMiningWorkflow = {
      name: 'Knowledge Mining Pipeline',
      description: 'Extracts and consolidates knowledge from multiple sources',
      steps: [
        {
          name: 'discover-conversation-logs',
          type: 'function',
          config: {
            functionName: 'discoverConversationLogs',
            parameters: {
              searchPaths: '${context.searchPaths}',
              extensions: ['.md', '.txt', '.log']
            }
          },
          outputMapping: {
            conversationFiles: 'result'
          }
        },
        {
          name: 'analyze-conversations-parallel',
          type: 'parallel',
          config: {
            steps: [
              {
                name: 'analyze-conversation-batch-1',
                type: 'agent-call',
                config: {
                  agent: 'semantic-analysis',
                  action: 'analyze-conversation',
                  parameters: {
                    conversationPath: '${context.conversationFiles[0]}',
                    extractInsights: true
                  }
                }
              },
              {
                name: 'analyze-conversation-batch-2',
                type: 'agent-call',
                config: {
                  agent: 'semantic-analysis',
                  action: 'analyze-conversation',
                  parameters: {
                    conversationPath: '${context.conversationFiles[1]}',
                    extractInsights: true
                  }
                }
              }
            ]
          },
          outputMapping: {
            conversationAnalyses: 'parallelResults'
          }
        },
        {
          name: 'consolidate-insights',
          type: 'agent-call',
          config: {
            agent: 'knowledge-graph',
            action: 'consolidate-insights',
            parameters: {
              insights: '${context.conversationAnalyses}',
              consolidationStrategy: 'merge-similar-patterns'
            }
          },
          outputMapping: {
            consolidatedInsights: 'result'
          }
        },
        {
          name: 'enrich-with-web-research',
          type: 'agent-call',
          config: {
            agent: 'web-search',
            action: 'validate-insights',
            parameters: {
              insights: '${context.consolidatedInsights}',
              searchDepth: 'comprehensive'
            }
          },
          outputMapping: {
            enrichedInsights: 'result'
          }
        },
        {
          name: 'sync-to-knowledge-base',
          type: 'agent-call',
          config: {
            agent: 'knowledge-graph',
            action: 'bulk-create-entities',
            parameters: {
              entities: '${context.enrichedInsights}',
              updateExisting: true
            }
          }
        }
      ]
    };
    
    const workflow3 = await workflowBuilder.createWorkflow(knowledgeMiningWorkflow);
    const execution3 = await client.startWorkflow('custom', {
      workflow: workflow3,
      searchPaths: ['.specstory/history', 'docs', 'knowledge-management']
    });
    
    console.log('\nKnowledge Mining Workflow Started:');
    console.log(`- Workflow ID: ${execution3.workflowId}`);
    console.log(`- Search Paths: .specstory/history, docs, knowledge-management`);
    
    // Example 4: Monitoring Workflow Status
    logger.info('Example 4: Monitoring Workflow Progress');
    
    const workflowIds = [execution1.workflowId, execution2.workflowId, execution3.workflowId];
    
    // Monitor workflows for a short time
    console.log('\nMonitoring workflow progress...');
    
    for (let i = 0; i < 3; i++) {
      await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
      
      console.log(`\n--- Status Check ${i + 1} ---`);
      
      for (const workflowId of workflowIds) {
        try {
          const status = await client.getWorkflowStatus(workflowId);
          console.log(`Workflow ${workflowId.substring(0, 8)}...:`);
          console.log(`  Status: ${status.status}`);
          console.log(`  Progress: ${status.progress}%`);
          console.log(`  Current Step: ${status.currentStep?.name || 'N/A'}`);
        } catch (error) {
          console.log(`Workflow ${workflowId.substring(0, 8)}...: Status unavailable`);
        }
      }
    }
    
    console.log('\n✅ Workflow examples completed!');
    console.log('\nKey Concepts Demonstrated:');
    console.log('- Custom workflow creation with multiple steps');
    console.log('- Parallel execution of workflow steps');
    console.log('- Conditional step execution');
    console.log('- Data transformation between steps');
    console.log('- Cross-agent coordination');
    console.log('- Workflow monitoring and status tracking');
    
  } catch (error) {
    logger.error('Workflow demonstration failed:', error);
    console.error('\n❌ Workflow example failed:', error.message);
  } finally {
    await client.disconnect();
    logger.info('Disconnected from system');
  }
}

// Helper function that would be implemented in a real system
function discoverConversationLogs(parameters) {
  // Mock implementation - in reality, this would scan directories
  const { searchPaths, extensions } = parameters;
  
  return {
    result: [
      '.specstory/history/conversation-1.md',
      '.specstory/history/conversation-2.md',
      'docs/technical-discussion.md',
      'knowledge-management/insights.md'
    ].slice(0, 2) // Return first 2 for demo
  };
}

// Run examples if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  demonstrateWorkflows().catch(error => {
    console.error('Failed to run workflow examples:', error);
    process.exit(1);
  });
}

export { demonstrateWorkflows };