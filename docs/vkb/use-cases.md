# VKB-CLI Use Cases

## Overview

This document provides comprehensive use cases for VKB-CLI, demonstrating how the knowledge visualization server integrates into various development workflows and team collaboration scenarios.

## Development Workflow Integration

### Use Case 1: Daily Development Session

**Scenario:** A developer starts their workday and wants to quickly access the team's knowledge base visualization.

**Workflow:**
```bash
# Start development session
cd /path/to/project
vkb start

# Server starts, opens browser automatically
# Developer can now explore knowledge graph
# Server runs in background throughout the day

# End of day - stop server
vkb stop
```

**Benefits:**
- **Zero-configuration startup** - works out of the box
- **Automatic browser integration** - immediate access to visualization
- **Background operation** - doesn't interfere with development tasks
- **Persistent session** - maintains server state throughout the day

**Ideal for:**
- Daily knowledge exploration
- Quick reference during development
- Team knowledge sharing sessions
- Documentation review and creation

### Use Case 2: Knowledge Base Updates

**Scenario:** After using UKB to capture new insights, a developer wants to refresh the visualization with the latest data.

**Workflow:**
```bash
# Capture new insights with UKB
ukb --interactive

# Refresh visualization without restarting server
vkb-cli data refresh

# Or restart server for comprehensive refresh
vkb restart
```

**Benefits:**
- **Live data updates** - see new insights immediately
- **No manual file management** - automatic data synchronization
- **Minimal disruption** - refresh without full restart
- **Consistency** - always shows latest knowledge state

**Ideal for:**
- Post-insight capture workflow
- Team knowledge review sessions
- Documentation updates
- Pattern discovery activities

### Use Case 3: Debugging and Troubleshooting

**Scenario:** A developer encounters issues with the visualization server and needs to debug the problem.

**Workflow:**
```bash
# Start server in foreground for debugging
vkb fg --debug

# Monitor server logs in real-time
vkb logs --follow

# Check what's using the port if conflicts occur
vkb port

# Check server health status
vkb status --verbose

# Force restart if needed
vkb stop --force && vkb start
```

**Benefits:**
- **Comprehensive debugging tools** - logs, status, port checking
- **Real-time monitoring** - follow log output as it happens
- **Detailed diagnostics** - verbose status information
- **Recovery options** - force restart and cleanup capabilities

**Ideal for:**
- Server troubleshooting
- Network configuration issues
- Development environment setup
- System administration tasks

## Server Management Operations

### Use Case 4: Production-like Environment

**Scenario:** A team wants to run the visualization server in a production-like environment with monitoring and management capabilities.

**Workflow:**
```bash
# Start server with custom configuration
vkb-cli server start --port 8080 --workers 2

# Monitor server health
vkb-cli server health

# Check detailed status
vkb-cli server status --json

# Manage logs with rotation
vkb-cli server logs --format json --rotate

# Graceful shutdown
vkb-cli server stop --timeout 30
```

**Benefits:**
- **Production-ready features** - health checks, monitoring, log management
- **Scalability options** - worker processes, custom configuration
- **Operational visibility** - JSON logging, metrics, status reporting
- **Graceful lifecycle** - proper startup and shutdown procedures

**Ideal for:**
- Team server deployment
- CI/CD integration
- Production monitoring
- Service management

### Use Case 5: Multi-Project Development

**Scenario:** A developer works on multiple projects and needs to switch between different knowledge bases.

**Workflow:**
```bash
# Project A - start visualization
cd /path/to/project-a
vkb start --port 8080

# Project B - start on different port
cd /path/to/project-b  
vkb start --port 8081

# Check both servers
vkb-cli server status --all

# Switch between projects in browser
open http://localhost:8080  # Project A
open http://localhost:8081  # Project B

# Cleanup - stop all servers
vkb-cli server stop --all
```

**Benefits:**
- **Multi-instance support** - run multiple servers simultaneously
- **Port management** - automatic port conflict resolution
- **Project isolation** - separate knowledge bases per project
- **Unified management** - control all instances from command line

**Ideal for:**
- Multi-project development
- Comparative analysis
- Team knowledge sharing
- Client project management

## Programmatic Server Control

### Use Case 6: Automated Testing Integration

**Scenario:** A development team wants to integrate knowledge visualization into their automated testing pipeline.

