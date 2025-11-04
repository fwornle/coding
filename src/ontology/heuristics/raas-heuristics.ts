/**
 * RaaS Team Heuristics - Cloud orchestration patterns
 */

import { TeamHeuristics } from './types.js';

export const raasHeuristics: TeamHeuristics = {
  team: 'RaaS',
  description: 'Reprocessing as a Service - Cloud orchestration, Kubernetes, Argo, event mesh',
  entityHeuristics: [
    {
      entityClass: 'EventMeshNode',
      description: 'Event-driven data mesh node',
      patterns: [
        {
          keywords: ['event', 'mesh', 'node', 'kafka', 'eventbridge', 'topic', 'producer', 'consumer'],
          requiredKeywords: ['event'],
          baseConfidence: 0.7,
          keywordBoost: 0.05,
          maxConfidence: 0.95,
        },
        {
          keywords: ['publish', 'subscribe', 'event-driven', 'message', 'stream'],
          requiredKeywords: ['event'],
          baseConfidence: 0.6,
          keywordBoost: 0.05,
        },
      ],
    },
    {
      entityClass: 'ArgoWorkflowTemplate',
      description: 'Argo Workflows template',
      patterns: [
        {
          keywords: ['argo', 'workflow', 'template', 'dag', 'pipeline', 'orchestration'],
          requiredKeywords: ['argo'],
          baseConfidence: 0.8,
          keywordBoost: 0.05,
          maxConfidence: 0.95,
        },
        {
          keywords: ['workflow', 'dag', 'task', 'step', 'parallelization', 'argo'],
          baseConfidence: 0.7,
        },
      ],
    },
    {
      entityClass: 'KubernetesCluster',
      description: 'Kubernetes cluster',
      patterns: [
        {
          keywords: ['kubernetes', 'k8s', 'cluster', 'node', 'eks', 'aks', 'gke'],
          requiredKeywords: ['cluster'],
          baseConfidence: 0.75,
          keywordBoost: 0.05,
          maxConfidence: 0.95,
        },
        {
          keywords: ['cluster', 'node', 'worker', 'master', 'control plane'],
          patterns: [/\bk8s\b/i, /kubernetes/i],
          baseConfidence: 0.7,
        },
      ],
    },
    {
      entityClass: 'PodSpec',
      description: 'Kubernetes Pod specification',
      patterns: [
        {
          keywords: ['pod', 'container', 'namespace', 'deployment', 'kubernetes'],
          requiredKeywords: ['pod'],
          baseConfidence: 0.75,
          keywordBoost: 0.05,
          maxConfidence: 0.9,
        },
        {
          keywords: ['container', 'volume', 'mount', 'resource', 'limit'],
          requiredKeywords: ['pod', 'kubernetes'],
          baseConfidence: 0.7,
        },
      ],
    },
    {
      entityClass: 'PrometheusMetric',
      description: 'Prometheus monitoring metric',
      patterns: [
        {
          keywords: ['prometheus', 'metric', 'counter', 'gauge', 'histogram', 'scrape'],
          requiredKeywords: ['prometheus'],
          baseConfidence: 0.8,
          keywordBoost: 0.05,
          maxConfidence: 0.95,
        },
        {
          keywords: ['metric', 'monitoring', 'timeseries', 'label'],
          requiredKeywords: ['prometheus'],
          baseConfidence: 0.7,
        },
      ],
    },
    {
      entityClass: 'GrafanaDashboard',
      description: 'Grafana monitoring dashboard',
      patterns: [
        {
          keywords: ['grafana', 'dashboard', 'panel', 'visualization', 'query'],
          requiredKeywords: ['grafana'],
          baseConfidence: 0.8,
          keywordBoost: 0.05,
          maxConfidence: 0.95,
        },
        {
          keywords: ['dashboard', 'graph', 'alert', 'panel'],
          requiredKeywords: ['grafana'],
          baseConfidence: 0.7,
        },
      ],
    },
    {
      entityClass: 'CostOptimizationRule',
      description: 'FinOps cost optimization rule',
      patterns: [
        {
          keywords: ['cost', 'optimization', 'finops', 'savings', 'budget', 'efficiency'],
          requiredKeywords: ['cost', 'optimization'],
          baseConfidence: 0.75,
          keywordBoost: 0.05,
          maxConfidence: 0.9,
        },
        {
          keywords: ['spot', 'instance', 'downscale', 'rightsizing'],
          requiredKeywords: ['cost'],
          baseConfidence: 0.7,
        },
      ],
    },
    {
      entityClass: 'FinOpsReport',
      description: 'Financial operations report',
      patterns: [
        {
          keywords: ['finops', 'cost', 'report', 'billing', 'expense', 'forecast'],
          requiredKeywords: ['finops'],
          baseConfidence: 0.8,
          keywordBoost: 0.05,
          maxConfidence: 0.95,
        },
        {
          keywords: ['cost', 'report', 'monthly', 'quarterly', 'budget'],
          requiredKeywords: ['cost', 'report'],
          baseConfidence: 0.7,
        },
      ],
    },
    {
      entityClass: 'CachingStrategy',
      description: 'Data caching strategy',
      patterns: [
        {
          keywords: ['cache', 'caching', 'redis', 's3', 'tier', 'warmup', 'hit rate'],
          requiredKeywords: ['cache'],
          baseConfidence: 0.7,
          keywordBoost: 0.05,
          maxConfidence: 0.9,
        },
        {
          keywords: ['cache', 'memory', 'storage', 'invalidation'],
          baseConfidence: 0.65,
        },
      ],
    },
    {
      entityClass: 'AlertingRule',
      description: 'Prometheus alerting rule',
      patterns: [
        {
          keywords: ['alert', 'alerting', 'rule', 'prometheus', 'notification', 'severity'],
          requiredKeywords: ['alert'],
          baseConfidence: 0.75,
          keywordBoost: 0.05,
          maxConfidence: 0.9,
        },
        {
          keywords: ['critical', 'warning', 'error', 'threshold', 'condition'],
          requiredKeywords: ['alert'],
          baseConfidence: 0.7,
        },
      ],
    },
  ],
};
