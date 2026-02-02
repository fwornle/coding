# Dashboard

Web-based visualization and monitoring interfaces.

## Dashboard Overview

| Dashboard | URL | Purpose |
|-----------|-----|---------|
| VKB | http://localhost:8080 | Knowledge graph visualization |
| Constraint Monitor | http://localhost:3030 | Compliance monitoring |
| System Health | http://localhost:3032 | Service health monitoring |
| Memgraph Lab | http://localhost:3100 | Graph database UI |

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
| `/api/health` | Overall system health |
| `/api/services` | Individual service status |
| `/api/metrics` | Health metrics history |
| `/api/alerts` | Recent alerts |

## Memgraph Lab

**URL**: http://localhost:3100

Graph database visualization and query interface.

### Features

- **Cypher Console** - Run graph queries
- **Visual Query** - Point-and-click query building
- **Graph Visualization** - Interactive node/edge display
- **Schema Browser** - Explore graph structure

### Example Queries

```cypher
// Count all nodes
MATCH (n) RETURN count(n);

// Find all functions
MATCH (f:Function) RETURN f.name, f.file LIMIT 10;

// Show call graph
MATCH (a:Function)-[:CALLS]->(b:Function)
RETURN a.name, b.name LIMIT 20;
```

## Port Configuration

All dashboard ports are configured in `.env.ports`:

```bash
VKB_PORT=8080
CONSTRAINT_DASHBOARD_PORT=3030
CONSTRAINT_API_PORT=3031
SYSTEM_HEALTH_DASHBOARD_PORT=3032
SYSTEM_HEALTH_API_PORT=3033
MEMGRAPH_LAB_PORT=3100
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

### Memgraph Lab connection failed

```bash
# Check Memgraph container
docker compose -f docker/docker-compose.yml ps memgraph

# View logs
docker compose -f docker/docker-compose.yml logs memgraph
```
