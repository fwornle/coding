# Dashboard

Web-based visualization and monitoring interfaces.

## Dashboard Overview

| Dashboard | URL | Purpose |
|-----------|-----|---------|
| VKB | http://localhost:8080 | Knowledge graph visualization |
| Constraint Monitor | http://localhost:3030 | Compliance monitoring |
| System Health | http://localhost:3032 | Service health monitoring |

## VKB (Knowledge Visualization)

**URL**: http://localhost:8080

**Start**:

```bash
vkb  # Opens browser automatically
```

### Features

- **Interactive Graph** - Force-directed knowledge visualization
- **Entity Search** - Full-text search across all entities
- **Type Filtering** - Filter by entity class
- **Significance Filter** - Show high-value entities only
- **Relationship Explorer** - View entity connections
- **Source Toggle** - Switch between UKB and Continuous Learning data

### Data Sources

- **GraphDB** - Manual UKB insights
- **Qdrant** - Continuous Learning embeddings

## Constraint Monitor Dashboard

**URL**: http://localhost:3030

**Start**:

```bash
cd integrations/mcp-constraint-monitor
PORT=3030 npm run dashboard
```

### Features

- **Real-Time Feed** - Live violation updates
- **Compliance Gauge** - Visual 0-10 score
- **7-Day Trends** - Historical compliance chart
- **Project Selector** - Filter by project
- **Constraint Toggles** - Enable/disable constraints
- **Risk Indicators** - Visual severity classification

## System Health Dashboard

**URL**: http://localhost:3032

### Features

- **Service Status** - Real-time service health
- **Metrics History** - Health trends over time
- **Alert History** - Recent system alerts
- **Restart Controls** - Service restart buttons

### API (Port 3033)

| Endpoint | Description |
|----------|-------------|
| `/api/health` | Dashboard's own self-healthcheck |
| `/api/health-verifier/status` | Pass-through to coordinator `/health/state` (includes `network`, `databases` sub-checks) |
| `/api/health-verifier/report` | Full health report with all checks (databases, services, processes, CGR cache) |
| `/api/cgr/freshness` | Graph freshness; compares `graph.json` `built_at_commit` vs `HEAD` |
| `/api/services` | Individual service status |
| `/api/metrics` | Health metrics history |
| `/api/alerts` | Recent alerts |

!!! note "Dashboard data pipeline"
    The dashboard server reads the coordinator's `/health/state` and transforms it for the frontend. Key transformations:

    - **Database sub-checks** (`leveldb_lock_check`, `qdrant_availability`, `graph_integrity`): mapped via `toUiStatus()` — values `passed`, `healthy`, `running`, `ok`, `present` all map to `passed`; other values map to `warning`, `failed`, `error`, or `unknown`.
    - **Network state** (`network.internet_reachable`, `network.proxy_running`, `network.location`): passed through directly to the LLM Proxy Health card.
    - **Code graph cache**: synthesized from `.data/graphify/metadata.json` + `git rev-list` for commits-behind count.

## Graphify Graph Inspection

Graphify is file-based — there is no Lab UI and no Cypher. The code graph is a static `graph.json` at `.data/graphify/graphify-out/graph.json`, inspected via the `graphify` CLI or by reading the JSON directly.

### Features

- **Structural Search** - Query the graph for callers, dependencies, and paths
- **Call Graph** - Function dependency analysis
- **Path Finding** - Shortest path between two nodes
- **Hub Detection** - `god-nodes` lists the most-connected nodes

### Example Queries

```bash
graphify query "what calls captureForegroundTokens"     # structural query
graphify path "ObservationWriter" "obs-api"             # shortest path
graphify god-nodes --top 20                             # most-connected hubs

# Inspect the graph file and its built_at_commit stamp
ls -la .data/graphify/graphify-out/graph.json
```

## Port Configuration

All dashboard ports are configured in `.env.ports`:

```bash
VKB_PORT=8080
CONSTRAINT_DASHBOARD_PORT=3030
CONSTRAINT_API_PORT=3031
SYSTEM_HEALTH_DASHBOARD_PORT=3032
SYSTEM_HEALTH_API_PORT=3033
```

## Rebuilding Dashboards

### VKB/System Health Dashboard

Dashboard UI is bind-mounted from host. No Docker rebuild needed:

```bash
cd integrations/system-health-dashboard
npm run build
# Hard-refresh browser (Cmd+Shift+R)
```

### Constraint Monitor Dashboard

```bash
cd integrations/mcp-constraint-monitor
npm run build
```

## Troubleshooting

### Dashboard not loading

```bash
# Check if port is in use
lsof -i :8080

# Start VKB server manually
cd lib/vkb-server && node index.js
```

### Data not updating

```bash
# Check backend service
curl http://localhost:8080/api/health

# Restart service
docker compose -f docker/docker-compose.yml restart coding-services
```

### Graph out of date or missing

```bash
# Check the graph file and its built_at_commit stamp
ls -la .data/graphify/graphify-out/graph.json

# Rebuild incrementally (AST only)
graphify update /workspace/coding
```
