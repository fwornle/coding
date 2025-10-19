# Continuous Learning Knowledge System - Deployment Checklist

**Version**: 1.0
**Last Updated**: 2025-10-19
**Owner**: Release Management Team

## Document Purpose

This checklist ensures a smooth, risk-managed deployment of the Continuous Learning Knowledge System to production. Follow all steps sequentially with verification at each stage.

---

## Table of Contents

1. [Pre-Deployment Phase](#pre-deployment-phase)
2. [Environment Setup](#environment-setup)
3. [Installation Phase](#installation-phase)
4. [Configuration Phase](#configuration-phase)
5. [Database Initialization](#database-initialization)
6. [Data Migration](#data-migration)
7. [Integration & Testing](#integration--testing)
8. [Team Training](#team-training)
9. [Go-Live Criteria](#go-live-criteria)
10. [Deployment Execution](#deployment-execution)
11. [Post-Deployment Verification](#post-deployment-verification)
12. [Rollback Procedures](#rollback-procedures)

---

## Pre-Deployment Phase

### 1.1 Prerequisites Verification

**Objective**: Ensure all prerequisites are met before beginning deployment

#### System Requirements

- [ ] **Node.js Version**
  - Required: Node.js 18.x or higher
  - Verification: `node --version`
  - Expected output: `v18.x.x` or higher
  - [ ] Pass ✅ | Fail ❌

- [ ] **Available Disk Space**
  - Required: Minimum 10GB free space
  - Verification: `df -h`
  - Check: Database storage partition has >10GB free
  - [ ] Pass ✅ | Fail ❌

- [ ] **Available RAM**
  - Required: Minimum 8GB RAM
  - Recommended: 16GB RAM for production
  - Verification: `free -h` (Linux) or Activity Monitor (Mac)
  - [ ] Pass ✅ | Fail ❌

- [ ] **Network Connectivity**
  - Required: Outbound HTTPS access to LLM provider APIs
  - Test Groq API: `curl -I https://api.groq.com`
  - Test OpenRouter: `curl -I https://openrouter.ai`
  - [ ] Pass ✅ | Fail ❌

#### API Keys & Credentials

- [ ] **Groq API Key**
  - Obtained from: https://console.groq.com
  - Stored in: Environment variable or secrets manager
  - Verification: `echo $GROQ_API_KEY | wc -c` (should be >20 characters)
  - [ ] Pass ✅ | Fail ❌

- [ ] **OpenRouter API Key** (optional but recommended)
  - Obtained from: https://openrouter.ai
  - Stored securely
  - [ ] Pass ✅ | Fail ❌ | N/A

- [ ] **Anthropic API Key** (optional)
  - For highest quality inference
  - [ ] Pass ✅ | Fail ❌ | N/A

- [ ] **OpenAI API Key** (optional)
  - For 1536-dim embeddings
  - [ ] Pass ✅ | Fail ❌ | N/A

#### Database Dependencies

- [ ] **Qdrant Installation**
  - Method 1 (Docker): `docker run -d -p 6333:6333 qdrant/qdrant:latest`
  - Method 2 (Binary): Download from https://qdrant.tech/documentation/quick-start/
  - Verification: `curl http://localhost:6333/collections`
  - Expected: `{"result":{"collections":[]},"status":"ok"}`
  - [ ] Pass ✅ | Fail ❌

- [ ] **SQLite3**
  - Verification: `sqlite3 --version`
  - Required: Version 3.35.0 or higher (for RETURNING support)
  - [ ] Pass ✅ | Fail ❌

- [ ] **Local LLM** (Ollama - recommended but optional)
  - Installation: `curl -fsSL https://ollama.ai/install.sh | sh`
  - Model download: `ollama pull llama3.2:3b`
  - Model download: `ollama pull nomic-embed-text`
  - Verification: `curl http://localhost:11434/api/tags`
  - [ ] Pass ✅ | Fail ❌ | N/A

### 1.2 Stakeholder Approval

- [ ] **Business Stakeholders Sign-Off**
  - Product Owner approval
  - Business sponsor approval
  - Date: __________
  - Signature: __________

- [ ] **Technical Stakeholders Sign-Off**
  - Engineering Manager approval
  - DevOps Lead approval
  - Security Team review completed
  - Date: __________
  - Signature: __________

### 1.3 Documentation Review

- [ ] **Deployment Documentation Review**
  - Developer documentation reviewed
  - Operator documentation reviewed
  - Configuration templates reviewed
  - Runbooks prepared and accessible
  - [ ] Pass ✅ | Fail ❌

- [ ] **Rollback Plan Review**
  - Rollback procedures documented
  - Rollback tested on staging
  - Recovery time objective (RTO): < 30 minutes confirmed
  - [ ] Pass ✅ | Fail ❌

### 1.4 Communication

- [ ] **Stakeholder Notification**
  - Deployment schedule communicated
  - Maintenance window scheduled (if needed)
  - On-call rotation notified
  - [ ] Pass ✅ | Fail ❌

---

## Environment Setup

### 2.1 Environment Preparation

- [ ] **Create Project Directory**
  ```bash
  mkdir -p /var/lib/knowledge-system
  cd /var/lib/knowledge-system
  ```
  - Verification: `pwd` shows `/var/lib/knowledge-system`
  - [ ] Pass ✅ | Fail ❌

- [ ] **Set Proper Permissions**
  ```bash
  chown -R <app-user>:<app-group> /var/lib/knowledge-system
  chmod 755 /var/lib/knowledge-system
  ```
  - Verification: `ls -ld /var/lib/knowledge-system`
  - [ ] Pass ✅ | Fail ❌

- [ ] **Create Subdirectories**
  ```bash
  mkdir -p .specstory/knowledge
  mkdir -p .specstory/config
  mkdir -p .specstory/trajectory
  mkdir -p logs
  mkdir -p backups
  ```
  - Verification: `tree -L 2` or `find . -type d`
  - [ ] Pass ✅ | Fail ❌

### 2.2 Environment Variables

- [ ] **Create Environment File**
  ```bash
  cat > .env <<EOF
  NODE_ENV=production
  GROQ_API_KEY=<your-groq-api-key>
  OPENROUTER_API_KEY=<your-openrouter-api-key>
  QDRANT_URL=http://localhost:6333
  SQLITE_DB_PATH=.specstory/knowledge/analytics.db
  LOG_LEVEL=info
  METRICS_PORT=9090
  EOF
  ```
  - [ ] Pass ✅ | Fail ❌

- [ ] **Secure Environment File**
  ```bash
  chmod 600 .env
  ```
  - Verification: `ls -l .env` shows `-rw-------`
  - [ ] Pass ✅ | Fail ❌

- [ ] **Verify Environment Variables Load**
  ```bash
  source .env && echo $GROQ_API_KEY | head -c 10
  ```
  - Should display first 10 chars of API key
  - [ ] Pass ✅ | Fail ❌

---

## Installation Phase

### 3.1 Code Deployment

- [ ] **Clone Repository** (or copy release package)
  ```bash
  git clone <repository-url> .
  git checkout v1.0.0  # Use specific release tag
  ```
  - Verification: `git describe --tags`
  - [ ] Pass ✅ | Fail ❌

- [ ] **Install Dependencies**
  ```bash
  npm ci --production
  ```
  - Expected: No errors, all packages installed
  - Verification: `npm list --depth=0`
  - [ ] Pass ✅ | Fail ❌

- [ ] **Verify Critical Dependencies**
  ```bash
  npm list @qdrant/js-client-rest better-sqlite3 dotenv
  ```
  - All required packages present
  - [ ] Pass ✅ | Fail ❌

### 3.2 Build & Compile (if needed)

- [ ] **Run Build Process** (if TypeScript or bundling required)
  ```bash
  npm run build
  ```
  - Expected: Build completes without errors
  - [ ] Pass ✅ | Fail ❌ | N/A

---

## Configuration Phase

### 4.1 System Configuration

- [ ] **Copy Configuration Templates**
  ```bash
  cp .specstory/config/knowledge-system.template.json .specstory/config/knowledge-system.json
  cp .specstory/config/sensitivity-topics.template.json .specstory/config/sensitivity-topics.json
  ```
  - [ ] Pass ✅ | Fail ❌

- [ ] **Customize Main Configuration**
  - Edit `.specstory/config/knowledge-system.json`
  - Set budget limit: `"monthlyLimit": 8.33` (or your limit)
  - Set provider priority: `["local", "groq", "openrouter"]` (adjust as needed)
  - Configure Qdrant URL
  - Configure SQLite path
  - [ ] Pass ✅ | Fail ❌

- [ ] **Customize Sensitivity Configuration**
  - Edit `.specstory/config/sensitivity-topics.json`
  - Add project-specific sensitive patterns
  - Enable appropriate compliance frameworks (GDPR, HIPAA, etc.)
  - Configure custom topic categories
  - [ ] Pass ✅ | Fail ❌

- [ ] **Validate Configuration**
  ```bash
  node scripts/validate-config.js
  ```
  - Expected: "Configuration valid ✓"
  - [ ] Pass ✅ | Fail ❌

### 4.2 Security Configuration

- [ ] **Review Sensitive Data Settings**
  - Confirm `autoDetect: true` for sensitivity
  - Confirm `routeToLocal: true` for sensitive content
  - Confirm `neverCache: true` for sensitive content
  - [ ] Pass ✅ | Fail ❌

- [ ] **API Key Security**
  - API keys stored in environment variables (not in config files)
  - Config files do not contain hardcoded secrets
  - Verification: `grep -r "sk_" .specstory/config/` returns nothing
  - [ ] Pass ✅ | Fail ❌

---

## Database Initialization

### 5.1 Qdrant Setup

- [ ] **Verify Qdrant Running**
  ```bash
  curl http://localhost:6333/healthz
  ```
  - Expected: HTTP 200 OK
  - [ ] Pass ✅ | Fail ❌

- [ ] **Create Vector Collections**
  ```bash
  node scripts/initialize-qdrant.js
  ```
  - Creates `knowledge_384` collection (384-dimensional vectors)
  - Creates `knowledge_1536` collection (1536-dimensional vectors)
  - Sets up HNSW indexing
  - Enables quantization
  - [ ] Pass ✅ | Fail ❌

- [ ] **Verify Collection Creation**
  ```bash
  curl http://localhost:6333/collections/knowledge_384
  curl http://localhost:6333/collections/knowledge_1536
  ```
  - Expected: Both collections exist with correct dimensions
  - [ ] Pass ✅ | Fail ❌

### 5.2 SQLite Setup

- [ ] **Initialize SQLite Database**
  ```bash
  node scripts/initialize-sqlite.js
  ```
  - Creates schema (knowledge_items, cost_tracking, etc.)
  - Creates indices for performance
  - Enables WAL mode
  - [ ] Pass ✅ | Fail ❌

- [ ] **Verify Database Schema**
  ```bash
  sqlite3 .specstory/knowledge/analytics.db ".schema"
  ```
  - Expected: All tables and indices created
  - Tables: knowledge_items, knowledge_vectors, cost_tracking, knowledge_access
  - [ ] Pass ✅ | Fail ❌

- [ ] **Test Database Connection**
  ```bash
  sqlite3 .specstory/knowledge/analytics.db "PRAGMA integrity_check;"
  ```
  - Expected: "ok"
  - [ ] Pass ✅ | Fail ❌

---

## Data Migration

### 6.1 Migrate Existing Knowledge (if applicable)

- [ ] **Backup Existing Data**
  - If migrating from previous system
  - Create full backup before migration
  - [ ] Pass ✅ | Fail ❌ | N/A

- [ ] **Export Legacy Knowledge**
  ```bash
  node scripts/export-legacy-knowledge.js --output=/tmp/legacy-knowledge.json
  ```
  - [ ] Pass ✅ | Fail ❌ | N/A

- [ ] **Import to New System**
  ```bash
  node scripts/import-knowledge.js --input=/tmp/legacy-knowledge.json
  ```
  - Verify count: Check imported item count matches export
  - [ ] Pass ✅ | Fail ❌ | N/A

- [ ] **Verify Migration**
  ```bash
  sqlite3 .specstory/knowledge/analytics.db "SELECT COUNT(*) FROM knowledge_items;"
  ```
  - Expected: Count matches imported items
  - [ ] Pass ✅ | Fail ❌ | N/A

### 6.2 Historical Session Processing (optional)

- [ ] **Process Historical LSL Files**
  ```bash
  node scripts/batch-extract-knowledge.js --sessions=.specstory/history/*.md
  ```
  - Extracts knowledge from past sessions
  - May take time depending on session count
  - [ ] Pass ✅ | Fail ❌ | N/A

---

## Integration & Testing

### 7.1 Service Health Checks

- [ ] **Start Knowledge System**
  ```bash
  npm start
  ```
  - Or use process manager: `pm2 start npm --name knowledge-system -- start`
  - [ ] Pass ✅ | Fail ❌

- [ ] **Check Service Health**
  ```bash
  curl http://localhost:3000/health
  ```
  - Expected: HTTP 200, `{"status":"healthy"}`
  - Check all components: qdrant, sqlite, providers, budget, cache
  - [ ] Pass ✅ | Fail ❌

- [ ] **Check Metrics Endpoint**
  ```bash
  curl http://localhost:9090/metrics
  ```
  - Expected: Prometheus metrics format
  - [ ] Pass ✅ | Fail ❌

### 7.2 Functionality Testing

- [ ] **Test Knowledge Extraction**
  ```bash
  node scripts/test-knowledge-extraction.js
  ```
  - Creates sample conversation
  - Extracts knowledge
  - Verifies storage in Qdrant and SQLite
  - Expected: Knowledge extracted and stored successfully
  - [ ] Pass ✅ | Fail ❌

- [ ] **Test Semantic Search**
  ```bash
  node scripts/test-knowledge-search.js --query="How do I implement caching?"
  ```
  - Expected: Returns relevant results with scores >0.7
  - [ ] Pass ✅ | Fail ❌

- [ ] **Test Trajectory Tracking**
  ```bash
  node scripts/test-trajectory.js
  ```
  - Simulates session with intent classification
  - Expected: Intent detected correctly, trajectory state updated
  - [ ] Pass ✅ | Fail ❌

- [ ] **Test Budget Tracking**
  ```bash
  node scripts/test-budget.js
  ```
  - Makes test inference
  - Checks cost tracking
  - Expected: Cost recorded in database
  - [ ] Pass ✅ | Fail ❌

### 7.3 Integration Testing

- [ ] **Test Full Workflow**
  ```bash
  node scripts/test-full-workflow.js
  ```
  - Start session → Process exchanges → Extract knowledge → Search → End session
  - Expected: Complete workflow succeeds
  - [ ] Pass ✅ | Fail ❌

- [ ] **Test LSL Integration** (if integrating with live session logging)
  ```bash
  node scripts/test-lsl-integration.js
  ```
  - Simulates LSL transcript event
  - Verifies knowledge extraction triggered
  - Expected: Knowledge extracted from transcript
  - [ ] Pass ✅ | Fail ❌

### 7.4 Performance Testing

- [ ] **Measure Inference Latency**
  ```bash
  node scripts/benchmark-inference.js --iterations=100
  ```
  - Expected: p95 latency < 2 seconds
  - [ ] Pass ✅ | Fail ❌

- [ ] **Measure Vector Search Latency**
  ```bash
  node scripts/benchmark-search.js --iterations=100
  ```
  - Expected: p95 latency < 500ms
  - [ ] Pass ✅ | Fail ❌

- [ ] **Measure Embedding Generation**
  ```bash
  node scripts/benchmark-embeddings.js
  ```
  - Expected: 384-dim <50ms, 1536-dim <200ms
  - [ ] Pass ✅ | Fail ❌

### 7.5 Error Handling Testing

- [ ] **Test Provider Failure Handling**
  ```bash
  node scripts/test-provider-failure.js
  ```
  - Simulates provider failure
  - Expected: Falls back to next provider, circuit breaker opens
  - [ ] Pass ✅ | Fail ❌

- [ ] **Test Budget Exhaustion**
  ```bash
  node scripts/test-budget-exhaustion.js
  ```
  - Simulates budget limit reached
  - Expected: Switches to local-only mode
  - [ ] Pass ✅ | Fail ❌

- [ ] **Test Database Connection Loss**
  ```bash
  node scripts/test-db-failure.js
  ```
  - Simulates Qdrant unavailable
  - Expected: Graceful degradation, errors logged
  - [ ] Pass ✅ | Fail ❌

---

## Team Training

### 8.1 Developer Training

- [ ] **Developer Workshop Conducted**
  - Date: __________
  - Topics covered:
    - [ ] System architecture overview
    - [ ] Configuration customization
    - [ ] Knowledge extraction API
    - [ ] Search and retrieval API
    - [ ] Budget management
    - [ ] Troubleshooting common issues
  - [ ] Pass ✅ | Fail ❌

- [ ] **Developer Documentation Distributed**
  - `docs/knowledge-management/continuous-learning-system.md` shared
  - API reference accessible
  - [ ] Pass ✅ | Fail ❌

### 8.2 Operations Training

- [ ] **Operations Workshop Conducted**
  - Date: __________
  - Topics covered:
    - [ ] Health monitoring setup
    - [ ] Backup procedures
    - [ ] Scaling guidelines
    - [ ] Incident response
    - [ ] Runbook walkthrough
  - [ ] Pass ✅ | Fail ❌

- [ ] **Operations Documentation Distributed**
  - `docs/operations/knowledge-system-ops.md` shared
  - Runbooks accessible to on-call team
  - [ ] Pass ✅ | Fail ❌

### 8.3 End User Training

- [ ] **End User Documentation Available**
  - Usage examples documented
  - FAQ created
  - [ ] Pass ✅ | Fail ❌

---

## Go-Live Criteria

### 9.1 Technical Go/No-Go Criteria

**All items must be "GO" (✅) to proceed with deployment**

- [ ] **System Health**: GO ✅ | NO-GO ❌
  - All health checks passing
  - No critical errors in logs
  - All dependencies available

- [ ] **Performance**: GO ✅ | NO-GO ❌
  - Inference latency p95 < 2s
  - Vector search p95 < 500ms
  - Embedding generation meets targets

- [ ] **Data Integrity**: GO ✅ | NO-GO ❌
  - Database schema correct
  - Migration completed successfully (if applicable)
  - Test queries return expected results

- [ ] **Monitoring**: GO ✅ | NO-GO ❌
  - Metrics endpoint accessible
  - Grafana dashboard configured
  - Alerts configured and tested

- [ ] **Security**: GO ✅ | NO-GO ❌
  - API keys secured
  - Sensitive data detection working
  - No secrets in configuration files

- [ ] **Backups**: GO ✅ | NO-GO ❌
  - Backup scripts tested
  - Automated backups scheduled
  - Backup verification successful

### 9.2 Business Go/No-Go Criteria

- [ ] **Stakeholder Approval**: GO ✅ | NO-GO ❌
  - Business sponsor sign-off
  - Product owner approval

- [ ] **Team Readiness**: GO ✅ | NO-GO ❌
  - Developers trained
  - Operations team trained
  - On-call rotation prepared

- [ ] **Documentation**: GO ✅ | NO-GO ❌
  - All documentation complete
  - Runbooks accessible
  - Rollback plan documented

### 9.3 Final Go/No-Go Decision

**Deployment Decision**: GO ✅ | NO-GO ❌

**Decision Maker**: __________
**Date**: __________
**Signature**: __________

**If NO-GO**: Document reasons and reschedule:
- Reason: __________
- Action items: __________
- New target date: __________

---

## Deployment Execution

### 10.1 Pre-Deployment Backup

- [ ] **Create Full Backup**
  ```bash
  /scripts/backup-knowledge-system.sh
  ```
  - Timestamp: __________
  - Backup location: __________
  - [ ] Pass ✅ | Fail ❌

- [ ] **Verify Backup Integrity**
  ```bash
  /scripts/verify-backups.sh
  ```
  - Expected: Backup valid and complete
  - [ ] Pass ✅ | Fail ❌

### 10.2 Deployment Steps

- [ ] **Stop Existing Services** (if upgrading)
  ```bash
  pm2 stop knowledge-system
  # or
  systemctl stop knowledge-system
  ```
  - [ ] Pass ✅ | Fail ❌ | N/A

- [ ] **Deploy New Version**
  - Follow installation steps from Section 3
  - [ ] Pass ✅ | Fail ❌

- [ ] **Run Database Migrations** (if needed)
  ```bash
  node scripts/run-migrations.js
  ```
  - [ ] Pass ✅ | Fail ❌ | N/A

- [ ] **Start Services**
  ```bash
  pm2 start npm --name knowledge-system -- start
  pm2 save
  ```
  - [ ] Pass ✅ | Fail ❌

- [ ] **Monitor Startup**
  ```bash
  pm2 logs knowledge-system --lines 100
  ```
  - Watch for errors during startup
  - Expected: "Knowledge system started successfully"
  - [ ] Pass ✅ | Fail ❌

### 10.3 Smoke Tests

- [ ] **Health Check**
  ```bash
  curl http://localhost:3000/health
  ```
  - [ ] Pass ✅ | Fail ❌

- [ ] **Simple Knowledge Extraction**
  ```bash
  node scripts/smoke-test-extraction.js
  ```
  - [ ] Pass ✅ | Fail ❌

- [ ] **Simple Search Query**
  ```bash
  node scripts/smoke-test-search.js
  ```
  - [ ] Pass ✅ | Fail ❌

---

## Post-Deployment Verification

### 11.1 System Monitoring (First 24 Hours)

- [ ] **Monitor Error Rates**
  - Check logs every hour for first 4 hours
  - No critical errors
  - [ ] Pass ✅ | Fail ❌

- [ ] **Monitor Performance Metrics**
  - Latency within targets
  - Cache hit rate >40%
  - [ ] Pass ✅ | Fail ❌

- [ ] **Monitor Cost Tracking**
  - Budget tracking functional
  - Costs within expected range
  - [ ] Pass ✅ | Fail ❌

### 11.2 User Acceptance

- [ ] **Pilot Users Testing** (first week)
  - 5-10 pilot users selected
  - Feedback collected
  - No critical issues reported
  - [ ] Pass ✅ | Fail ❌

- [ ] **Knowledge Quality Validation**
  - Sample 20 extracted knowledge items
  - Verify relevance and accuracy
  - Quality score >70%
  - [ ] Pass ✅ | Fail ❌

### 11.3 Performance Validation

- [ ] **Weekly Performance Review**
  - Review performance metrics
  - Inference latency p95 < 2s: [ ] ✅ | ❌
  - Vector search p95 < 500ms: [ ] ✅ | ❌
  - Cache hit rate >40%: [ ] ✅ | ❌
  - Monthly cost <$8.33: [ ] ✅ | ❌

---

## Rollback Procedures

### 12.1 Rollback Criteria

Initiate rollback if any of the following occur within first 48 hours:

- [ ] System health degraded (multiple services down)
- [ ] Critical data loss detected
- [ ] Performance degradation >50% (latency doubled)
- [ ] Security incident related to deployment
- [ ] Budget exceeded by >200% unexpectedly
- [ ] Multiple critical user issues reported

### 12.2 Rollback Steps

**If rollback needed, follow these steps immediately:**

1. **Stop Current Services**
   ```bash
   pm2 stop knowledge-system
   ```

2. **Restore from Backup**
   ```bash
   /scripts/disaster-recovery.sh <backup-timestamp>
   ```
   - Use backup from step 10.1
   - Backup timestamp: __________

3. **Restart Previous Version**
   ```bash
   pm2 start knowledge-system
   ```

4. **Verify Rollback**
   ```bash
   curl http://localhost:3000/health
   node scripts/smoke-test.js
   ```

5. **Notify Stakeholders**
   - Send rollback notification
   - Document rollback reason
   - Schedule post-mortem

### 12.3 Post-Rollback Actions

- [ ] **Root Cause Analysis**
  - Conduct post-mortem within 48 hours
  - Document lessons learned
  - Create action items for next attempt
  - [ ] Complete

- [ ] **Remediation Plan**
  - Fix identified issues
  - Retest in staging
  - Schedule new deployment date
  - [ ] Complete

---

## Sign-Off

### Deployment Completion

- [ ] All deployment steps completed successfully
- [ ] All verification steps passed
- [ ] No critical issues detected
- [ ] Stakeholders notified of successful deployment

**Deployment Lead**: __________
**Date**: __________
**Signature**: __________

**Operations Lead**: __________
**Date**: __________
**Signature**: __________

**Product Owner**: __________
**Date**: __________
**Signature**: __________

---

## Appendix

### A. Contact Information

| Role | Name | Contact |
|------|------|---------|
| Deployment Lead | __________ | __________ |
| On-Call Engineer | __________ | __________ |
| DevOps Lead | __________ | __________ |
| Product Owner | __________ | __________ |

### B. Useful Commands

```bash
# Check service status
pm2 status knowledge-system

# View logs
pm2 logs knowledge-system --lines 100

# Restart service
pm2 restart knowledge-system

# Check Qdrant status
curl http://localhost:6333/collections

# Check SQLite database
sqlite3 .specstory/knowledge/analytics.db "SELECT COUNT(*) FROM knowledge_items;"

# Run health check
curl http://localhost:3000/health

# View metrics
curl http://localhost:9090/metrics
```

### C. Common Issues & Solutions

| Issue | Possible Cause | Solution |
|-------|---------------|----------|
| Qdrant connection failed | Qdrant not running | `docker restart qdrant` |
| Budget exceeded immediately | Invalid cost tracking | Check budget config, reset tracker |
| High latency | Circuit breaker open | Check provider status, reset circuit breaker |
| Cache miss rate high | Cache not warmed | Run cache warming script |
| Memory usage growing | Memory leak | Restart service, check for leaks |

### D. Deployment Timeline

| Phase | Estimated Duration | Actual Duration |
|-------|-------------------|-----------------|
| Pre-deployment | 2 hours | __________ |
| Installation | 1 hour | __________ |
| Configuration | 1 hour | __________ |
| Database init | 30 minutes | __________ |
| Testing | 2 hours | __________ |
| Deployment | 1 hour | __________ |
| **Total** | **7.5 hours** | __________ |

---

**Document Version**: 1.0
**Last Updated**: 2025-10-19
**Next Review**: 2025-11-19
