/**
 * Coding Team Heuristics - Knowledge management infrastructure patterns
 */

import { TeamHeuristics } from './types.js';

export const codingHeuristics: TeamHeuristics = {
  team: 'coding',
  description: 'Knowledge management infrastructure - LSL, constraints, MCP, graph database',
  entityHeuristics: [
    {
      entityClass: 'LSLSession',
      description: 'Live Session Logging session',
      patterns: [
        {
          keywords: ['lsl', 'session', 'logging', 'transcript', 'live'],
          requiredKeywords: ['lsl'],
          baseConfidence: 0.85,
          keywordBoost: 0.05,
          maxConfidence: 0.95,
        },
      ],
    },
    {
      entityClass: 'ClassificationLayer',
      description: '5-layer classification system',
      patterns: [
        {
          keywords: ['classification', 'layer', 'intent', 'action', 'interaction', 'outcome'],
          requiredKeywords: ['classification', 'layer'],
          baseConfidence: 0.75,
          keywordBoost: 0.05,
          maxConfidence: 0.9,
        },
      ],
    },
    {
      entityClass: 'ConstraintRule',
      description: 'Constraint monitoring rule',
      patterns: [
        {
          keywords: ['constraint', 'rule', 'violation', 'compliance', 'policy'],
          requiredKeywords: ['constraint'],
          baseConfidence: 0.75,
          keywordBoost: 0.05,
          maxConfidence: 0.9,
        },
      ],
    },
    {
      entityClass: 'TrajectoryState',
      description: 'Trajectory generation state',
      patterns: [
        {
          keywords: ['trajectory', 'state', 'conversation', 'context', 'history'],
          requiredKeywords: ['trajectory'],
          baseConfidence: 0.75,
          keywordBoost: 0.05,
          maxConfidence: 0.9,
        },
      ],
    },
    {
      entityClass: 'MCPAgent',
      description: 'Model Context Protocol agent/server implementation',
      patterns: [
        {
          keywords: ['mcp', 'server', 'protocol', 'tool', 'handler'],
          requiredKeywords: ['mcp', 'server'],  // Require both 'mcp' AND 'server'
          baseConfidence: 0.85,
          keywordBoost: 0.05,
          maxConfidence: 0.95,
        },
        {
          keywords: ['mcp', 'protocol', 'integration', 'agent'],
          requiredKeywords: ['mcp', 'protocol'],  // Or 'mcp' AND 'protocol'
          baseConfidence: 0.8,
          keywordBoost: 0.05,
          maxConfidence: 0.9,
        },
      ],
    },
    {
      entityClass: 'GraphDatabase',
      description: 'Graphology + LevelDB graph database',
      patterns: [
        {
          keywords: ['graph', 'database', 'graphology', 'leveldb', 'node', 'edge'],
          requiredKeywords: ['graph', 'database'],
          baseConfidence: 0.8,
          keywordBoost: 0.05,
          maxConfidence: 0.95,
        },
      ],
    },
    {
      entityClass: 'VectorDatabase',
      description: 'Vector database (Qdrant)',
      patterns: [
        {
          keywords: ['vector', 'database', 'qdrant', 'embedding', 'similarity', 'search'],
          requiredKeywords: ['vector'],
          baseConfidence: 0.8,
          keywordBoost: 0.05,
          maxConfidence: 0.95,
        },
      ],
    },
    {
      entityClass: 'EmbeddingVector',
      description: 'Text embedding vector',
      patterns: [
        {
          keywords: ['embedding', 'vector', 'text', 'semantic', 'similarity'],
          requiredKeywords: ['embedding'],
          baseConfidence: 0.75,
          keywordBoost: 0.05,
          maxConfidence: 0.9,
        },
      ],
    },
    {
      entityClass: 'KnowledgeEntity',
      description: 'Knowledge graph entity with observations',
      patterns: [
        {
          keywords: ['entity', 'knowledge', 'observation', 'graph', 'insight'],
          requiredKeywords: ['entity', 'knowledge'],
          baseConfidence: 0.8,
          keywordBoost: 0.05,
          maxConfidence: 0.95,
        },
        {
          keywords: ['pattern', 'insight', 'learned', 'extracted'],
          requiredKeywords: ['pattern', 'insight'],
          baseConfidence: 0.75,
          keywordBoost: 0.05,
          maxConfidence: 0.9,
        },
      ],
    },
    {
      entityClass: 'WorkflowDefinition',
      description: 'Analysis workflow definition (YAML/config)',
      patterns: [
        {
          keywords: ['workflow', 'step', 'agent', 'pipeline', 'analysis'],
          requiredKeywords: ['workflow'],
          baseConfidence: 0.8,
          keywordBoost: 0.05,
          maxConfidence: 0.95,
        },
      ],
    },
    {
      entityClass: 'HookConfiguration',
      description: 'Claude Code hook configuration',
      patterns: [
        {
          keywords: ['hook', 'pretool', 'posttool', 'wrapper', 'callback'],
          requiredKeywords: ['hook'],
          baseConfidence: 0.8,
          keywordBoost: 0.05,
          maxConfidence: 0.9,
        },
      ],
    },
    {
      entityClass: 'MonitoringLayer',
      description: 'LSL monitoring architecture layer',
      patterns: [
        {
          keywords: ['monitoring', 'layer', 'watchdog', 'health', 'coordinator'],
          requiredKeywords: ['monitoring', 'layer'],
          baseConfidence: 0.75,
          keywordBoost: 0.05,
          maxConfidence: 0.9,
        },
      ],
    },
    {
      entityClass: 'ConfigurationFile',
      description: 'System configuration file (JSON/YAML)',
      patterns: [
        {
          keywords: ['config', 'configuration', 'settings', 'json', 'yaml'],
          requiredKeywords: ['config'],
          baseConfidence: 0.7,
          keywordBoost: 0.05,
          maxConfidence: 0.85,
        },
      ],
    },
    {
      entityClass: 'SemanticAnalyzer',
      description: 'Semantic analysis system or component',
      patterns: [
        {
          keywords: ['semantic', 'analysis', 'extraction', 'llm', 'insight'],
          requiredKeywords: ['semantic', 'analysis'],
          baseConfidence: 0.8,
          keywordBoost: 0.05,
          maxConfidence: 0.95,
        },
      ],
    },
  ],
};
