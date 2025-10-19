# Continuous Learning Knowledge System - Operations Guide

**Version**: 1.0
**Last Updated**: 2025-10-19
**Target Audience**: DevOps Engineers, Site Reliability Engineers, System Administrators

## Table of Contents

1. [Overview](#overview)
2. [System Health Monitoring](#system-health-monitoring)
3. [Database Maintenance](#database-maintenance)
4. [Cost Monitoring & Optimization](#cost-monitoring--optimization)
5. [Scaling Guidelines](#scaling-guidelines)
6. [Disaster Recovery](#disaster-recovery)
7. [Performance Tuning](#performance-tuning)
8. [Troubleshooting Production Issues](#troubleshooting-production-issues)
9. [Incident Response Procedures](#incident-response-procedures)
10. [Operational Runbooks](#operational-runbooks)

---

## Overview

### System Components

The Continuous Learning Knowledge System consists of the following operational components:

1. **Unified Inference Engine** - Multi-provider LLM inference with circuit breaker
2. **Qdrant Vector Database** - Semantic search with HNSW indexing
3. **SQLite Analytics Database** - Metadata, cost tracking, and analytics
4. **Knowledge Extraction Pipeline** - Real-time and batch extraction
5. **Trajectory Tracking System** - Intent classification and goal tracking
6. **Budget Tracking Service** - Cost monitoring and enforcement

### Service Dependencies

```
┌─────────────────────────────────────────┐
│   Continuous Learning System            │
├─────────────────────────────────────────┤
│                                         │
│  ┌────────────┐      ┌──────────────┐   │
│  │ Inference  │─────▶│ Budget       │   │
│  │ Engine     │      │ Tracker      │   │
│  └────────────┘      └──────────────┘   │
│         │                    │          │
│         ▼                    ▼          │
│  ┌────────────┐      ┌──────────────┐   │
│  │ Knowledge  │─────▶│ Database     │   │
│  │ Extractor  │      │ Manager      │   │
│  └────────────┘      └──────────────┘   │
│                              │          │
│                              ▼          │
│                     ┌────────────────┐  │
│                     │ Qdrant         │  │
│                     │ + SQLite       │  │
│                     └────────────────┘  │
└─────────────────────────────────────────┘
         │                    │
         ▼                    ▼
  ┌───────────┐        ┌───────────┐
  │ Groq API  │        │ Local LLM │
  │ OpenRouter│        │ (Ollama)  │
  └───────────┘        └───────────┘
```

### Critical Metrics

| Metric | Target | Alert Threshold | Critical Threshold |
|--------|--------|----------------|-------------------|
| Inference Latency (p95) | <2s | >3s | >5s |
| Vector Search (p95) | <500ms | >1s | >2s |
| Embedding Generation (384-dim) | <50ms | >100ms | >200ms |
| Embedding Generation (1536-dim) | <200ms | >500ms | >1s |
| Cache Hit Rate | >40% | <30% | <20% |
| Monthly LLM Cost | <$8.33 | >$7.50 | >$8.33 |
| Qdrant Memory Usage | <4GB | >6GB | >8GB |
| SQLite Database Size | <500MB | >800MB | >1GB |
| Knowledge Extraction Rate | >10/min | <5/min | <2/min |
| Circuit Breaker State | Closed | Half-Open | Open |

---

## System Health Monitoring

### 1. Metrics Collection Setup

#### Prometheus Integration

Create `prometheus.yml` configuration:

```yaml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  - job_name: 'knowledge-system'
    static_configs:
      - targets: ['localhost:9090']
    metrics_path: '/metrics'

  - job_name: 'qdrant'
    static_configs:
      - targets: ['localhost:6333']
    metrics_path: '/metrics'

  - job_name: 'node-exporter'
    static_configs:
      - targets: ['localhost:9100']
```

#### Key Metrics to Expose

Add to your application's metrics endpoint:

```javascript
// src/monitoring/metrics.js
const prometheus = require('prom-client');

// Inference metrics
const inferenceLatency = new prometheus.Histogram({
  name: 'knowledge_inference_latency_seconds',
  help: 'Inference latency in seconds',
  labelNames: ['provider', 'operation'],
  buckets: [0.1, 0.5, 1, 2, 5, 10]
});

const inferenceCost = new prometheus.Counter({
  name: 'knowledge_inference_cost_usd',
  help: 'Total inference cost in USD',
  labelNames: ['provider', 'operation']
});

const cacheHits = new prometheus.Counter({
  name: 'knowledge_cache_hits_total',
  help: 'Total cache hits',
  labelNames: ['cache_type']
});

const cacheMisses = new prometheus.Counter({
  name: 'knowledge_cache_misses_total',
  help: 'Total cache misses',
  labelNames: ['cache_type']
});

// Vector search metrics
const vectorSearchLatency = new prometheus.Histogram({
  name: 'knowledge_vector_search_latency_seconds',
  help: 'Vector search latency in seconds',
  labelNames: ['dimension'],
  buckets: [0.05, 0.1, 0.2, 0.5, 1, 2]
});

// Budget metrics
const monthlyBudget = new prometheus.Gauge({
  name: 'knowledge_monthly_budget_usd',
  help: 'Monthly budget in USD'
});

const monthlySpend = new prometheus.Gauge({
  name: 'knowledge_monthly_spend_usd',
  help: 'Monthly spend in USD'
});

// Circuit breaker metrics
const circuitBreakerState = new prometheus.Gauge({
  name: 'knowledge_circuit_breaker_state',
  help: 'Circuit breaker state (0=closed, 1=half-open, 2=open)',
  labelNames: ['provider']
});

module.exports = {
  inferenceLatency,
  inferenceCost,
  cacheHits,
  cacheMisses,
  vectorSearchLatency,
  monthlyBudget,
  monthlySpend,
  circuitBreakerState
};
```

### 2. Alerting Rules

Create `alerts.yml`:

```yaml
groups:
  - name: knowledge_system
    interval: 30s
    rules:
      # Latency alerts
      - alert: HighInferenceLatency
        expr: histogram_quantile(0.95, knowledge_inference_latency_seconds) > 3
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High inference latency detected"
          description: "p95 inference latency is {{ $value }}s (threshold: 3s)"

      - alert: CriticalInferenceLatency
        expr: histogram_quantile(0.95, knowledge_inference_latency_seconds) > 5
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "Critical inference latency detected"
          description: "p95 inference latency is {{ $value }}s (threshold: 5s)"

      # Cache performance alerts
      - alert: LowCacheHitRate
        expr: |
          sum(rate(knowledge_cache_hits_total[5m])) /
          (sum(rate(knowledge_cache_hits_total[5m])) + sum(rate(knowledge_cache_misses_total[5m]))) < 0.3
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Low cache hit rate detected"
          description: "Cache hit rate is {{ $value | humanizePercentage }} (threshold: 30%)"

      # Budget alerts
      - alert: BudgetNearLimit
        expr: knowledge_monthly_spend_usd / knowledge_monthly_budget_usd > 0.8
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Budget usage above 80%"
          description: "Current spend: ${{ $value }} / ${{ .Labels.budget }}"

      - alert: BudgetExceeded
        expr: knowledge_monthly_spend_usd >= knowledge_monthly_budget_usd
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Monthly budget exceeded"
          description: "Spend: ${{ $value }} (budget: ${{ .Labels.budget }})"

      # Circuit breaker alerts
      - alert: CircuitBreakerOpen
        expr: knowledge_circuit_breaker_state == 2
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: "Circuit breaker open for {{ $labels.provider }}"
          description: "Provider {{ $labels.provider }} circuit breaker is open"

      # Database alerts
      - alert: HighQdrantMemory
        expr: qdrant_memory_usage_bytes > 6000000000
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Qdrant memory usage high"
          description: "Memory usage: {{ $value | humanize }}B (threshold: 6GB)"
```

### 3. Health Check Endpoint

Implement comprehensive health checks:

```javascript
// src/monitoring/healthcheck.js
async function performHealthCheck() {
  const checks = {
    timestamp: new Date().toISOString(),
    status: 'healthy',
    checks: {}
  };

  // Check Qdrant connection
  try {
    await qdrantClient.getCollections();
    checks.checks.qdrant = { status: 'up', latency: '< 100ms' };
  } catch (error) {
    checks.status = 'unhealthy';
    checks.checks.qdrant = { status: 'down', error: error.message };
  }

  // Check SQLite database
  try {
    const db = await getSQLiteConnection();
    db.prepare('SELECT 1').get();
    checks.checks.sqlite = { status: 'up' };
  } catch (error) {
    checks.status = 'unhealthy';
    checks.checks.sqlite = { status: 'down', error: error.message };
  }

  // Check inference providers
  for (const provider of ['groq', 'openrouter', 'local']) {
    const circuitState = await getCircuitBreakerState(provider);
    checks.checks[`provider_${provider}`] = {
      status: circuitState === 'open' ? 'degraded' : 'up',
      circuitBreaker: circuitState
    };
  }

  // Check budget status
  const budgetStatus = await budgetTracker.getStatus();
  checks.checks.budget = {
    status: budgetStatus.percentage > 95 ? 'warning' : 'ok',
    spend: budgetStatus.spend,
    limit: budgetStatus.limit,
    percentage: budgetStatus.percentage
  };

  // Check cache health
  const cacheStats = await cache.getStats();
  checks.checks.cache = {
    status: cacheStats.hitRate > 0.3 ? 'ok' : 'degraded',
    hitRate: cacheStats.hitRate,
    size: cacheStats.size
  };

  return checks;
}

// Express route
app.get('/health', async (req, res) => {
  const health = await performHealthCheck();
  const statusCode = health.status === 'healthy' ? 200 : 503;
  res.status(statusCode).json(health);
});
```

### 4. Dashboard Setup (Grafana)

Import this dashboard JSON:

```json
{
  "dashboard": {
    "title": "Knowledge System Operations",
    "panels": [
      {
        "title": "Inference Latency (p95)",
        "targets": [
          {
            "expr": "histogram_quantile(0.95, knowledge_inference_latency_seconds)"
          }
        ]
      },
      {
        "title": "Cache Hit Rate",
        "targets": [
          {
            "expr": "sum(rate(knowledge_cache_hits_total[5m])) / (sum(rate(knowledge_cache_hits_total[5m])) + sum(rate(knowledge_cache_misses_total[5m])))"
          }
        ]
      },
      {
        "title": "Monthly Spend vs Budget",
        "targets": [
          { "expr": "knowledge_monthly_spend_usd" },
          { "expr": "knowledge_monthly_budget_usd" }
        ]
      },
      {
        "title": "Circuit Breaker States",
        "targets": [
          {
            "expr": "knowledge_circuit_breaker_state"
          }
        ]
      }
    ]
  }
}
```

---

## Database Maintenance

### 1. Backup Procedures

#### Automated Backup Script

Create `/scripts/backup-knowledge-system.sh`:

```bash
#!/bin/bash
set -e

BACKUP_DIR="/var/backups/knowledge-system"
DATE=$(date +%Y%m%d_%H%M%S)
RETENTION_DAYS=30

echo "Starting knowledge system backup at $DATE"

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Backup SQLite database
echo "Backing up SQLite database..."
sqlite3 /var/lib/knowledge/analytics.db ".backup '$BACKUP_DIR/analytics_$DATE.db'"
gzip "$BACKUP_DIR/analytics_$DATE.db"

# Backup Qdrant collections
echo "Backing up Qdrant collections..."
docker exec qdrant /bin/sh -c "cd /qdrant/storage && tar czf - ." > "$BACKUP_DIR/qdrant_$DATE.tar.gz"

# Backup configuration files
echo "Backing up configuration..."
tar czf "$BACKUP_DIR/config_$DATE.tar.gz" \
  /etc/knowledge-system/config.json \
  /etc/knowledge-system/sensitivity-topics.json

# Clean up old backups
echo "Cleaning up backups older than $RETENTION_DAYS days..."
find "$BACKUP_DIR" -name "*.gz" -mtime +$RETENTION_DAYS -delete
find "$BACKUP_DIR" -name "*.db" -mtime +$RETENTION_DAYS -delete

# Verify backup integrity
echo "Verifying backup integrity..."
for file in "$BACKUP_DIR"/*_$DATE*; do
  if [[ $file == *.gz ]]; then
    gzip -t "$file" || echo "WARNING: $file may be corrupted"
  fi
done

# Upload to S3 (optional)
if command -v aws &> /dev/null; then
  echo "Uploading to S3..."
  aws s3 sync "$BACKUP_DIR" "s3://your-backup-bucket/knowledge-system/" \
    --exclude "*" --include "*_$DATE*"
fi

echo "Backup completed successfully at $(date)"
```

#### Cron Schedule

Add to crontab:

```cron
# Daily backups at 2 AM
0 2 * * * /scripts/backup-knowledge-system.sh >> /var/log/knowledge-backup.log 2>&1

# Weekly integrity check on Sundays at 3 AM
0 3 * * 0 /scripts/verify-database-integrity.sh >> /var/log/knowledge-verify.log 2>&1
```

### 2. Database Optimization

#### SQLite Maintenance

Create `/scripts/optimize-sqlite.sh`:

```bash
#!/bin/bash
set -e

DB_PATH="/var/lib/knowledge/analytics.db"

echo "Starting SQLite optimization..."

# Analyze database for query optimization
sqlite3 "$DB_PATH" "ANALYZE;"

# Rebuild indices
sqlite3 "$DB_PATH" "REINDEX;"

# Vacuum to reclaim space
sqlite3 "$DB_PATH" "VACUUM;"

# Check integrity
INTEGRITY=$(sqlite3 "$DB_PATH" "PRAGMA integrity_check;")
if [ "$INTEGRITY" != "ok" ]; then
  echo "ERROR: Database integrity check failed: $INTEGRITY"
  exit 1
fi

echo "SQLite optimization completed successfully"
```

Run weekly:

```cron
0 4 * * 0 /scripts/optimize-sqlite.sh >> /var/log/knowledge-optimize.log 2>&1
```

#### Qdrant Optimization

```bash
#!/bin/bash
# /scripts/optimize-qdrant.sh

echo "Optimizing Qdrant collections..."

# Optimize knowledge_384 collection
curl -X POST 'http://localhost:6333/collections/knowledge_384/optimizers' \
  -H 'Content-Type: application/json' \
  -d '{
    "optimizers_config": {
      "indexing_threshold": 20000,
      "memmap_threshold": 50000
    }
  }'

# Optimize knowledge_1536 collection
curl -X POST 'http://localhost:6333/collections/knowledge_1536/optimizers' \
  -H 'Content-Type: application/json' \
  -d '{
    "optimizers_config": {
      "indexing_threshold": 20000,
      "memmap_threshold": 50000
    }
  }'

echo "Qdrant optimization completed"
```

### 3. Schema Migration Procedures

#### Pre-Migration Checklist

- [ ] Create full backup before migration
- [ ] Test migration on staging environment
- [ ] Review migration script for potential data loss
- [ ] Schedule maintenance window
- [ ] Notify stakeholders of downtime
- [ ] Prepare rollback procedure

#### Migration Script Template

```javascript
// migrations/001_add_confidence_index.js
const Database = require('better-sqlite3');

async function up(db) {
  console.log('Running migration: Add confidence index');

  // Create new index
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_knowledge_confidence
    ON knowledge_items(confidence DESC, created_at DESC);
  `);

  console.log('Migration completed successfully');
}

async function down(db) {
  console.log('Rolling back migration: Remove confidence index');

  db.exec('DROP INDEX IF EXISTS idx_knowledge_confidence;');

  console.log('Rollback completed successfully');
}

module.exports = { up, down };
```

#### Run Migration

```bash
#!/bin/bash
# /scripts/run-migration.sh

MIGRATION_FILE=$1
DB_PATH="/var/lib/knowledge/analytics.db"

# Backup before migration
./backup-knowledge-system.sh

# Run migration
node migrations/runner.js --migration="$MIGRATION_FILE" --db="$DB_PATH"

# Verify integrity
sqlite3 "$DB_PATH" "PRAGMA integrity_check;"
```

### 4. Index Management

Monitor and rebuild indices regularly:

```sql
-- Check index usage statistics
SELECT
  name,
  tbl_name,
  sql
FROM sqlite_master
WHERE type = 'index'
  AND tbl_name LIKE 'knowledge%';

-- Rebuild all indices
REINDEX knowledge_items;
REINDEX knowledge_vectors;
REINDEX cost_tracking;
```

For Qdrant, monitor index build status:

```bash
curl http://localhost:6333/collections/knowledge_384/cluster
```

---

## Cost Monitoring & Optimization

### 1. Cost Tracking Dashboard

Implement comprehensive cost tracking:

```javascript
// src/monitoring/cost-dashboard.js
async function generateCostReport(period = 'daily') {
  const db = await getSQLiteConnection();

  const report = {
    period,
    timestamp: new Date().toISOString(),
    total: {},
    byProvider: {},
    byProject: {},
    byOperation: {},
    trends: {}
  };

  // Total costs
  const total = db.prepare(`
    SELECT
      SUM(cost) as total_cost,
      COUNT(*) as total_requests,
      AVG(cost) as avg_cost_per_request
    FROM cost_tracking
    WHERE created_at >= datetime('now', '-1 ${period}')
  `).get();

  report.total = {
    cost: total.total_cost || 0,
    requests: total.total_requests || 0,
    avgPerRequest: total.avg_cost_per_request || 0
  };

  // By provider
  const byProvider = db.prepare(`
    SELECT
      provider,
      SUM(cost) as cost,
      COUNT(*) as requests,
      AVG(cost) as avg_cost
    FROM cost_tracking
    WHERE created_at >= datetime('now', '-1 ${period}')
    GROUP BY provider
    ORDER BY cost DESC
  `).all();

  report.byProvider = byProvider.reduce((acc, row) => {
    acc[row.provider] = {
      cost: row.cost,
      requests: row.requests,
      avgCost: row.avg_cost
    };
    return acc;
  }, {});

  // Budget status
  const budgetStatus = await budgetTracker.getStatus();
  report.budget = {
    limit: budgetStatus.limit,
    spend: budgetStatus.spend,
    remaining: budgetStatus.remaining,
    percentage: budgetStatus.percentage,
    daysRemaining: getDaysRemainingInMonth()
  };

  // Cost trend (last 7 days)
  const trend = db.prepare(`
    SELECT
      date(created_at) as date,
      SUM(cost) as daily_cost
    FROM cost_tracking
    WHERE created_at >= datetime('now', '-7 days')
    GROUP BY date(created_at)
    ORDER BY date
  `).all();

  report.trends.daily = trend;

  // Projected end-of-month cost
  const avgDailyCost = trend.reduce((sum, day) => sum + day.daily_cost, 0) / trend.length;
  const daysRemaining = getDaysRemainingInMonth();
  report.budget.projectedTotal = budgetStatus.spend + (avgDailyCost * daysRemaining);
  report.budget.projectedOverage = Math.max(0, report.budget.projectedTotal - budgetStatus.limit);

  return report;
}
```

### 2. Cost Optimization Strategies

#### Strategy 1: Cache Warming

Proactively cache common queries:

```javascript
// /scripts/warm-cache.js
const commonQueries = [
  'How do I implement authentication?',
  'Best practices for error handling',
  'How to optimize database queries',
  'React hooks usage patterns',
  'API design guidelines'
];

async function warmCache() {
  console.log('Warming knowledge cache with common queries...');

  for (const query of commonQueries) {
    try {
      await knowledgeRetriever.search(query, { limit: 5 });
      console.log(`Cached: ${query}`);
    } catch (error) {
      console.error(`Failed to cache "${query}":`, error);
    }
  }

  console.log('Cache warming completed');
}

// Run daily
warmCache();
```

#### Strategy 2: Local Model Prioritization

Configure local models as primary:

```json
{
  "inference": {
    "providerPriority": [
      "local",
      "groq",
      "openrouter"
    ],
    "localModels": {
      "enabled": true,
      "endpoint": "http://localhost:11434",
      "defaultModel": "llama3.2:3b"
    }
  }
}
```

#### Strategy 3: Batch Processing

Batch embedding generation to reduce API calls:

```javascript
// Process embeddings in batches of 32
const batchSize = 32;
for (let i = 0; i < items.length; i += batchSize) {
  const batch = items.slice(i, i + batchSize);
  await embeddingGenerator.generateBatch(batch);
}
```

### 3. Budget Alert Actions

Automated response to budget alerts:

```javascript
// src/monitoring/budget-alerting.js
async function handleBudgetThreshold(percentage) {
  if (percentage >= 90) {
    console.log('CRITICAL: Budget at 90%, switching to local-only mode');

    // Switch to local-only inference
    await updateConfig({
      inference: {
        providerPriority: ['local'],
        offlineMode: true
      }
    });

    // Send critical alert
    await sendPagerDutyAlert({
      severity: 'critical',
      message: 'Knowledge system budget at 90%, switched to local-only mode'
    });

  } else if (percentage >= 80) {
    console.log('WARNING: Budget at 80%, prioritizing local models');

    // Prioritize local models
    await updateConfig({
      inference: {
        providerPriority: ['local', 'groq', 'openrouter']
      }
    });

    // Send warning
    await sendSlackMessage({
      channel: '#ops-alerts',
      message: `Knowledge system budget at ${percentage}%, prioritizing local models`
    });
  }
}
```

---

## Scaling Guidelines

### 1. When to Scale

Scale the knowledge system when you observe:

| Metric | Current Value | Scale Trigger | Scale Type |
|--------|---------------|---------------|-----------|
| Inference requests/min | <100 | >500 | Horizontal (add inference workers) |
| Vector searches/min | <50 | >200 | Vertical (increase Qdrant resources) |
| Knowledge items | <10,000 | >50,000 | Horizontal (shard Qdrant) |
| Embedding queue depth | <10 | >100 | Horizontal (add workers) |
| SQLite queries/sec | <100 | >500 | Migrate to PostgreSQL |
| Monthly inference cost | <$5 | >$7 | Review caching strategy |

### 2. Horizontal Scaling

#### Inference Workers

Use a job queue for distributed inference:

```javascript
// src/workers/inference-worker.js
const Queue = require('bull');
const inferenceQueue = new Queue('inference', {
  redis: { host: 'localhost', port: 6379 }
});

// Worker process
inferenceQueue.process(async (job) => {
  const { prompt, options } = job.data;
  const result = await unifiedInferenceEngine.infer(prompt, options);
  return result;
});

// Main process
async function queueInference(prompt, options) {
  const job = await inferenceQueue.add({ prompt, options }, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 }
  });
  return job.finished();
}
```

Deploy multiple workers:

```bash
# docker-compose.yml
services:
  inference-worker-1:
    image: knowledge-system:latest
    command: node src/workers/inference-worker.js
    environment:
      - WORKER_ID=1

  inference-worker-2:
    image: knowledge-system:latest
    command: node src/workers/inference-worker.js
    environment:
      - WORKER_ID=2

  inference-worker-3:
    image: knowledge-system:latest
    command: node src/workers/inference-worker.js
    environment:
      - WORKER_ID=3
```

#### Qdrant Sharding

For >100,000 knowledge items, implement sharding:

```javascript
// Shard by knowledge type
const shardConfig = {
  'coding_pattern': 'qdrant-shard-1:6333',
  'bug_solution': 'qdrant-shard-1:6333',
  'test_strategy': 'qdrant-shard-2:6333',
  'architectural_decision': 'qdrant-shard-2:6333',
  'deployment_approach': 'qdrant-shard-3:6333'
};

function getQdrantClient(knowledgeType) {
  const endpoint = shardConfig[knowledgeType] || 'qdrant-shard-1:6333';
  return new QdrantClient({ url: `http://${endpoint}` });
}
```

### 3. Vertical Scaling

#### Qdrant Resource Allocation

Scale Qdrant resources based on collection size:

| Collection Size | vCPUs | RAM | Disk |
|----------------|-------|-----|------|
| <10,000 items | 2 | 4GB | 20GB |
| 10,000-50,000 | 4 | 8GB | 50GB |
| 50,000-100,000 | 8 | 16GB | 100GB |
| >100,000 | 16 | 32GB | 200GB |

Update `docker-compose.yml`:

```yaml
services:
  qdrant:
    image: qdrant/qdrant:latest
    deploy:
      resources:
        limits:
          cpus: '8'
          memory: 16G
        reservations:
          cpus: '4'
          memory: 8G
    volumes:
      - qdrant_data:/qdrant/storage
```

### 4. Database Migration (SQLite → PostgreSQL)

Migrate to PostgreSQL when:
- Query load exceeds 500 queries/second
- Database size exceeds 1GB
- Need for replication/high availability

Migration script:

```bash
#!/bin/bash
# /scripts/migrate-sqlite-to-postgres.sh

SQLITE_DB="/var/lib/knowledge/analytics.db"
PG_CONNECTION="postgresql://user:pass@localhost:5432/knowledge"

# Export SQLite schema
sqlite3 "$SQLITE_DB" .schema > schema.sql

# Convert SQLite schema to PostgreSQL
sed -i 's/AUTOINCREMENT/SERIAL/g' schema.sql
sed -i 's/INTEGER PRIMARY KEY/SERIAL PRIMARY KEY/g' schema.sql

# Create PostgreSQL schema
psql "$PG_CONNECTION" -f schema.sql

# Export data from SQLite
sqlite3 "$SQLITE_DB" -csv -header "SELECT * FROM knowledge_items;" > knowledge_items.csv
sqlite3 "$SQLITE_DB" -csv -header "SELECT * FROM cost_tracking;" > cost_tracking.csv

# Import into PostgreSQL
psql "$PG_CONNECTION" -c "\\copy knowledge_items FROM 'knowledge_items.csv' CSV HEADER"
psql "$PG_CONNECTION" -c "\\copy cost_tracking FROM 'cost_tracking.csv' CSV HEADER"

# Verify row counts
echo "Verifying migration..."
sqlite3 "$SQLITE_DB" "SELECT COUNT(*) FROM knowledge_items;"
psql "$PG_CONNECTION" -t -c "SELECT COUNT(*) FROM knowledge_items;"
```

---

## Disaster Recovery

### 1. Recovery Time Objective (RTO) and Recovery Point Objective (RPO)

| Component | RTO | RPO | Recovery Strategy |
|-----------|-----|-----|-------------------|
| SQLite Database | 30 minutes | 24 hours | Daily backups, restore from S3 |
| Qdrant Collections | 1 hour | 24 hours | Daily snapshots, rebuild from backup |
| Inference Engine | 5 minutes | 0 (stateless) | Restart containers/processes |
| Configuration | 5 minutes | 0 | Version controlled, redeploy |

### 2. Disaster Recovery Procedures

#### Full System Recovery

```bash
#!/bin/bash
# /scripts/disaster-recovery.sh

set -e

BACKUP_DATE=$1  # Format: YYYYMMDD_HHMMSS
BACKUP_DIR="/var/backups/knowledge-system"
RECOVERY_DIR="/var/lib/knowledge"

echo "Starting disaster recovery for backup: $BACKUP_DATE"

# 1. Stop all services
echo "Stopping services..."
docker-compose down
systemctl stop knowledge-system

# 2. Clear existing data
echo "Clearing existing data..."
rm -rf "$RECOVERY_DIR"/*
mkdir -p "$RECOVERY_DIR"

# 3. Restore SQLite database
echo "Restoring SQLite database..."
gunzip -c "$BACKUP_DIR/analytics_$BACKUP_DATE.db.gz" > "$RECOVERY_DIR/analytics.db"

# Verify SQLite integrity
sqlite3 "$RECOVERY_DIR/analytics.db" "PRAGMA integrity_check;" | grep -q "ok" || {
  echo "ERROR: SQLite database integrity check failed"
  exit 1
}

# 4. Restore Qdrant data
echo "Restoring Qdrant data..."
tar xzf "$BACKUP_DIR/qdrant_$BACKUP_DATE.tar.gz" -C /var/lib/qdrant/storage/

# 5. Restore configuration
echo "Restoring configuration..."
tar xzf "$BACKUP_DIR/config_$BACKUP_DATE.tar.gz" -C /

# 6. Restart services
echo "Starting services..."
docker-compose up -d qdrant
sleep 10  # Wait for Qdrant to start

systemctl start knowledge-system

# 7. Verify services
echo "Verifying services..."
curl -f http://localhost:6333/healthz || {
  echo "ERROR: Qdrant health check failed"
  exit 1
}

curl -f http://localhost:3000/health || {
  echo "ERROR: Knowledge system health check failed"
  exit 1
}

# 8. Smoke test
echo "Running smoke tests..."
node /scripts/smoke-test.js || {
  echo "ERROR: Smoke tests failed"
  exit 1
}

echo "Disaster recovery completed successfully!"
echo "Recovered from backup: $BACKUP_DATE"
```

#### Partial Recovery (Qdrant Only)

```bash
#!/bin/bash
# /scripts/recover-qdrant.sh

BACKUP_DATE=$1
BACKUP_DIR="/var/backups/knowledge-system"

# Stop Qdrant
docker-compose stop qdrant

# Restore Qdrant data
rm -rf /var/lib/qdrant/storage/*
tar xzf "$BACKUP_DIR/qdrant_$BACKUP_DATE.tar.gz" -C /var/lib/qdrant/storage/

# Start Qdrant
docker-compose up -d qdrant

# Wait and verify
sleep 10
curl -f http://localhost:6333/collections/knowledge_384
```

### 3. Data Corruption Recovery

If Qdrant collection is corrupted:

```bash
#!/bin/bash
# /scripts/rebuild-qdrant-from-sqlite.sh

echo "Rebuilding Qdrant collections from SQLite..."

# Extract knowledge items from SQLite
sqlite3 /var/lib/knowledge/analytics.db <<EOF
.mode json
.output /tmp/knowledge_items.json
SELECT id, type, content, embedding_384, embedding_1536, metadata
FROM knowledge_items;
EOF

# Recreate Qdrant collections
curl -X DELETE 'http://localhost:6333/collections/knowledge_384'
curl -X DELETE 'http://localhost:6333/collections/knowledge_1536'

# Create collections with proper schema
node /scripts/initialize-qdrant.js

# Re-import vectors
node /scripts/import-vectors-from-json.js /tmp/knowledge_items.json

echo "Qdrant rebuild completed"
```

### 4. Backup Verification

Regularly test backup restores:

```bash
#!/bin/bash
# /scripts/verify-backups.sh

BACKUP_DATE=$(ls /var/backups/knowledge-system/analytics_*.db.gz | tail -1 | grep -oP '\d{8}_\d{6}')

# Create test environment
docker run -d --name test-restore -v test-restore:/data alpine sleep 3600

# Restore backup to test environment
gunzip -c "/var/backups/knowledge-system/analytics_$BACKUP_DATE.db.gz" > /tmp/test_restore.db

# Verify integrity
sqlite3 /tmp/test_restore.db "PRAGMA integrity_check;" | grep -q "ok" || {
  echo "FAIL: Backup verification failed for $BACKUP_DATE"
  exit 1
}

# Verify row counts
ORIGINAL_COUNT=$(sqlite3 /var/lib/knowledge/analytics.db "SELECT COUNT(*) FROM knowledge_items;")
BACKUP_COUNT=$(sqlite3 /tmp/test_restore.db "SELECT COUNT(*) FROM knowledge_items;")

if [ "$ORIGINAL_COUNT" -ne "$BACKUP_COUNT" ]; then
  echo "FAIL: Row count mismatch (original: $ORIGINAL_COUNT, backup: $BACKUP_COUNT)"
  exit 1
fi

# Cleanup
rm /tmp/test_restore.db
docker rm -f test-restore

echo "PASS: Backup verification successful for $BACKUP_DATE"
```

---

## Performance Tuning

### 1. Inference Engine Optimization

#### Provider Selection Strategy

Optimize provider selection based on cost and latency:

```javascript
// config/provider-strategy.json
{
  "strategies": {
    "cost-optimized": {
      "priority": ["local", "groq", "gemini", "openai", "anthropic"],
      "cacheAggressive": true,
      "batchWhenPossible": true
    },
    "latency-optimized": {
      "priority": ["groq", "local", "gemini", "openai", "anthropic"],
      "cacheAggressive": false,
      "parallelRequests": true
    },
    "quality-optimized": {
      "priority": ["anthropic", "openai", "groq", "local"],
      "retryOnLowConfidence": true,
      "ensembleVoting": true
    }
  },
  "activeStrategy": "cost-optimized"
}
```

#### Circuit Breaker Tuning

Adjust circuit breaker parameters based on observed failure rates:

```javascript
// Recommended settings by provider
const circuitBreakerConfig = {
  groq: {
    failureThreshold: 5,      // Groq is generally reliable
    resetTimeout: 60000,      // 1 minute
    halfOpenRequests: 3
  },
  openrouter: {
    failureThreshold: 3,      // More sensitive
    resetTimeout: 120000,     // 2 minutes
    halfOpenRequests: 2
  },
  local: {
    failureThreshold: 10,     // Very lenient for local
    resetTimeout: 30000,      // 30 seconds
    halfOpenRequests: 5
  }
};
```

### 2. Vector Search Optimization

#### HNSW Parameter Tuning

Optimize HNSW parameters for your workload:

```javascript
// For <10,000 items (favor accuracy)
const hnswConfigSmall = {
  m: 16,                  // Number of connections per node
  ef_construct: 200,      // Construction quality
  full_scan_threshold: 10000
};

// For 10,000-100,000 items (balanced)
const hnswConfigMedium = {
  m: 32,
  ef_construct: 128,
  full_scan_threshold: 20000
};

// For >100,000 items (favor speed)
const hnswConfigLarge = {
  m: 48,
  ef_construct: 100,
  full_scan_threshold: 50000
};
```

#### Query Optimization

Optimize search queries:

```javascript
// Use appropriate vector dimension based on accuracy needs
async function optimizedSearch(query, options = {}) {
  const useHighAccuracy = options.accuracy === 'high' ||
                          options.criticalSearch === true;

  const dimension = useHighAccuracy ? 1536 : 384;
  const collection = `knowledge_${dimension}`;

  // Adjust search parameters based on collection size
  const collectionInfo = await qdrant.getCollection(collection);
  const itemCount = collectionInfo.points_count;

  const searchParams = {
    hnsw_ef: itemCount < 10000 ? 128 : 64,  // Higher for small collections
    exact: itemCount < 1000                  // Exact search for very small
  };

  return await qdrant.search(collection, {
    vector: await generateEmbedding(query, dimension),
    limit: options.limit || 10,
    params: searchParams,
    score_threshold: options.threshold || 0.7
  });
}
```

### 3. Caching Strategy

#### Multi-Level Cache

Implement L1 (memory) and L2 (Redis) caching:

```javascript
// src/cache/multi-level-cache.js
class MultiLevelCache {
  constructor() {
    this.l1 = new LRU({ max: 1000, ttl: 3600000 });  // 1 hour
    this.l2 = new RedisCache({ ttl: 86400000 });     // 24 hours
  }

  async get(key) {
    // Try L1 first
    let value = this.l1.get(key);
    if (value) {
      this.metrics.l1Hits++;
      return value;
    }

    // Try L2
    value = await this.l2.get(key);
    if (value) {
      this.metrics.l2Hits++;
      this.l1.set(key, value);  // Promote to L1
      return value;
    }

    this.metrics.misses++;
    return null;
  }

  async set(key, value, ttl) {
    this.l1.set(key, value);
    await this.l2.set(key, value, ttl);
  }
}
```

#### Cache Warming

Proactively warm cache during off-peak hours:

```javascript
// /scripts/cache-warming.js
const topQueries = await db.prepare(`
  SELECT query, COUNT(*) as frequency
  FROM search_logs
  WHERE created_at >= datetime('now', '-7 days')
  GROUP BY query
  ORDER BY frequency DESC
  LIMIT 100
`).all();

for (const { query } of topQueries) {
  await knowledgeRetriever.search(query, { warmCache: true });
}
```

### 4. Database Query Optimization

#### SQLite Indexing Strategy

Add indices for common query patterns:

```sql
-- Composite index for type + confidence queries
CREATE INDEX IF NOT EXISTS idx_type_confidence
ON knowledge_items(type, confidence DESC, created_at DESC);

-- Index for temporal queries
CREATE INDEX IF NOT EXISTS idx_created_at
ON knowledge_items(created_at DESC);

-- Index for cost tracking queries
CREATE INDEX IF NOT EXISTS idx_cost_provider_date
ON cost_tracking(provider, created_at DESC);

-- Covering index for common analytics query
CREATE INDEX IF NOT EXISTS idx_cost_analytics
ON cost_tracking(provider, operation, created_at)
INCLUDE (cost, tokens);
```

#### Query Analysis

Use `EXPLAIN QUERY PLAN` to optimize slow queries:

```sql
-- Check query plan
EXPLAIN QUERY PLAN
SELECT * FROM knowledge_items
WHERE type = 'coding_pattern'
  AND confidence > 0.7
ORDER BY created_at DESC
LIMIT 10;

-- Should use index, look for "SCAN" in output
```

---

## Troubleshooting Production Issues

### 1. High Latency Debugging

#### Latency Breakdown

Add request tracing:

```javascript
// src/monitoring/request-tracer.js
class RequestTracer {
  async trace(operation, fn) {
    const startTime = Date.now();
    const trace = {
      operation,
      spans: []
    };

    try {
      const result = await fn({
        addSpan: (name, data) => {
          trace.spans.push({
            name,
            timestamp: Date.now() - startTime,
            data
          });
        }
      });

      trace.duration = Date.now() - startTime;
      trace.status = 'success';

      // Log slow requests
      if (trace.duration > 2000) {
        console.warn('Slow request detected:', JSON.stringify(trace, null, 2));
      }

      return result;
    } catch (error) {
      trace.duration = Date.now() - startTime;
      trace.status = 'error';
      trace.error = error.message;
      throw error;
    }
  }
}

// Usage
await tracer.trace('knowledge-search', async ({ addSpan }) => {
  addSpan('generate-embedding');
  const embedding = await generateEmbedding(query);

  addSpan('vector-search');
  const results = await qdrant.search(embedding);

  addSpan('rank-results');
  return rankResults(results);
});
```

#### Common Latency Issues

| Symptom | Likely Cause | Solution |
|---------|-------------|----------|
| Slow embedding generation | API timeout or network issues | Check API endpoint, increase timeout, use local embeddings |
| Slow vector search | Missing HNSW index | Rebuild index, check optimizer status |
| Slow inference | Circuit breaker open or provider down | Check provider status, verify API keys |
| Intermittent slowness | Resource contention or memory pressure | Check system resources, increase limits |

### 2. Memory Leak Detection

Monitor memory growth:

```javascript
// src/monitoring/memory-monitor.js
const memoryMonitor = setInterval(() => {
  const usage = process.memoryUsage();

  console.log({
    timestamp: new Date().toISOString(),
    heapUsed: Math.round(usage.heapUsed / 1024 / 1024) + 'MB',
    heapTotal: Math.round(usage.heapTotal / 1024 / 1024) + 'MB',
    external: Math.round(usage.external / 1024 / 1024) + 'MB',
    rss: Math.round(usage.rss / 1024 / 1024) + 'MB'
  });

  // Alert if heap usage exceeds 1GB
  if (usage.heapUsed > 1024 * 1024 * 1024) {
    console.error('High memory usage detected, taking heap snapshot');
    const heapdump = require('heapdump');
    heapdump.writeSnapshot(`/tmp/heapdump-${Date.now()}.heapsnapshot`);
  }
}, 60000);  // Every minute
```

Analyze with Chrome DevTools:
1. Load heap snapshot in Chrome DevTools
2. Look for objects with increasing retention size
3. Check for event listener leaks
4. Verify cache size limits are enforced

### 3. Circuit Breaker Issues

Debug circuit breaker state:

```bash
#!/bin/bash
# /scripts/debug-circuit-breaker.sh

curl http://localhost:3000/internal/circuit-breaker/status | jq '.'

# Output:
# {
#   "groq": {
#     "state": "open",
#     "failures": 5,
#     "lastFailure": "2025-10-19T10:30:00Z",
#     "nextAttempt": "2025-10-19T10:31:00Z"
#   },
#   "openrouter": {
#     "state": "closed",
#     "failures": 0
#   }
# }
```

Force circuit breaker reset:

```bash
curl -X POST http://localhost:3000/internal/circuit-breaker/reset/groq
```

### 4. Database Connection Issues

#### Qdrant Connection Debugging

```bash
# Check Qdrant is running
docker ps | grep qdrant

# Check Qdrant logs
docker logs qdrant --tail 100

# Test Qdrant connection
curl http://localhost:6333/collections

# Check collection health
curl http://localhost:6333/collections/knowledge_384
```

#### SQLite Lock Debugging

```javascript
// Enable WAL mode to reduce lock contention
const db = new Database('/var/lib/knowledge/analytics.db');
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');  // 5 second timeout

// Check for long-running transactions
db.prepare('SELECT * FROM pragma_wal_checkpoint(TRUNCATE)').all();
```

---

## Incident Response Procedures

### 1. Severity Levels

| Level | Definition | Response Time | Escalation |
|-------|-----------|---------------|-----------|
| P1 - Critical | Complete service outage | 15 minutes | Immediate page on-call engineer |
| P2 - High | Partial service degradation | 1 hour | Alert ops team during business hours |
| P3 - Medium | Performance degradation | 4 hours | Create ticket, address next business day |
| P4 - Low | Minor issues, no user impact | 1 business day | Regular maintenance window |

### 2. Incident Response Workflow

#### P1 - Complete Service Outage

```bash
#!/bin/bash
# /runbooks/p1-service-outage.sh

echo "=== P1 INCIDENT RESPONSE ==="
echo "Starting at: $(date)"

# 1. Gather initial information
echo "1. Checking service health..."
systemctl status knowledge-system
docker ps | grep -E "qdrant|knowledge"

# 2. Check recent logs
echo "2. Recent errors in logs..."
journalctl -u knowledge-system -n 100 --no-pager | grep -i error

# 3. Check dependencies
echo "3. Checking dependencies..."
curl -f http://localhost:6333/healthz || echo "Qdrant is DOWN"
ping -c 3 api.groq.com || echo "Groq API unreachable"

# 4. Attempt automatic recovery
echo "4. Attempting automatic recovery..."
systemctl restart knowledge-system
docker restart qdrant

# Wait 30 seconds
sleep 30

# 5. Verify recovery
echo "5. Verifying recovery..."
curl -f http://localhost:3000/health || {
  echo "FAILED: Service did not recover"
  echo "Escalating to on-call engineer"
  # Send PagerDuty alert
  exit 1
}

echo "SUCCESS: Service recovered"
echo "Completed at: $(date)"
```

#### P2 - Degraded Performance

```bash
#!/bin/bash
# /runbooks/p2-performance-degradation.sh

echo "=== P2 INCIDENT RESPONSE ==="

# 1. Identify bottleneck
echo "1. Checking performance metrics..."
curl http://localhost:3000/metrics | grep latency

# 2. Check resource usage
echo "2. System resource usage..."
docker stats --no-stream
free -h
df -h

# 3. Check for high-cost operations
echo "3. Recent expensive operations..."
sqlite3 /var/lib/knowledge/analytics.db "
  SELECT operation, AVG(cost) as avg_cost, COUNT(*) as count
  FROM cost_tracking
  WHERE created_at >= datetime('now', '-1 hour')
  GROUP BY operation
  ORDER BY avg_cost DESC
  LIMIT 10;
"

# 4. Apply mitigation
echo "4. Applying performance mitigations..."

# Clear cache if hit rate is low
CACHE_HIT_RATE=$(curl -s http://localhost:3000/metrics | grep cache_hit_rate | awk '{print $2}')
if (( $(echo "$CACHE_HIT_RATE < 0.3" | bc -l) )); then
  echo "Low cache hit rate ($CACHE_HIT_RATE), warming cache..."
  node /scripts/warm-cache.js
fi

# Switch to faster embedding model if queue is backed up
QUEUE_DEPTH=$(curl -s http://localhost:3000/metrics | grep embedding_queue_depth | awk '{print $2}')
if [ "$QUEUE_DEPTH" -gt 100 ]; then
  echo "High queue depth ($QUEUE_DEPTH), switching to 384-dim embeddings..."
  curl -X POST http://localhost:3000/config -d '{"defaultEmbeddingDim": 384}'
fi
```

### 3. Post-Incident Review Template

Create `/incidents/YYYY-MM-DD-incident-report.md`:

```markdown
# Incident Report: [Brief Description]

**Date**: YYYY-MM-DD
**Severity**: P1/P2/P3/P4
**Duration**: HH:MM
**Status**: Resolved/Investigating

## Summary

Brief description of the incident and its impact.

## Timeline

| Time | Event |
|------|-------|
| 10:00 | Incident detected via alert |
| 10:05 | On-call engineer paged |
| 10:15 | Root cause identified |
| 10:30 | Mitigation applied |
| 10:45 | Service restored |

## Root Cause

Detailed explanation of what caused the incident.

## Impact

- Users affected: X
- Services impacted: Knowledge extraction, vector search
- Revenue impact: $X
- Data loss: None/Describe

## Resolution

Steps taken to resolve the incident.

## Action Items

- [ ] Implement monitoring for X metric
- [ ] Add retry logic for Y operation
- [ ] Update runbook with new procedure
- [ ] Increase resources for Z component

## Lessons Learned

What went well and what could be improved.
```

---

## Operational Runbooks

### Runbook 1: Monthly Cost Reset

```bash
#!/bin/bash
# /runbooks/monthly-cost-reset.sh

# Run on 1st of every month
echo "Performing monthly cost reset..."

# Archive previous month's data
LAST_MONTH=$(date -d "last month" +%Y-%m)
sqlite3 /var/lib/knowledge/analytics.db "
  CREATE TABLE IF NOT EXISTS cost_archive_$LAST_MONTH AS
  SELECT * FROM cost_tracking
  WHERE strftime('%Y-%m', created_at) = '$LAST_MONTH';
"

# Clear current month tracking
sqlite3 /var/lib/knowledge/analytics.db "
  DELETE FROM cost_tracking
  WHERE strftime('%Y-%m', created_at) = '$LAST_MONTH';
"

# Reset budget tracker
curl -X POST http://localhost:3000/internal/budget/reset

# Generate monthly report
node /scripts/generate-monthly-report.js --month="$LAST_MONTH"

echo "Monthly cost reset completed"
```

### Runbook 2: Emergency Budget Freeze

```bash
#!/bin/bash
# /runbooks/emergency-budget-freeze.sh

# Run when budget is exhausted unexpectedly
echo "Activating emergency budget freeze..."

# Switch to local-only mode
curl -X POST http://localhost:3000/config -d '{
  "inference": {
    "providerPriority": ["local"],
    "offlineMode": true
  }
}'

# Send notifications
curl -X POST https://hooks.slack.com/services/YOUR/WEBHOOK/URL \
  -H 'Content-Type: application/json' \
  -d '{
    "text": "⚠️ EMERGENCY: Knowledge system budget freeze activated. Switched to local-only mode.",
    "channel": "#ops-critical"
  }'

# Log incident
echo "$(date): Emergency budget freeze activated" >> /var/log/knowledge-incidents.log

# Create incident report
cat > "/incidents/$(date +%Y-%m-%d)-budget-freeze.md" <<EOF
# Budget Freeze Incident

**Date**: $(date)
**Severity**: P2
**Action**: Switched to local-only inference mode

## Next Steps
1. Review cost spike in last 24 hours
2. Identify expensive operations
3. Adjust budget or optimize usage
4. Re-enable remote providers when safe
EOF

echo "Emergency budget freeze completed"
```

### Runbook 3: Qdrant Index Rebuild

```bash
#!/bin/bash
# /runbooks/rebuild-qdrant-index.sh

COLLECTION=$1  # knowledge_384 or knowledge_1536

echo "Rebuilding Qdrant index for $COLLECTION..."

# 1. Create snapshot
echo "Creating snapshot..."
curl -X POST "http://localhost:6333/collections/$COLLECTION/snapshots"

# 2. Check current optimizer status
echo "Current optimizer status:"
curl "http://localhost:6333/collections/$COLLECTION" | jq '.result.optimizer_status'

# 3. Force optimization
echo "Forcing optimization..."
curl -X POST "http://localhost:6333/collections/$COLLECTION/optimizers" \
  -H 'Content-Type: application/json' \
  -d '{
    "optimizers_config": {
      "indexing_threshold": 0,
      "memmap_threshold": 0
    }
  }'

# 4. Monitor optimization progress
echo "Monitoring optimization progress..."
while true; do
  STATUS=$(curl -s "http://localhost:6333/collections/$COLLECTION" | jq -r '.result.optimizer_status.ok')
  if [ "$STATUS" = "true" ]; then
    echo "Optimization completed"
    break
  fi
  echo "Still optimizing..."
  sleep 10
done

# 5. Verify index performance
echo "Testing search performance..."
LATENCY=$(curl -w '%{time_total}' -o /dev/null -s -X POST \
  "http://localhost:6333/collections/$COLLECTION/points/search" \
  -H 'Content-Type: application/json' \
  -d '{
    "vector": [0.1, 0.2, 0.3, ...],
    "limit": 10
  }')

echo "Search latency: ${LATENCY}s"

if (( $(echo "$LATENCY > 0.5" | bc -l) )); then
  echo "WARNING: Search latency still high after rebuild"
else
  echo "SUCCESS: Index rebuild completed successfully"
fi
```

---

## Production Checklist

### Pre-Deployment Checklist

- [ ] All tests passing (unit, integration, E2E)
- [ ] Performance benchmarks meet targets
- [ ] Security scan completed (no critical vulnerabilities)
- [ ] Database migrations tested on staging
- [ ] Backup and restore procedures verified
- [ ] Monitoring and alerting configured
- [ ] Runbooks updated with new procedures
- [ ] On-call rotation notified of deployment
- [ ] Rollback plan documented and tested
- [ ] Resource limits appropriate for expected load

### Post-Deployment Checklist

- [ ] Health checks passing
- [ ] No error spikes in logs
- [ ] Metrics within expected ranges
- [ ] Cache hit rate >40%
- [ ] Inference latency <2s p95
- [ ] Vector search <500ms p95
- [ ] No circuit breakers open
- [ ] Budget tracking operational
- [ ] Knowledge extraction working
- [ ] No memory leaks detected

### Weekly Operational Checklist

- [ ] Review weekly cost report
- [ ] Check backup integrity
- [ ] Review performance trends
- [ ] Update Grafana dashboards
- [ ] Review incident reports
- [ ] Update runbooks if needed
- [ ] Check for software updates
- [ ] Review and tune alert thresholds

### Monthly Operational Checklist

- [ ] Cost reset and archival
- [ ] Database optimization (VACUUM, REINDEX)
- [ ] Qdrant index rebuild
- [ ] Review and renew SSL certificates
- [ ] Security patch review and application
- [ ] Capacity planning review
- [ ] Update disaster recovery documentation
- [ ] Test backup restore procedure
- [ ] Review and update SLAs
- [ ] Conduct post-incident reviews

---

**Document Version**: 1.0
**Last Updated**: 2025-10-19
**Next Review**: 2025-11-19
**Owner**: DevOps Team