**Implementation:**
```javascript
// test-setup.js
const { VKBServer } = require('vkb-server');

let server;

beforeAll(async () => {
  server = new VKBServer({
    port: 8080,
    projectRoot: process.cwd(),
    logLevel: 'error' // Quiet during tests
  });
  
  await server.start({
    foreground: false,
    openBrowser: false
  });
  
  // Wait for server to be ready
  await server.healthCheck();
});

afterAll(async () => {
  await server.stop();
});

// Integration tests
describe('Knowledge Visualization', () => {
  test('server responds to health check', async () => {
    const health = await server.healthCheck();
    expect(health.healthy).toBe(true);
  });
  
  test('knowledge base data is accessible', async () => {
    const response = await fetch('http://localhost:8080/api/kb/info');
    const data = await response.json();
    expect(data.entities).toBeGreaterThan(0);
  });
  
  test('data refresh works correctly', async () => {
    const result = await server.refreshData();
    expect(result.success).toBe(true);
  });
});
```

**Benefits:**
- **Automated verification** - ensure visualization works in CI/CD
- **Programmatic control** - start/stop server in test lifecycle
- **Health monitoring** - verify server state during tests
- **Data validation** - ensure knowledge base is properly served

**Ideal for:**
- Continuous integration
- Automated testing pipelines
- Quality assurance
- Deployment verification

### Use Case 7: Development Tool Integration

**Scenario:** A team wants to integrate knowledge visualization into their development environment and tools.

**Implementation:**
```javascript
// VS Code extension integration
const vscode = require('vscode');
const { VKBServer } = require('vkb-server');

class KnowledgeVisualizationProvider {
  constructor() {
    this.server = new VKBServer({
      port: 8080,
      projectRoot: vscode.workspace.rootPath
    });
  }
  
  async showVisualization() {
    try {
      // Start server if not running
      const status = await this.server.status();
      if (!status.running) {
        await this.server.start({ openBrowser: false });
      }
      
      // Show in VS Code webview
      const panel = vscode.window.createWebviewPanel(
        'knowledgeVisualization',
        'Knowledge Base Visualization',
        vscode.ViewColumn.Two,
        { enableScripts: true }
      );
      
      panel.webview.html = `
        <iframe src="http://localhost:8080" 
                width="100%" height="100%" 
                frameborder="0">
        </iframe>
      `;
      
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to start visualization: ${error.message}`);
    }
  }
  
  async refreshData() {
    try {
      const result = await this.server.refreshData();
      vscode.window.showInformationMessage(
        `Knowledge base refreshed: ${result.entities} entities, ${result.relations} relations`
      );
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to refresh data: ${error.message}`);
    }
  }
}

// Register commands
const provider = new KnowledgeVisualizationProvider();

vscode.commands.registerCommand('knowledge.show', () => {
  provider.showVisualization();
});

vscode.commands.registerCommand('knowledge.refresh', () => {
  provider.refreshData();
});
```

**Benefits:**
- **IDE integration** - seamless knowledge access within development environment
- **Context awareness** - project-specific knowledge visualization
- **Workflow integration** - commands available in IDE command palette
- **Real-time updates** - refresh data without leaving IDE

**Ideal for:**
- IDE extension development
- Development environment customization
- Team productivity tools
- Context-aware assistance

### Use Case 8: Custom Automation Workflows

**Scenario:** A team wants to create custom automation workflows that incorporate knowledge visualization.

**Implementation:**
```javascript
// automation-workflow.js
const { VKBServer } = require('vkb-server');
const { execSync } = require('child_process');

class KnowledgeWorkflow {
  constructor() {
    this.server = new VKBServer({
      port: 8080,
      projectRoot: process.cwd(),
      autoRestart: true
    });
  }
  
  async dailyKnowledgeUpdate() {
    console.log('🔄 Starting daily knowledge update workflow...');
    
    try {
      // 1. Update knowledge base with latest insights
      console.log('📝 Capturing new insights...');
      execSync('ukb --auto --depth 20', { stdio: 'inherit' });
      
      // 2. Start visualization server
      console.log('🚀 Starting visualization server...');
      await this.server.start({ openBrowser: false });
      
      // 3. Refresh data
      console.log('🔄 Refreshing visualization data...');
      const refreshResult = await this.server.refreshData();
      console.log(`✅ Loaded ${refreshResult.entities} entities, ${refreshResult.relations} relations`);
      
      // 4. Validate data integrity
      console.log('🔍 Validating data integrity...');
      const health = await this.server.healthCheck();
      if (!health.healthy) {
        throw new Error('Server health check failed');
      }
      
      // 5. Generate report
      console.log('📊 Generating knowledge report...');
      const status = await this.server.status();
      const report = {
        timestamp: new Date().toISOString(),
        entities: refreshResult.entities,
        relations: refreshResult.relations,
        serverStatus: status,
        url: `http://localhost:${status.port}`
      };
      
      console.log('📈 Daily Knowledge Update Complete!');
      console.log(`📊 Report:`, JSON.stringify(report, null, 2));
      
      return report;
      
    } catch (error) {
      console.error('❌ Daily knowledge update failed:', error.message);
      throw error;
    }
  }
  
  async continuousIntegration() {
    console.log('🔄 Running CI knowledge validation...');
    
    try {
      // Start server for testing
      await this.server.start({ 
        openBrowser: false,
        foreground: false 
      });
      
      // Run health checks
      const health = await this.server.healthCheck();
      if (!health.healthy) {
        throw new Error('Knowledge visualization server is unhealthy');
      }
      
      // Validate data
      const logs = await this.server.logs({ level: 'error', lines: 10 });
      if (logs.lines.length > 0) {
        console.warn('⚠️  Found error logs:', logs.lines);
      }
      
      // Performance check
      if (health.responseTime > 1000) {
        console.warn(`⚠️  Slow response time: ${health.responseTime}ms`);
      }
      
      console.log('✅ CI knowledge validation passed');
      
      return {
        healthy: health.healthy,
        responseTime: health.responseTime,
        errors: logs.lines.length
      };
      
    } finally {
      // Always cleanup
      await this.server.stop();
    }
  }
}

