/**
 * Agentic Team Heuristics - AI agent frameworks and RAG patterns
 */

import { TeamHeuristics } from './types.js';

export const agenticHeuristics: TeamHeuristics = {
  team: 'agentic',
  description: 'AI agent frameworks, RAG systems, and multi-agent orchestration',
  entityHeuristics: [
    {
      entityClass: 'AgentFramework',
      description: 'AI agent framework',
      patterns: [
        {
          keywords: ['agent', 'framework', 'langchain', 'crewai', 'pydantic', 'orchestration'],
          requiredKeywords: ['agent', 'framework'],
          baseConfidence: 0.75,
          keywordBoost: 0.05,
          maxConfidence: 0.9,
        },
      ],
    },
    {
      entityClass: 'RAGSystem',
      description: 'Retrieval-Augmented Generation system',
      patterns: [
        {
          keywords: ['rag', 'retrieval', 'augmented', 'generation', 'context', 'embedding'],
          requiredKeywords: ['rag'],
          baseConfidence: 0.85,
          keywordBoost: 0.05,
          maxConfidence: 0.95,
        },
        {
          keywords: ['retrieval', 'augmented', 'generation', 'context', 'llm'],
          baseConfidence: 0.7,
        },
      ],
    },
    {
      entityClass: 'CommunicationProtocol',
      description: 'Agent communication protocol',
      patterns: [
        {
          keywords: ['protocol', 'mcp', 'acp', 'a2a', 'communication', 'agent'],
          requiredKeywords: ['protocol'],
          baseConfidence: 0.75,
          keywordBoost: 0.05,
          maxConfidence: 0.9,
        },
      ],
    },
    {
      entityClass: 'ModuleContent',
      description: 'Course module content',
      patterns: [
        {
          keywords: ['module', 'content', 'course', 'lesson', 'curriculum', 'learning'],
          requiredKeywords: ['module', 'content'],
          baseConfidence: 0.7,
          keywordBoost: 0.05,
          maxConfidence: 0.85,
        },
      ],
    },
    {
      entityClass: 'LLMProvider',
      description: 'LLM service provider',
      patterns: [
        {
          keywords: ['llm', 'provider', 'openai', 'anthropic', 'model', 'inference'],
          requiredKeywords: ['llm'],
          baseConfidence: 0.8,
          keywordBoost: 0.05,
          maxConfidence: 0.95,
        },
      ],
    },
    {
      entityClass: 'PromptTemplate',
      description: 'LLM prompt template',
      patterns: [
        {
          keywords: ['prompt', 'template', 'instruction', 'system', 'user', 'llm'],
          requiredKeywords: ['prompt', 'template'],
          baseConfidence: 0.75,
          keywordBoost: 0.05,
          maxConfidence: 0.9,
        },
      ],
    },
    {
      entityClass: 'AgentWorkflow',
      description: 'Multi-agent workflow',
      patterns: [
        {
          keywords: ['workflow', 'agent', 'orchestration', 'coordination', 'task', 'delegation'],
          requiredKeywords: ['workflow', 'agent'],
          baseConfidence: 0.75,
          keywordBoost: 0.05,
          maxConfidence: 0.9,
        },
      ],
    },
  ],
};
