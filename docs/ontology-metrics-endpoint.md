# Ontology Metrics Endpoint

## Overview

The ontology system exposes Prometheus-compatible metrics for monitoring classification, validation, queries, cache performance, and LLM usage.

## Exposing Metrics in Express

```typescript
import express from 'express';
import { ontologyMetrics } from './ontology';

const app = express();

// Prometheus metrics endpoint
app.get('/metrics', (req, res) => {
  res.set('Content-Type', 'text/plain; version=0.0.4');
  res.send(ontologyMetrics.exportPrometheus());
});

// JSON metrics endpoint (for debugging)
app.get('/metrics/json', (req, res) => {
  res.json(ontologyMetrics.exportJSON());
});

app.listen(9090, () => {
  console.log('Metrics server listening on http://localhost:9090/metrics');
});
```

## Available Metrics

### Classification Metrics

- **`ontology_classification_total`** (counter)
  Total number of classification attempts
  - Labels: `team` (RaaS, ReSi, Coding, Agentic, UI, all)

- **`ontology_classification_success`** (counter)
  Number of successful classifications
  - Labels: `team`, `method` (heuristic, llm, hybrid)

- **`ontology_classification_failure`** (counter)
  Number of failed classifications (below confidence threshold)
  - Labels: `team`

- **`ontology_classification_duration_seconds`** (histogram)
  Classification latency distribution
  - Labels: `team`
  - Buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5]

- **`ontology_classification_confidence`** (histogram)
  Classification confidence score distribution
  - Labels: `team`, `method`
  - Buckets: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]

### Validation Metrics

- **`ontology_validation_total`** (counter)
  Total validation attempts
  - Labels: `mode` (strict, lenient, disabled), `team`

- **`ontology_validation_success`** (counter)
  Successful validations
  - Labels: `mode`, `team`

- **`ontology_validation_failure`** (counter)
  Failed validations
  - Labels: `mode`, `team`

### Query Metrics

- **`ontology_query_total`** (counter)
  Total number of ontology queries

- **`ontology_query_duration_seconds`** (histogram)
  Query latency distribution
  - Buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1]

- **`ontology_query_results`** (histogram)
  Number of results per query
  - Buckets: [0, 1, 5, 10, 25, 50, 100, 250, 500]

### Cache Metrics

- **`ontology_cache_hits`** (counter)
  Number of cache hits
  - Labels: `type` (upper, lower)

- **`ontology_cache_misses`** (counter)
  Number of cache misses
  - Labels: `type`

- **`ontology_cache_size`** (gauge)
  Current cache size (number of entries)

### LLM Usage Metrics

- **`ontology_llm_calls_total`** (counter)
  Total LLM API calls
  - Labels: `team`

- **`ontology_llm_tokens_prompt`** (counter)
  Total prompt tokens consumed
  - Labels: `team`

- **`ontology_llm_tokens_completion`** (counter)
  Total completion tokens consumed
  - Labels: `team`

- **`ontology_llm_duration_seconds`** (histogram)
  LLM call latency distribution
  - Labels: `team`
  - Buckets: [0.1, 0.5, 1, 2, 5, 10]

## Prometheus Configuration

Add this job to your `prometheus.yml`:

```yaml
scrape_configs:
  - job_name: 'ontology-metrics'
    scrape_interval: 15s
    static_configs:
      - targets: ['localhost:9090']
```

## Example Prometheus Queries

### Classification Success Rate

```promql
rate(ontology_classification_success[5m]) / rate(ontology_classification_total[5m])
```

### Classification Latency (p95)

```promql
histogram_quantile(0.95, rate(ontology_classification_duration_seconds_bucket[5m]))
```

### Classification Latency by Team

```promql
histogram_quantile(0.95, sum by (team, le) (rate(ontology_classification_duration_seconds_bucket[5m])))
```

### Average Classification Confidence

```promql
rate(ontology_classification_confidence_sum[5m]) / rate(ontology_classification_confidence_count[5m])
```

### Validation Success Rate by Mode

```promql
rate(ontology_validation_success[5m]) / rate(ontology_validation_total[5m]) * 100
```

### Cache Hit Rate

```promql
rate(ontology_cache_hits[5m]) / (rate(ontology_cache_hits[5m]) + rate(ontology_cache_misses[5m])) * 100
```

### LLM Token Usage Rate

```promql
rate(ontology_llm_tokens_prompt[1h]) + rate(ontology_llm_tokens_completion[1h])
```

### LLM Cost Estimation (assuming $0.01 per 1000 tokens)

```promql
(
  rate(ontology_llm_tokens_prompt[1h]) * 0.00001 +
  rate(ontology_llm_tokens_completion[1h]) * 0.00003
) * 3600
```

## Alert Rules

Create `ontology_alerts.yml`:

```yaml
groups:
  - name: ontology_alerts
    interval: 30s
    rules:
      # Classification success rate below 85%
      - alert: LowClassificationSuccessRate
        expr: rate(ontology_classification_success[5m]) / rate(ontology_classification_total[5m]) < 0.85
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Ontology classification success rate below 85%"
          description: "Classification success rate is {{ $value | humanizePercentage }}"

      # Classification latency above 500ms (p95)
      - alert: HighClassificationLatency
        expr: histogram_quantile(0.95, rate(ontology_classification_duration_seconds_bucket[5m])) > 0.5
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Ontology classification p95 latency above 500ms"
          description: "p95 latency is {{ $value | humanizeDuration }}"

      # Validation failure rate above 20%
      - alert: HighValidationFailureRate
        expr: rate(ontology_validation_failure[5m]) / rate(ontology_validation_total[5m]) > 0.2
        for: 5m
        labels:
          severity: info
        annotations:
          summary: "Ontology validation failure rate above 20%"
          description: "Validation failure rate is {{ $value | humanizePercentage }}"

      # Cache hit rate below 70%
      - alert: LowCacheHitRate
        expr: rate(ontology_cache_hits[5m]) / (rate(ontology_cache_hits[5m]) + rate(ontology_cache_misses[5m])) < 0.7
        for: 10m
        labels:
          severity: info
        annotations:
          summary: "Ontology cache hit rate below 70%"
          description: "Cache hit rate is {{ $value | humanizePercentage }}"

      # LLM token usage spike (>10k tokens/hour)
      - alert: HighLLMTokenUsage
        expr: rate(ontology_llm_tokens_prompt[1h]) + rate(ontology_llm_tokens_completion[1h]) > 10000
        for: 15m
        labels:
          severity: info
        annotations:
          summary: "High LLM token usage detected"
          description: "Using {{ $value | humanize }} tokens/hour"
```

## Debugging with curl

```bash
# Prometheus format
curl http://localhost:9090/metrics

# JSON format (easier to read)
curl http://localhost:9090/metrics/json | jq .
```

## Next Steps

1. Deploy metrics endpoint alongside your application
2. Configure Prometheus to scrape the endpoint
3. Import Grafana dashboard (see `ontology-grafana-dashboard.json`)
4. Set up alert rules in Prometheus
5. Monitor and tune based on metrics
