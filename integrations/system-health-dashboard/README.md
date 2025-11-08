# System Health Dashboard

Real-time monitoring dashboard for system-level health checks including databases, services, and processes.

## Architecture

- **Frontend**: Next.js 15.5.4 + React 19 + Redux Toolkit (MVI pattern)
- **Backend**: Express.js API server
- **Ports**:
  - Dashboard: 3032 (Next.js)
  - API: 3033 (Express)

## Features

- Real-time health monitoring (5s refresh)
- Database health (LevelDB, Qdrant)
- Service availability (VKB, Constraint Monitor, Dashboard)
- Process health (stale PIDs, zombies)
- Auto-healing status and history
- Manual verification trigger
- Detailed violation reports
- System recommendations

## Quick Start

### Development

```bash
# Install dependencies
pnpm install

# Start API server (port 3033)
node server.js

# Start dashboard (port 3032) - in another terminal
pnpm dev
```

### Production

```bash
# Build dashboard
pnpm build

# Start both services
node server.js & pnpm start
```

## Environment Variables

All ports are configured in `../../.env.ports`:

- `SYSTEM_HEALTH_DASHBOARD_PORT` - Dashboard frontend port (default: 3032)
- `SYSTEM_HEALTH_API_PORT` - API backend port (default: 3033)

## API Endpoints

### GET `/api/health-verifier/status`
Returns current health verification status

```json
{
  "status": "success",
  "data": {
    "overallStatus": "degraded",
    "violationCount": 1,
    "criticalCount": 0,
    "lastUpdate": "2025-11-08T13:00:00.000Z",
    "autoHealingActive": false,
    "status": "operational",
    "ageMs": 5234
  }
}
```

### GET `/api/health-verifier/report`
Returns detailed health verification report with all checks and violations

### POST `/api/health-verifier/verify`
Triggers a manual health verification run

## Redux Store Structure

```
healthStatus/       # Current health status state
  - overallStatus
  - violationCount
  - criticalCount
  - lastUpdate
  - autoHealingActive

healthReport/       # Detailed verification report
  - checks[]
  - violations[]
  - recommendations[]
  - summary

autoHealing/        # Auto-healing control
  - enabled
  - recentAttempts[]
  - triggeringVerification
```

## Integration with Health Verifier

This dashboard consumes data from:
- `scripts/health-verifier.js` - Health verification engine
- `.health/verification-status.json` - Quick status file
- `.health/verification-report.json` - Detailed report

## Development

The dashboard follows the same architecture patterns as the Constraint Monitor Dashboard:
- Redux Toolkit for state management
- MVI (Model-View-Intent) architecture
- Middleware for auto-refresh and API calls
- TypeScript strict mode
- Tailwind CSS for styling
- Radix UI components

## Links

- Constraint Monitor Dashboard: http://localhost:3030
- System Health Dashboard: http://localhost:3032
- System Health API: http://localhost:3033
