# Ontology Integration System - Migration Guide

## Table of Contents

1. [Overview](#overview)
2. [Pre-Migration Checklist](#pre-migration-checklist)
3. [Phased Rollout Strategy](#phased-rollout-strategy)
4. [Phase 1: Enable Alongside Existing System](#phase-1-enable-alongside-existing-system)
5. [Phase 2: Monitor and Tune](#phase-2-monitor-and-tune)
6. [Phase 3: Full Integration](#phase-3-full-integration)
7. [Rollback Procedures](#rollback-procedures)
8. [Backward Compatibility](#backward-compatibility)
9. [Monitoring and Metrics](#monitoring-and-metrics)
10. [Team-Specific Deployment](#team-specific-deployment)
11. [Troubleshooting Common Issues](#troubleshooting-common-issues)

## Overview

This guide provides a safe, phased approach to deploying the Ontology Integration System to production environments. The system is designed for **zero-downtime deployment** with **graceful degradation** and **easy rollback**.

### Key Principles

- **Non-Breaking**: Ontology system is completely optional
- **Backward Compatible**: Existing functionality works unchanged when ontology disabled
- **Gradual Rollout**: Enable per team, monitor, then expand
- **Safe Rollback**: Disable via configuration, no data migration needed
- **Continuous Monitoring**: Track metrics at every phase

### Migration Timeline

| Phase | Duration | Activities | Success Criteria |
|-------|----------|-----------|------------------|
| Phase 1 | 1 week | Enable with ontology disabled, deploy infrastructure | No errors, infrastructure stable |
| Phase 2 | 2-3 weeks | Enable for pilot team (ReSi), monitor, tune | >85% classification accuracy, <500ms p95 latency |
| Phase 3 | 2-3 weeks | Enable for remaining teams, full integration | All teams onboarded, metrics healthy |

**Total Timeline**: 5-7 weeks for full production rollout

## Pre-Migration Checklist

### Infrastructure Requirements

- [ ] **Node.js**: >= 16.0.0 installed on all environments
- [ ] **TypeScript**: 5.x available for builds
- [ ] **Disk Space**: 100MB for ontology files and cache
- [ ] **Memory**: 50MB additional heap for cached ontologies
- [ ] **LLM Provider** (optional): API keys for Anthropic/OpenAI/Groq/Google if using LLM classification

### Ontology Files

- [ ] **Upper Ontology**: Created and validated at `.data/ontologies/upper/cluster-reprocessing-ontology.json`
- [ ] **Lower Ontologies**: Created for each team:
  - `.data/ontologies/lower/coding-ontology.json`
  - `.data/ontologies/lower/raas-ontology.json`
  - `.data/ontologies/lower/resi-ontology.json`
  - `.data/ontologies/lower/agentic-ontology.json`
  - `.data/ontologies/lower/ui-ontology.json`
- [ ] **Schema**: Ontology JSON schema at `.data/ontologies/schemas/ontology-schema.json`
- [ ] **Validation**: All ontology files validated against schema

### Configuration

- [ ] **Default Config**: `config/knowledge-management.json` updated with ontology section
- [ ] **Team Configs**: Team-specific configs created in `config/teams/`
- [ ] **Environment Variables**: LLM API keys configured (if using LLM classification)
- [ ] **Feature Flags**: Ontology enabled flag set to `false` initially

### Testing

- [ ] **Unit Tests**: All 129 tests passing
- [ ] **Integration Tests**: 14 integration tests passing
- [ ] **Performance Tests**: 9 performance tests passing with requirements met
- [ ] **Staging Environment**: Full test suite passed in staging

### Monitoring

- [ ] **Metrics Endpoints**: `/metrics` endpoint configured for Prometheus
- [ ] **Logging**: Structured logging enabled for ontology operations
- [ ] **Alerting**: Alerts configured for classification failures, high latency
- [ ] **Dashboards**: Grafana dashboards imported for ontology metrics

### Team Communication

- [ ] **Stakeholders Notified**: All teams informed of upcoming deployment
- [ ] **Documentation Shared**: User guide and API docs distributed
- [ ] **Training Sessions**: Scheduled for teams using ontology features
- [ ] **Support Plan**: On-call rotation established for migration period

## Phased Rollout Strategy

### Strategy Overview

```text
┌─────────────────────────────────────────────────────────────┐
│                   Phased Rollout Strategy                    │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Phase 1: Deploy Infrastructure (Week 1)                    │
│  ┌────────────────────────────────────────┐                │
│  │ • Deploy code with ontology disabled    │                │
│  │ • Verify existing functionality intact  │                │
│  │ • Validate ontology files load          │                │
│  │ • Run smoke tests                       │                │
│  └────────────────────────────────────────┘                │
│                       ↓                                      │
│  Phase 2: Pilot Team (Weeks 2-4)                           │
│  ┌────────────────────────────────────────┐                │
│  │ • Enable for ReSi team only             │                │
│  │ • Monitor classification accuracy       │                │
│  │ • Tune heuristics and confidence        │                │
│  │ • Collect feedback from team            │                │
│  └────────────────────────────────────────┘                │
│                       ↓                                      │
│  Phase 3: Full Rollout (Weeks 5-7)                         │
│  ┌────────────────────────────────────────┐                │
│  │ Week 5: Enable RaaS team                │                │
│  │ Week 6: Enable Coding, Agentic, UI      │                │
│  │ Week 7: Monitor all teams, full rollout │                │
│  └────────────────────────────────────────┘                │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Why This Approach?

1. **Risk Mitigation**: Infrastructure deployed but inactive, minimizes risk
2. **Early Feedback**: Pilot team (ReSi) provides real-world data
3. **Iterative Tuning**: Adjust heuristics and thresholds based on pilot
4. **Controlled Expansion**: One team at a time reduces blast radius
5. **Easy Rollback**: Each phase can be rolled back independently

## Phase 1: Enable Alongside Existing System

**Duration**: 1 week
**Goal**: Deploy infrastructure without changing behavior

### Step 1.1: Deploy to Staging

```bash
# 1. Check out release branch
git checkout release/ontology-v1.0.0

# 2. Run full test suite
npm test
npm run test:coverage

# 3. Build for production
npm run build

# 4. Deploy to staging
./deploy.sh staging

# 5. Verify deployment
curl https://staging.example.com/health
curl https://staging.example.com/metrics | grep ontology
```

### Step 1.2: Configuration (Disabled)

Update `config/knowledge-management.json` on all environments:

```json
{
  "ontology": {
    "enabled": false,  // CRITICAL: Disabled in Phase 1
    "upperOntologyPath": ".data/ontologies/upper/cluster-reprocessing-ontology.json",
    "confidenceThreshold": 0.7,
    "validation": {
      "enabled": true,
      "mode": "lenient"
    },
    "caching": {
      "enabled": true,
      "ttl": 3600000,
      "maxSize": 1000
    },
    "classification": {
      "enableHeuristics": true,
      "enableLLM": false,
      "batchSize": 10,
      "heuristicThreshold": 0.8
    }
  }
}
```

### Step 1.3: Verify Backward Compatibility

Run these tests to ensure existing functionality unchanged:

```bash
# 1. Knowledge extraction still works
curl -X POST https://staging.example.com/api/knowledge/extract \
  -H "Content-Type: application/json" \
  -d '{"content": "Test knowledge extraction"}'

# Expected: Success, no ontology metadata added

# 2. Knowledge retrieval still works
curl https://staging.example.com/api/knowledge?limit=10

# Expected: Returns knowledge without ontology filtering

# 3. Existing tests pass
npm test

# Expected: All 129 tests pass
```

### Step 1.4: Validate Ontology Files Load

Test that ontology files are valid and loadable:

```bash
# Create test script: scripts/validate-ontologies.js
node scripts/validate-ontologies.js

# Expected output:
# ✓ Upper ontology loaded (25 entities)
# ✓ Lower ontology (Coding) loaded (18 entities)
# ✓ Lower ontology (RaaS) loaded (15 entities)
# ✓ Lower ontology (ReSi) loaded (18 entities)
# ✓ Lower ontology (Agentic) loaded (15 entities)
# ✓ Lower ontology (UI) loaded (18 entities)
# ✓ All ontologies valid
```

### Step 1.5: Deploy to Production

```bash
# 1. Deploy to production (ontology still disabled)
./deploy.sh production

# 2. Verify health
curl https://api.example.com/health

# 3. Monitor for 24 hours
# - No errors in logs
# - Latency unchanged
# - Memory usage stable
```

### Phase 1 Success Criteria

- [ ] Code deployed to production successfully
- [ ] No errors or warnings in logs
- [ ] All existing tests passing
- [ ] Knowledge extraction working normally
- [ ] Latency unchanged (within 5% of baseline)
- [ ] Memory usage stable (within 5MB of baseline)
- [ ] Ontology files validated and loadable
- [ ] Rollback tested and working

## Phase 2: Monitor and Tune

**Duration**: 2-3 weeks
**Goal**: Enable for pilot team (ReSi), tune, and validate

### Step 2.1: Enable for ReSi Team (Week 2)

Create team-specific configuration:

```json
// config/teams/resi.json
{
  "team": "ReSi",
  "ontology": {
    "enabled": true,  // Enable for ReSi only
    "lowerOntologyPath": ".data/ontologies/lower/resi-ontology.json",
    "confidenceThreshold": 0.7,
    "validation": {
      "mode": "lenient"  // Start lenient, move to strict later
    },
    "classification": {
      "enableHeuristics": true,
      "enableLLM": false,  // Start with heuristics only
      "heuristicThreshold": 0.8
    }
  }
}
```

Deploy configuration update:

```bash
# 1. Update ReSi team config
cp config/teams/resi.json /etc/app/config/teams/resi.json

# 2. Restart services (zero-downtime rolling restart)
./restart-services.sh

# 3. Verify ReSi ontology enabled
curl https://api.example.com/api/ontology/status?team=ReSi

# Expected: { "enabled": true, "team": "ReSi", "entities": 18 }
```

### Step 2.2: Monitor Classification (Week 2-3)

Track these metrics for ReSi team:

```bash
# 1. Classification accuracy
# Query Prometheus:
# ontology_classification_total{team="ReSi"}
# ontology_classification_success{team="ReSi"}

# Target: >85% success rate

# 2. Classification latency
# Query Prometheus:
# histogram_quantile(0.95, ontology_classification_duration_seconds{team="ReSi"})

# Target: <500ms p95

# 3. Confidence distribution
# Query Prometheus:
# histogram_quantile(0.50, ontology_classification_confidence{team="ReSi"})

# Target: Median confidence >0.8
```

Create Grafana dashboard for monitoring:

```json
{
  "dashboard": {
    "title": "Ontology - ReSi Pilot",
    "panels": [
      {
        "title": "Classification Success Rate",
        "targets": [
          "rate(ontology_classification_success{team='ReSi'}[5m]) / rate(ontology_classification_total{team='ReSi'}[5m])"
        ]
      },
      {
        "title": "Classification Latency (p95)",
        "targets": [
          "histogram_quantile(0.95, ontology_classification_duration_seconds{team='ReSi'})"
        ]
      },
      {
        "title": "Confidence Distribution",
        "targets": [
          "histogram_quantile(0.50, ontology_classification_confidence{team='ReSi'})",
          "histogram_quantile(0.95, ontology_classification_confidence{team='ReSi'})"
        ]
      }
    ]
  }
}
```

### Step 2.3: Tune and Optimize (Week 3-4)

Based on monitoring data, tune the system:

#### Tune Confidence Thresholds

```javascript
// If too many false negatives (classifications rejected):
{
  "confidenceThreshold": 0.6  // Lower from 0.7
}

// If too many false positives (incorrect classifications):
{
  "confidenceThreshold": 0.85  // Raise from 0.7
}
```

#### Enhance Heuristics

```javascript
// If heuristic accuracy low, add more examples to ontology:
{
  "VirtualTarget": {
    "examples": [
      "Virtual ECU target configuration",
      "Virtual target for sensor fusion",
      // Add more ReSi-specific examples
      "ECU simulation target setup",
      "Virtual target parameters for SOME/IP"
    ]
  }
}
```

#### Enable LLM Fallback (If Needed)

```javascript
// If heuristic accuracy <80%, enable LLM fallback:
{
  "classification": {
    "enableHeuristics": true,
    "enableLLM": true,  // Enable LLM fallback
    "heuristicThreshold": 0.8
  }
}
```

### Step 2.4: Collect Team Feedback

Survey ReSi team after 2 weeks:

1. **Classification Accuracy**: Are entity classes correct?
2. **Missing Entities**: Any entity types not covered?
3. **Validation Issues**: Any false validation errors?
4. **Performance**: Any noticeable slowdowns?
5. **Integration**: Any workflow disruptions?

### Phase 2 Success Criteria

- [ ] Classification accuracy >85% for ReSi team
- [ ] Classification latency p95 <500ms
- [ ] No production incidents related to ontology
- [ ] Positive feedback from ReSi team
- [ ] Heuristics tuned and optimized
- [ ] Confidence thresholds validated
- [ ] Documentation updated based on learnings

## Phase 3: Full Integration

**Duration**: 2-3 weeks
**Goal**: Enable for all teams, full production rollout

### Step 3.1: Enable RaaS Team (Week 5)

```bash
# 1. Create RaaS team configuration
cat > config/teams/raas.json <<EOF
{
  "team": "RaaS",
  "ontology": {
    "enabled": true,
    "lowerOntologyPath": ".data/ontologies/lower/raas-ontology.json",
    "confidenceThreshold": 0.7,
    "validation": {
      "mode": "strict"  // RaaS uses strict validation
    },
    "classification": {
      "enableHeuristics": true,
      "enableLLM": true,  // RaaS uses LLM fallback
      "heuristicThreshold": 0.8
    }
  }
}
EOF

# 2. Deploy RaaS configuration
./deploy-config.sh raas

# 3. Monitor for 1 week
./monitor-team.sh RaaS
```

### Step 3.2: Enable Remaining Teams (Week 6)

Enable Coding, Agentic, and UI teams:

```bash
# Deploy configurations for remaining teams
./deploy-config.sh coding
./deploy-config.sh agentic
./deploy-config.sh ui

# Monitor all teams
./monitor-all-teams.sh
```

### Step 3.3: Enable Mixed Team Mode (Week 7)

Enable cross-team ontology support:

```json
// config/knowledge-management.json
{
  "ontology": {
    "enabled": true,
    "team": "mixed",  // Enable mixed-team support
    "upperOntologyPath": ".data/ontologies/upper/cluster-reprocessing-ontology.json"
  }
}
```

### Step 3.4: Full Production Validation

Run comprehensive production validation:

```bash
# 1. Classification accuracy by team
curl https://api.example.com/api/ontology/metrics/accuracy

# Expected: All teams >85% accuracy

# 2. Performance metrics
curl https://api.example.com/api/ontology/metrics/performance

# Expected: All teams <500ms p95 latency

# 3. Coverage metrics
curl https://api.example.com/api/ontology/metrics/coverage

# Expected: >50% knowledge classified within 2 weeks
```

### Phase 3 Success Criteria

- [ ] All teams enabled and operational
- [ ] Classification accuracy >85% for all teams
- [ ] No performance degradation
- [ ] Mixed-team mode working correctly
- [ ] >50% of knowledge classified
- [ ] All metrics healthy and stable
- [ ] No critical bugs or issues reported

## Rollback Procedures

### Emergency Rollback (Immediate)

If critical issues arise, immediate rollback:

```bash
# 1. Disable ontology system globally
# Update config/knowledge-management.json:
{
  "ontology": {
    "enabled": false  // Disable immediately
  }
}

# 2. Deploy configuration change
./deploy-config.sh --emergency

# 3. Restart services (zero-downtime rolling restart)
./restart-services.sh

# 4. Verify rollback
curl https://api.example.com/api/ontology/status
# Expected: { "enabled": false }

# 5. Monitor for 30 minutes
# - Verify errors stopped
# - Confirm functionality restored
```

**Result**: System returns to pre-ontology behavior immediately. No data loss.

### Team-Specific Rollback

Disable for specific team:

```bash
# 1. Update team configuration
# config/teams/raas.json:
{
  "ontology": {
    "enabled": false  // Disable for RaaS only
  }
}

# 2. Deploy team config
./deploy-config.sh raas

# 3. Verify
curl https://api.example.com/api/ontology/status?team=RaaS
# Expected: { "enabled": false, "team": "RaaS" }
```

### Rollback Testing

Test rollback procedures in staging:

```bash
# 1. Enable ontology in staging
./enable-ontology.sh staging

# 2. Verify enabled
curl https://staging.example.com/api/ontology/status

# 3. Execute rollback
./rollback-ontology.sh staging

# 4. Verify disabled
curl https://staging.example.com/api/ontology/status

# 5. Test existing functionality
npm run test:integration

# Expected: All tests pass, ontology disabled
```

### When to Rollback

Trigger immediate rollback if:

1. **Classification accuracy <70%** for any team
2. **p95 latency >1000ms** (2x requirement)
3. **Error rate >5%** for ontology operations
4. **Critical bug** affecting user workflows
5. **Team requests rollback** due to disruption

## Backward Compatibility

### Guaranteed Backward Compatibility

The ontology system is **100% backward compatible**:

1. **Optional Feature**: Ontology is completely optional
2. **No Breaking Changes**: Existing APIs unchanged
3. **Data Preservation**: Knowledge stored without ontology metadata works normally
4. **Graceful Degradation**: If ontology disabled, system works as before
5. **Safe Rollback**: Disable via configuration, instant rollback

### Compatibility Matrix

| Feature | Ontology Enabled | Ontology Disabled | Notes |
|---------|------------------|-------------------|-------|
| Knowledge Extraction | Adds ontology metadata | Works normally | Metadata optional |
| Knowledge Storage | Stores with ontology | Works normally | Compatible schema |
| Knowledge Retrieval | Supports ontology queries | Works normally | Falls back to content search |
| Validation | Validates if enabled | Skipped | Graceful skip |
| Classification | Classifies if enabled | Skipped | Graceful skip |

### Testing Backward Compatibility

```bash
# Test 1: Extract knowledge with ontology disabled
ONTOLOGY_ENABLED=false npm test -- test/knowledge-extraction.test.js
# Expected: All tests pass

# Test 2: Query knowledge without ontology metadata
ONTOLOGY_ENABLED=false npm test -- test/knowledge-retrieval.test.js
# Expected: All tests pass

# Test 3: Mixed data (some with ontology, some without)
npm test -- test/mixed-ontology-data.test.js
# Expected: All tests pass, queries work on mixed data
```

## Monitoring and Metrics

### Key Metrics to Monitor

#### Classification Metrics

```prometheus
# Classification success rate
rate(ontology_classification_success[5m]) / rate(ontology_classification_total[5m])
# Target: >85%

# Classification latency
histogram_quantile(0.95, ontology_classification_duration_seconds)
# Target: <500ms p95

# Confidence distribution
histogram_quantile(0.50, ontology_classification_confidence)
# Target: Median >0.7
```

#### Performance Metrics

```prometheus
# Query latency
histogram_quantile(0.95, ontology_query_duration_seconds)
# Target: <100ms p95 (simple), <500ms (complex)

# Ontology load time
ontology_load_duration_seconds
# Target: <50ms (cached), <500ms (cold)

# Cache hit rate
rate(ontology_cache_hit[5m]) / rate(ontology_cache_requests[5m])
# Target: >80%
```

#### Quality Metrics

```prometheus
# Validation failure rate
rate(ontology_validation_failures[5m]) / rate(ontology_validation_total[5m])
# Target: <10% (lenient), <5% (strict)

# Coverage (% knowledge classified)
ontology_classified_knowledge / total_knowledge
# Target: >50% within 2 weeks
```

### Alert Rules

```yaml
# alerts.yml
groups:
  - name: ontology
    rules:
      - alert: OntologyClassificationAccuracyLow
        expr: rate(ontology_classification_success[5m]) / rate(ontology_classification_total[5m]) < 0.7
        for: 15m
        annotations:
          summary: "Ontology classification accuracy below 70%"

      - alert: OntologyHighLatency
        expr: histogram_quantile(0.95, ontology_classification_duration_seconds) > 1.0
        for: 10m
        annotations:
          summary: "Ontology classification p95 latency >1s"

      - alert: OntologyHighErrorRate
        expr: rate(ontology_errors[5m]) > 0.05
        for: 5m
        annotations:
          summary: "Ontology error rate >5%"
```

### Monitoring Dashboard

Import this Grafana dashboard for comprehensive monitoring:

```json
{
  "dashboard": {
    "title": "Ontology Integration - Production",
    "rows": [
      {
        "title": "Classification",
        "panels": [
          { "title": "Success Rate", "metric": "classification_success_rate" },
          { "title": "Latency (p95)", "metric": "classification_latency_p95" },
          { "title": "Throughput", "metric": "classification_throughput" }
        ]
      },
      {
        "title": "Quality",
        "panels": [
          { "title": "Confidence Distribution", "metric": "confidence_histogram" },
          { "title": "Validation Failures", "metric": "validation_failure_rate" },
          { "title": "Coverage", "metric": "classification_coverage" }
        ]
      },
      {
        "title": "Performance",
        "panels": [
          { "title": "Query Latency", "metric": "query_latency_p95" },
          { "title": "Cache Hit Rate", "metric": "cache_hit_rate" },
          { "title": "Memory Usage", "metric": "ontology_memory_usage" }
        ]
      }
    ]
  }
}
```

## Team-Specific Deployment

### ReSi Team (Pilot)

**Configuration**:

```json
{
  "team": "ReSi",
  "ontology": {
    "enabled": true,
    "lowerOntologyPath": ".data/ontologies/lower/resi-ontology.json",
    "validation": { "mode": "lenient" },
    "classification": {
      "enableHeuristics": true,
      "enableLLM": false
    }
  }
}
```

**Why ReSi First**:
- Smaller, more controlled team
- Well-defined technical terminology
- Good for heuristic classification
- Easier to tune and validate

### RaaS Team

**Configuration**:

```json
{
  "team": "RaaS",
  "ontology": {
    "enabled": true,
    "lowerOntologyPath": ".data/ontologies/lower/raas-ontology.json",
    "validation": { "mode": "strict" },
    "classification": {
      "enableHeuristics": true,
      "enableLLM": true  // Cloud terminology benefits from LLM
    }
  }
}
```

**RaaS Considerations**:
- Strict validation (production infrastructure)
- LLM fallback enabled (complex cloud terminology)
- Higher confidence threshold (0.8)

### Coding Team

**Configuration**:

```json
{
  "team": "Coding",
  "ontology": {
    "enabled": true,
    "lowerOntologyPath": ".data/ontologies/lower/coding-ontology.json",
    "validation": { "mode": "lenient" },
    "classification": {
      "enableHeuristics": true,
      "enableLLM": true
    }
  }
}
```

### Agentic & UI Teams

**Configuration**:

```json
{
  "team": "Agentic",  // or "UI"
  "ontology": {
    "enabled": true,
    "lowerOntologyPath": ".data/ontologies/lower/agentic-ontology.json",
    "validation": { "mode": "lenient" },
    "classification": {
      "enableHeuristics": true,
      "enableLLM": true
    }
  }
}
```

## Troubleshooting Common Issues

### Issue 1: Classification Accuracy Low

**Symptoms**: Classification success rate <70%

**Diagnosis**:

```bash
# Check confidence distribution
curl https://api.example.com/api/ontology/metrics/confidence | jq

# Check failed classifications
curl https://api.example.com/api/ontology/failures?limit=100 | jq
```

**Solutions**:

1. **Add more examples** to ontology entity definitions
2. **Lower confidence threshold** (0.6 instead of 0.7)
3. **Enable LLM fallback** if heuristics insufficient
4. **Review failed cases** and enhance heuristics

### Issue 2: High Latency

**Symptoms**: p95 latency >1000ms

**Diagnosis**:

```bash
# Check latency breakdown
curl https://api.example.com/api/ontology/metrics/latency | jq

# Check if LLM causing delays
curl https://api.example.com/api/ontology/metrics/method-breakdown | jq
```

**Solutions**:

1. **Enable caching** if disabled
2. **Disable LLM** and use heuristics only
3. **Batch classify** instead of individual calls
4. **Increase heuristic threshold** to reduce LLM fallback

### Issue 3: Memory Usage High

**Symptoms**: Memory usage >100MB above baseline

**Diagnosis**:

```bash
# Check cache size
curl https://api.example.com/api/ontology/metrics/cache | jq

# Check loaded ontologies
curl https://api.example.com/api/ontology/status | jq
```

**Solutions**:

1. **Reduce cache size** (maxSize: 500 instead of 1000)
2. **Reduce cache TTL** (30 min instead of 1 hour)
3. **Enable cache eviction** for least recently used
4. **Monitor for memory leaks** in ontology manager

### Issue 4: Validation Failures High

**Symptoms**: >20% validation failure rate

**Diagnosis**:

```bash
# Check validation errors
curl https://api.example.com/api/ontology/validation-errors?limit=100 | jq

# Group by error type
curl https://api.example.com/api/ontology/validation-errors/summary | jq
```

**Solutions**:

1. **Switch to lenient mode** during tuning
2. **Update ontology schemas** to allow common patterns
3. **Review property definitions** for too-strict rules
4. **Log warnings** instead of failing in strict mode

## Post-Migration Checklist

After full rollout (end of Week 7):

- [ ] All teams enabled and operational
- [ ] Classification accuracy >85% for all teams
- [ ] p95 latency <500ms for all operations
- [ ] Cache hit rate >80%
- [ ] >50% of knowledge classified
- [ ] No critical bugs outstanding
- [ ] Monitoring dashboards complete
- [ ] Alert rules tested and working
- [ ] Team training completed
- [ ] Documentation updated with production learnings
- [ ] Rollback procedures tested and documented
- [ ] Success metrics reported to stakeholders

## Additional Resources

- [User Guide](./ontology-integration-guide.md) - Comprehensive usage guide
- [API Documentation](./api/index.html) - Complete API reference
- [Requirements](../.spec-workflow/specs/ontology-integration/requirements.md) - System requirements
- [Design Document](../.spec-workflow/specs/ontology-integration/design.md) - Architecture details
- [Test Examples](../test/ontology/) - Working code examples

## Support During Migration

**Migration Support Team**:
- **Technical Lead**: Available for architecture questions
- **On-Call Rotation**: 24/7 support during migration period
- **Team Liaisons**: Embedded with each team during rollout
- **Slack Channel**: #ontology-migration for questions and updates

**Escalation Path**:
1. Check troubleshooting section
2. Review monitoring dashboards
3. Post in #ontology-migration Slack channel
4. Page on-call if critical (>5% error rate or user-impacting)

**Office Hours**:
- Daily standup during migration (15 min)
- Weekly review meetings (30 min)
- Ad-hoc support sessions as needed
