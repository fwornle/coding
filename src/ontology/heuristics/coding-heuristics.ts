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
      description: 'Model Context Protocol agent',
      patterns: [
        {
          keywords: ['mcp', 'agent', 'protocol', 'server', 'tool'],
          requiredKeywords: ['mcp'],
          baseConfidence: 0.8,
          keywordBoost: 0.05,
          maxConfidence: 0.95,
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
  ],
};