// Usage examples
if (require.main === module) {
  const workflow = new KnowledgeWorkflow();
  
  // Daily update
  if (process.argv.includes('--daily')) {
    workflow.dailyKnowledgeUpdate()
      .then(report => {
        console.log('📊 Daily update complete:', report);
        process.exit(0);
      })
      .catch(error => {
        console.error('❌ Daily update failed:', error);
        process.exit(1);
      });
  }
  
  // CI validation
  if (process.argv.includes('--ci')) {
    workflow.continuousIntegration()
      .then(result => {
        console.log('✅ CI validation passed:', result);
        process.exit(0);
      })
      .catch(error => {
        console.error('❌ CI validation failed:', error);
        process.exit(1);
      });
  }
}
```

**Usage:**
```bash
# Daily knowledge update
node automation-workflow.js --daily

# CI validation
node automation-workflow.js --ci

# Cron job integration
0 9 * * * cd /path/to/project && node automation-workflow.js --daily
```

**Benefits:**
- **Automated workflows** - scheduled knowledge updates and validation
- **CI/CD integration** - validate knowledge visualization in pipelines
- **Error detection** - automated health checks and error reporting
- **Performance monitoring** - track response times and server health

**Ideal for:**
- Automated knowledge management
- Continuous integration pipelines
- Performance monitoring
- Scheduled maintenance tasks

## Team Collaboration

### Use Case 9: Knowledge Sharing Sessions

**Scenario:** A team conducts regular knowledge sharing sessions where they explore the knowledge base together.

**Workflow:**
```bash
# Presenter starts server
vkb start

# Team members access via network
vkb-cli config set host 0.0.0.0  # Allow network access
vkb restart

# Team accesses via: http://presenter-ip:8080

# During session - refresh with latest insights
vkb-cli data refresh

# After session - generate sharing report
vkb-cli server logs --since "1 hour ago" > session-log.txt
vkb-cli data export --format json --output session-knowledge.json
```

**Benefits:**
- **Collaborative exploration** - team can explore knowledge together
- **Real-time updates** - incorporate new insights during session
- **Session documentation** - logs and data exports for reference
- **Network accessibility** - easy sharing across team members

**Ideal for:**
- Team knowledge sharing
- Architecture review sessions
- Onboarding new team members
- Pattern discovery workshops

### Use Case 10: Remote Development Support

**Scenario:** A remote developer needs to share their knowledge base with team members for debugging assistance.

**Workflow:**
```bash
# Remote developer starts server with network access
vkb start --host 0.0.0.0 --port 8080

# Share access URL with team
echo "Knowledge base available at: http://$(curl -s ifconfig.me):8080"

# Team members access remotely
# Developer can refresh data during session
vkb-cli data refresh

# Share server logs for debugging context
vkb logs -n 100 --json > debug-context.json
```

**Benefits:**
- **Remote collaboration** - share knowledge base across networks
- **Real-time debugging** - team can see current project state
- **Context sharing** - logs provide debugging context
- **Collaborative problem-solving** - team can explore together

**Ideal for:**
- Remote team support
- Debugging assistance
- Code review sessions
- Knowledge transfer

## Integration Patterns

### Use Case 11: Microservice Architecture

**Scenario:** A team developing microservices wants to visualize knowledge across multiple services.

**Implementation:**
```javascript
// microservice-knowledge.js
const { VKBServer } = require('vkb-server');
const path = require('path');

