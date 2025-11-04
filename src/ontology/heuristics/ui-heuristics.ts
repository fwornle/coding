/**
 * UI Team Heuristics - Multi-agent curriculum system patterns
 */

import { TeamHeuristics } from './types.js';

export const uiHeuristics: TeamHeuristics = {
  team: 'ui',
  description: 'Multi-Agent Curriculum Alignment System (MACAS) with AWS serverless',
  entityHeuristics: [
    {
      entityClass: 'AgentInstance',
      description: 'Specialized agent instance',
      patterns: [
        {
          keywords: ['agent', 'instance', 'specialist', 'orchestrator', 'coordinator'],
          requiredKeywords: ['agent'],
          baseConfidence: 0.7,
          keywordBoost: 0.05,
          maxConfidence: 0.85,
        },
      ],
    },
    {
      entityClass: 'WorkflowOrchestration',
      description: 'Multi-agent workflow orchestration',
      patterns: [
        {
          keywords: ['workflow', 'orchestration', 'step', 'function', 'state machine', 'agent'],
          requiredKeywords: ['workflow', 'orchestration'],
          baseConfidence: 0.75,
          keywordBoost: 0.05,
          maxConfidence: 0.9,
        },
      ],
    },
    {
      entityClass: 'AWSLambdaFunction',
      description: 'AWS Lambda function',
      patterns: [
        {
          keywords: ['lambda', 'function', 'aws', 'serverless', 'handler'],
          requiredKeywords: ['lambda'],
          baseConfidence: 0.85,
          keywordBoost: 0.05,
          maxConfidence: 0.95,
        },
      ],
    },
    {
      entityClass: 'AWSStepFunction',
      description: 'AWS Step Functions state machine',
      patterns: [
        {
          keywords: ['step', 'function', 'state machine', 'aws', 'workflow', 'orchestration'],
          requiredKeywords: ['step', 'function'],
          baseConfidence: 0.8,
          keywordBoost: 0.05,
          maxConfidence: 0.95,
        },
      ],
    },
    {
      entityClass: 'APIGatewayEndpoint',
      description: 'API Gateway endpoint',
      patterns: [
        {
          keywords: ['api', 'gateway', 'endpoint', 'rest', 'http', 'aws'],
          requiredKeywords: ['api', 'gateway'],
          baseConfidence: 0.8,
          keywordBoost: 0.05,
          maxConfidence: 0.95,
        },
      ],
    },
    {
      entityClass: 'QdrantCollection',
      description: 'Qdrant vector collection',
      patterns: [
        {
          keywords: ['qdrant', 'collection', 'vector', 'embedding', 'similarity'],
          requiredKeywords: ['qdrant'],
          baseConfidence: 0.85,
          keywordBoost: 0.05,
          maxConfidence: 0.95,
        },
      ],
    },
    {
      entityClass: 'ReactComponent',
      description: 'React UI component',
      patterns: [
        {
          keywords: ['react', 'component', 'jsx', 'tsx', 'ui', 'frontend'],
          requiredKeywords: ['react', 'component'],
          baseConfidence: 0.8,
          keywordBoost: 0.05,
          maxConfidence: 0.95,
        },
      ],
    },
    {
      entityClass: 'ReduxState',
      description: 'Redux state management',
      patterns: [
        {
          keywords: ['redux', 'state', 'store', 'action', 'reducer', 'dispatch'],
          requiredKeywords: ['redux'],
          baseConfidence: 0.85,
          keywordBoost: 0.05,
          maxConfidence: 0.95,
        },
      ],
    },
    {
      entityClass: 'CurriculumEntity',
      description: 'Curriculum entity',
      patterns: [
        {
          keywords: ['curriculum', 'course', 'module', 'learning', 'objective', 'competency'],
          requiredKeywords: ['curriculum'],
          baseConfidence: 0.75,
          keywordBoost: 0.05,
          maxConfidence: 0.9,
        },
      ],
    },
    {
      entityClass: 'GapAnalysisReport',
      description: 'Curriculum gap analysis',
      patterns: [
        {
          keywords: ['gap', 'analysis', 'report', 'alignment', 'curriculum', 'assessment'],
          requiredKeywords: ['gap', 'analysis'],
          baseConfidence: 0.8,
          keywordBoost: 0.05,
          maxConfidence: 0.95,
        },
      ],
    },
  ],
};
