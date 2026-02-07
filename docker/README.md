# Docker Deployment for Coding Infrastructure

This directory contains Docker configuration for containerized deployment of the Coding system's MCP servers and supporting services.

## Architecture Overview

![Docker Architecture](../docs/images/docker-architecture.png)

**Host (Native):**
- Claude CLI
- Lightweight stdio proxies (connect to containers via HTTP/SSE)

**Docker Containers:**
- **coding-services**: MCP servers running as HTTP/SSE services
  - semantic-analysis: Port 3848
  - browser-access: Port 3847
  - constraint-monitor: Port 3849
  - code-graph-rag: Port 3850
  - VKB Server: Port 8080
  - Health Dashboard: Ports 3032/3033

- **Databases:**
  - Qdrant: Ports 6333/6334
  - Redis: Port 6379
  - Memgraph: Ports 7687/3100

## Quick Start

### 1. Enable Docker Mode

```bash
# Create marker file in coding repo (one-time setup)
touch .docker-mode
```

### 2. Launch Claude

```bash
# That's it! Services start automatically
coding --claude
```

The launcher automatically:
- Detects Docker mode via `.docker-mode` marker
- Starts all containers via `docker compose`
- Waits for health checks to pass
- Configures MCP servers to use stdio proxies

### 3. Verify Health (Optional)

```bash
# Check container status
docker compose -f docker/docker-compose.yml ps

# Check MCP server health endpoints
curl http://localhost:3848/health  # semantic-analysis
curl http://localhost:3847/health  # browser-access
curl http://localhost:3849/health  # constraint-monitor
curl http://localhost:3850/health  # code-graph-rag
```

## Files

| File | Purpose |
|------|---------|
| `Dockerfile.coding-services` | Multi-stage container build (Node 22 + Python 3.11) |
| `docker-compose.yml` | Service orchestration |
| `entrypoint.sh` | Container startup script (waits for DB health) |
| `supervisord.conf` | Process supervisor for MCP servers |
| `.env.example` | Environment variable template |

## Configuration

### Environment Variables

Copy `.env.example` and customize:

```bash
cp .env.example .env
```

Key variables:
- `CODING_REPO`: Path to coding repository on host
- `OPENAI_API_KEY`: OpenAI API key for embeddings
- `ANTHROPIC_API_KEY`: Anthropic API key for LLM calls

### Port Mapping

See `.env.ports` in the main repository for all port configurations:

| Service | Port | Protocol |
|---------|------|----------|
| Browser Access SSE | 3847 | HTTP/SSE |
| Semantic Analysis SSE | 3848 | HTTP/SSE |
| Constraint Monitor SSE | 3849 | HTTP/SSE |
| Code Graph RAG SSE | 3850 | HTTP/SSE |
| VKB Server | 8080 | HTTP |
| Health Dashboard UI | 3032 | HTTP |
| Health Dashboard API | 3033 | HTTP |
| Qdrant HTTP | 6333 | HTTP |
| Qdrant gRPC | 6334 | gRPC |
| Redis | 6379 | TCP |
| Memgraph Bolt | 7687 | Bolt |
| Memgraph Lab | 3100 | HTTP |

### Volume Mounts

| Mount | Type | Purpose |
|-------|------|---------|
| `${CODING_REPO}/.data` | Bind | Knowledge graph, SQLite |
| `${CODING_REPO}/.specstory` | Bind | Session history |
| `${HOME}/Agentic` | Bind (ro) | Workspace (all repos) |
| `${CODING_REPO}/.env` | Bind (ro) | Configuration |

## Docker Auto-Start

The launcher automatically starts Docker Desktop if it isn't running — no need to launch Docker manually before running `coding`.

### What Happens at Launch

1. **Daemon check** — `docker ps` with 5-second timeout
2. **Auto-start** — If Docker is not running, launches Docker Desktop and waits up to 45 seconds
3. **Hung recovery** — If Docker Desktop is running but the daemon is unresponsive (common after failed updates), the launcher performs a graceful quit → force kill → relaunch cycle with an additional 30 seconds of wait time
4. **Non-blocking** — If Docker still isn't ready after all timeouts, the launcher continues with a warning (degraded mode)

### Timeout Configuration

The default timeout is 45 seconds, configurable via the `DOCKER_TIMEOUT` environment variable:

```bash
# Extend timeout for slow machines
DOCKER_TIMEOUT=90 coding --claude
```

Smart elapsed tracking ensures the total wait is predictable: if 20 seconds have already passed during early startup, only 25 seconds remain in the wait loop.

### Platform Support

| Platform | Auto-Start Method |
|----------|------------------|
| macOS | `open -F -a "Docker"` + daemon polling |
| Linux | `systemctl start docker` (if systemd available) |

---

## How It Works

### Stdio Proxy Pattern

Claude CLI expects MCP servers to communicate via stdio. In Docker mode:

1. **Host** runs lightweight stdio proxy scripts
2. **Proxy** connects to containerized SSE server via HTTP
3. **Container** runs the actual MCP server as HTTP/SSE service
4. **Requests** flow: Claude -> stdio -> proxy -> HTTP -> container

This pattern allows:
- Persistent services that survive session restarts
- Shared browser automation across parallel Claude sessions
- Better resource isolation

### MCP Config Generation

When Docker mode is detected, `scripts/generate-docker-mcp-config.sh` creates `claude-code-mcp-docker.json` with stdio proxy configurations:

```json
{
  "mcpServers": {
    "semantic-analysis": {
      "command": "node",
      "args": ["path/to/stdio-proxy.js"],
      "env": {
        "SEMANTIC_ANALYSIS_SSE_URL": "http://localhost:3848"
      }
    }
  }
}
```

## Operations

### View Logs

```bash
# All services
docker compose -f docker/docker-compose.yml logs -f

# Specific service
docker compose -f docker/docker-compose.yml logs -f coding-services
```

### Restart Services

```bash
# Restart all
docker compose -f docker/docker-compose.yml restart

# Restart specific service
docker compose -f docker/docker-compose.yml restart coding-services
```

### Stop Services

```bash
docker compose -f docker/docker-compose.yml down
```

### Rebuild Containers

```bash
docker compose -f docker/docker-compose.yml build --no-cache
```

## Troubleshooting

### Container Not Starting

1. Check logs: `docker compose logs coding-services`
2. Verify databases are healthy: `docker compose ps`
3. Check entrypoint script completed: Look for "All databases healthy" in logs

### MCP Server Not Responding

1. Check health endpoint: `curl http://localhost:3848/health`
2. Check supervisord status: `docker exec coding-services supervisorctl status`
3. View MCP server logs: `docker exec coding-services tail -f /var/log/semantic-analysis.log`

### Proxy Connection Failed

1. Verify container is running: `docker ps | grep coding-services`
2. Check port mapping: `docker port coding-services`
3. Test connectivity: `curl http://localhost:3848/health`

## Switching Between Modes

### Native to Docker

```bash
touch .docker-mode
# Restart Claude
```

### Docker to Native

```bash
rm .docker-mode
docker compose -f docker/docker-compose.yml down
# Restart Claude
```

## See Also

- [Architecture Documentation](../docs/architecture/README.md)
- [.env.ports Configuration](../.env.ports)
- [Health Monitoring](../docs/health-system/README.md)