class MicroserviceKnowledgeManager {
  constructor() {
    this.services = new Map();
  }
  
  async startService(serviceName, servicePath, port) {
    const server = new VKBServer({
      port: port,
      projectRoot: servicePath,
      sharedMemoryPath: path.join(servicePath, 'shared-memory.json')
    });
    
    await server.start({ openBrowser: false });
    this.services.set(serviceName, { server, port, path: servicePath });
    
    console.log(`📊 ${serviceName} knowledge visualization: http://localhost:${port}`);
    return server;
  }
  
  async stopService(serviceName) {
    const service = this.services.get(serviceName);
    if (service) {
      await service.server.stop();
      this.services.delete(serviceName);
    }
  }
  
  async refreshAll() {
    const results = [];
    for (const [name, service] of this.services) {
      try {
        const result = await service.server.refreshData();
        results.push({ service: name, ...result });
      } catch (error) {
        results.push({ service: name, error: error.message });
      }
    }
    return results;
  }
  
  async healthCheckAll() {
    const results = [];
    for (const [name, service] of this.services) {
      try {
        const health = await service.server.healthCheck();
        results.push({ service: name, ...health });
      } catch (error) {
        results.push({ service: name, healthy: false, error: error.message });
      }
    }
    return results;
  }
}

// Usage
const manager = new MicroserviceKnowledgeManager();

// Start knowledge visualization for each service
manager.startService('api-gateway', '/path/to/api-gateway', 8080);
manager.startService('user-service', '/path/to/user-service', 8081);
manager.startService('order-service', '/path/to/order-service', 8082);
manager.startService('notification-service', '/path/to/notification-service', 8083);

// Dashboard view
console.log('🎯 Microservice Knowledge Dashboard:');
console.log('API Gateway: http://localhost:8080');
console.log('User Service: http://localhost:8081');
console.log('Order Service: http://localhost:8082');
console.log('Notification Service: http://localhost:8083');
```

**Benefits:**
- **Service-specific knowledge** - each microservice has its own visualization
- **Centralized management** - control all services from one interface
- **Cross-service patterns** - identify patterns across services
- **Distributed debugging** - debug issues across service boundaries

**Ideal for:**
- Microservice architecture
- Distributed system debugging
- Cross-service pattern analysis
- Service-specific knowledge management

### Use Case 12: Educational and Training

**Scenario:** An organization uses VKB-CLI for training developers and sharing architectural knowledge.

**Implementation:**
```javascript
// training-server.js
const { VKBServer } = require('vkb-server');

class TrainingKnowledgeServer {
  constructor() {
    this.trainingModules = new Map();
  }
  
  async createTrainingModule(moduleName, knowledgeBasePath) {
    const server = new VKBServer({
      port: 8080 + this.trainingModules.size,
      projectRoot: knowledgeBasePath,
      logLevel: 'info'
    });
    
    // Set up training-specific configuration
    server.on('started', () => {
      console.log(`📚 Training module "${moduleName}" available at: ${server.url}`);
    });
    
    await server.start({ openBrowser: false });
    this.trainingModules.set(moduleName, server);
    
    return server;
  }
  
  async generateTrainingReport(moduleName) {
    const server = this.trainingModules.get(moduleName);
    if (!server) {
      throw new Error(`Training module "${moduleName}" not found`);
    }
    
    const status = await server.status();
    const health = await server.healthCheck();
    const logs = await server.logs({ lines: 50 });
    
    return {
      module: moduleName,
      status: status,
      health: health,
      recentActivity: logs.lines.length,
      accessUrl: `http://localhost:${status.port}`
    };
  }
}

// Training scenarios
const trainer = new TrainingKnowledgeServer();

// Create training modules
trainer.createTrainingModule('React Patterns', '/path/to/react-training-kb');
trainer.createTrainingModule('Node.js Architecture', '/path/to/nodejs-training-kb');
trainer.createTrainingModule('Microservices', '/path/to/microservices-training-kb');
```

**Benefits:**
- **Structured learning** - organized knowledge modules for training
- **Interactive exploration** - hands-on knowledge graph exploration
- **Progress tracking** - monitor training module usage
- **Reusable content** - training modules can be shared and reused

**Ideal for:**
- Developer training programs
- Architecture education
- Knowledge transfer sessions
- Onboarding processes

These use cases demonstrate the versatility and power of VKB-CLI in various development and team collaboration scenarios, from simple daily usage to complex integration patterns and educational applications.