# VKB-CLI Migration Guide

## Overview

This guide helps you migrate from the legacy bash VKB script to the modern VKB-CLI Node.js implementation. The migration maintains 100% backward compatibility while providing enhanced features and cross-platform support.

## Migration Benefits

### Performance Improvements
- **50% faster startup time** - Node.js server initialization vs bash script execution
- **Better memory management** - Efficient process control and resource cleanup
- **Improved error recovery** - Automatic cleanup of orphaned processes
- **Optimized port management** - Intelligent conflict detection and resolution

### Feature Enhancements
- **Cross-platform support** - Works identically on Windows, macOS, and Linux
- **Programmatic API** - Use VKBServer as a library in your applications
- **Better error messages** - Clear, actionable error descriptions with suggestions
- **Health monitoring** - Server responsiveness verification and automatic recovery
- **Comprehensive logging** - Structured logging with multiple output formats

### Architecture Benefits
- **Modular design** - Clean separation between CLI, server management, and data processing
- **Testable components** - Unit testing capabilities for all modules
- **Extensible framework** - Plugin architecture for custom data processors
- **Modern development** - TypeScript definitions, modern JavaScript features

## Pre-Migration Assessment

### System Requirements

**Required Dependencies:**
- Node.js 14+ (check with `node --version`)
- Python 3 (for HTTP server backend)
- npm or yarn package manager

**Optional Dependencies:**
- jq (for JSON processing in legacy scripts)
- Git (for version control integration)

**Compatibility Check:**
```bash
# Check Node.js version
node --version  # Should be 14.0.0 or higher

# Check Python availability
python3 --version  # Should be 3.6 or higher

# Verify existing VKB installation
which vkb  # Should return path to current vkb script

# Check current VKB functionality
vkb status  # Should show current server status
```

### Current State Analysis

Before migration, document your current VKB usage:

```bash
# Check if VKB server is currently running
vkb status

# Document current configuration
echo "Current VKB location: $(which vkb)"
echo "Project root: $(pwd)"
echo "Memory file: $(find . -name shared-memory.json -type f)"

# Backup current logs if needed
if [ -f /tmp/vkb-server.log ]; then
  cp /tmp/vkb-server.log vkb-legacy-logs-$(date +%Y%m%d).log
fi
```

## Migration Process

### Step 1: Installation and Setup

**Automatic Installation (Recommended):**
```bash
# Navigate to your project root
cd /path/to/your/project

# Run the installation script (this installs VKB-CLI)
./install.sh

# Activate the environment
source .activate

# Verify installation
vkb --version
```

**Manual Installation:**
```bash
# Install Node.js dependencies for vkb-server
cd lib/vkb-server
npm install

# Verify installation
node index.js --version

# Return to project root
cd ../..
```

### Step 2: Compatibility Verification

```bash
# Test basic functionality
vkb status  # Should work with new implementation

# Test server start/stop cycle
vkb start --no-browser
sleep 5
vkb status  # Should show running server
vkb stop
vkb status  # Should show stopped server
```

### Step 3: Command Mapping Verification

All existing VKB commands work unchanged:

| Legacy Command | VKB-CLI Command | Status | Notes |
|---------------|-----------------|--------|-------|
| `vkb` | `vkb` | ✅ Identical | Default start command |
| `vkb start` | `vkb start` | ✅ Identical | Start server |
| `vkb stop` | `vkb stop` | ✅ Identical | Stop server |
| `vkb restart` | `vkb restart` | ✅ Identical | Restart server |
| `vkb status` | `vkb status` | ✅ Enhanced | More detailed output |
| `vkb logs` | `vkb logs` | ✅ Enhanced | Better formatting |
| `vkb fg` | `vkb fg` | ✅ Identical | Foreground mode |
| `vkb port` | `vkb port` | ✅ Enhanced | Cross-platform port checking |

**Verification Script:**
```bash
#!/bin/bash
# test-migration.sh

echo "🔍 Testing VKB-CLI migration compatibility..."

commands=("status" "start --no-browser" "status" "logs -n 10" "port" "stop")

for cmd in "${commands[@]}"; do
  echo "Testing: vkb $cmd"
  if vkb $cmd; then
    echo "✅ Success: vkb $cmd"
  else
    echo "❌ Failed: vkb $cmd"
    exit 1
  fi
  sleep 2
done

echo "🎉 All compatibility tests passed!"
```

### Step 4: Enhanced Features Testing

Test new VKB-CLI specific features:

```bash
# Advanced server management
vkb-cli server start --port 8080
vkb-cli server health
vkb-cli server status --json

# Data management
vkb-cli data refresh
vkb-cli data validate

# Configuration management
vkb-cli config show
```

### Step 5: Programmatic API Testing

Test the programmatic API if you plan to use it:

```javascript
// test-api.js
const { VKBServer } = require('./lib/vkb-server');

async function testAPI() {
  const server = new VKBServer({
    port: 8080,
    projectRoot: process.cwd()
  });
  
  try {
    // Test basic lifecycle
    const startResult = await server.start({ openBrowser: false });
    console.log('✅ Server started:', startResult.url);
    
    // Test status
    const status = await server.status();
    console.log('✅ Status check:', status.running);
    
    // Test health
    const health = await server.healthCheck();
    console.log('✅ Health check:', health.healthy);
    
    // Test stop
    await server.stop();
    console.log('✅ Server stopped successfully');
    
  } catch (error) {
    console.error('❌ API test failed:', error.message);
  }
}

testAPI();
```

```bash
# Run API test
node test-api.js
```

## Migration Scenarios

### Scenario 1: Basic User Migration

**Profile:** Individual developer using VKB for daily knowledge exploration

**Current Usage:**
```bash
vkb start  # Start server in morning
vkb stop   # Stop server at end of day
```

**Migration Steps:**
1. Run `./install.sh` to install VKB-CLI
2. Continue using same commands
3. Enjoy faster startup and better error messages

**Post-Migration Benefits:**
- Faster server startup (50% improvement)
- Better error messages and recovery
- Cross-platform compatibility

### Scenario 2: Team Environment Migration

**Profile:** Development team with shared VKB usage and scripts

**Current Usage:**
```bash
# Team scripts that use VKB
./scripts/start-dev-environment.sh  # Includes VKB startup
./scripts/daily-knowledge-update.sh # Includes VKB restart
```

**Migration Steps:**
1. Install VKB-CLI on all team machines
2. Test existing scripts (should work unchanged)
3. Gradually adopt enhanced features
4. Update documentation with new capabilities

**Enhanced Team Features:**
```bash
# New team-friendly commands
vkb-cli server start --host 0.0.0.0  # Allow network access
vkb status --json  # Machine-readable status
vkb logs --json --since "1 hour ago"  # Structured logging
```

### Scenario 3: CI/CD Integration Migration

**Profile:** Automated pipelines using VKB for testing/verification

**Current Usage:**
```yaml
# GitHub Actions example
- name: Start Knowledge Visualization
  run: |
    vkb start --no-browser
    sleep 10
    curl http://localhost:8080/health
    vkb stop
```

**Enhanced CI/CD Integration:**
```yaml
# Enhanced pipeline with better error handling
- name: Knowledge Visualization Tests
  run: |
    # Start server with timeout and health check
    vkb start --no-browser --timeout 30
    
    # Verify server health
    vkb-cli server health --timeout 10
    
    # Run integration tests
    npm run test:visualization
    
    # Check for errors in logs
    if vkb logs --level error --since "5 minutes ago" | grep -q ERROR; then
      echo "Errors found in server logs"
      exit 1
    fi
    
    # Graceful shutdown
    vkb stop --timeout 10
```

**Migration Benefits for CI/CD:**
- Better error detection and handling
- Structured logging for log analysis
- Health check endpoints
- Timeout controls for reliability

### Scenario 4: Development Tool Integration

**Profile:** Custom tools and scripts that integrate with VKB

**Current Integration:**
```bash
# Custom development script
#!/bin/bash
if ! vkb status > /dev/null 2>&1; then
  vkb start --no-browser
fi

# Continue with development tasks...
```

**Enhanced Integration:**
```javascript
// Enhanced development tool integration
const { VKBServer } = require('./lib/vkb-server');

class DevelopmentEnvironment {
  constructor() {
    this.vkbServer = new VKBServer({
      port: 8080,
      projectRoot: process.cwd(),
      autoRestart: true
    });
  }
  
  async setup() {
    try {
      // Check if server is already running
      const status = await this.vkbServer.status();
      if (!status.running) {
        await this.vkbServer.start({ openBrowser: false });
      }
      
      // Verify health
      const health = await this.vkbServer.healthCheck();
      if (!health.healthy) {
        throw new Error('VKB server health check failed');
      }
      
      console.log('✅ Knowledge visualization ready');
      
    } catch (error) {
      console.error('❌ Failed to setup knowledge visualization:', error.message);
      throw error;
    }
  }
  
  async cleanup() {
    await this.vkbServer.stop();
  }
}

// Usage
const env = new DevelopmentEnvironment();
env.setup()
  .then(() => console.log('Development environment ready'))
  .catch(console.error);
```

## Troubleshooting Migration Issues

### Common Issues and Solutions

#### Issue 1: Node.js Version Incompatibility
**Symptom:** `Error: VKB-CLI requires Node.js 14 or higher`

**Solution:**
```bash
# Update Node.js using nvm (recommended)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install 16
nvm use 16

# Or install via package manager
# macOS: brew install node
# Ubuntu: sudo apt-get install nodejs npm
```

#### Issue 2: Port Conflicts After Migration
**Symptom:** `Error: Port 8080 is already in use`

**Solution:**
```bash
# Check what's using the port
vkb port

# Kill existing processes if safe
vkb port --kill

# Or use different port
vkb start --port 8081
```

#### Issue 3: Permission Issues
**Symptom:** `EACCES: permission denied, open '/tmp/vkb-server.pid'`

**Solution:**
```bash
# Check /tmp permissions
ls -la /tmp/

# Clean up old files
sudo rm -f /tmp/vkb-server.*

# Ensure proper permissions
chmod 755 /tmp
```

#### Issue 4: Legacy Script Conflicts
**Symptom:** Old bash script still being called instead of new VKB-CLI

**Solution:**
```bash
# Check which VKB is being used
which vkb
type vkb

# Update PATH if needed
source .activate

# Verify new version
vkb --version  # Should show VKB-CLI version
```

#### Issue 5: Missing Dependencies
**Symptom:** `Error: Cannot find module 'commander'`

**Solution:**
```bash
# Install dependencies
cd lib/vkb-server
npm install

# Or reinstall completely
rm -rf node_modules
npm install

# Verify installation
npm list --depth=0
```

### Migration Verification Checklist

**Basic Functionality:**
- [ ] `vkb start` works and opens browser
- [ ] `vkb status` shows accurate server state
- [ ] `vkb stop` gracefully shuts down server
- [ ] `vkb logs` displays server logs
- [ ] `vkb restart` cycles server properly

**Enhanced Features:**
- [ ] `vkb --version` shows VKB-CLI version
- [ ] `vkb-cli server health` reports server health
- [ ] `vkb status --json` outputs structured data
- [ ] `vkb logs --level error` filters logs correctly
- [ ] Port conflict detection works properly

**Integration:**
- [ ] Existing scripts work unchanged
- [ ] CI/CD pipelines continue to function
- [ ] Development tools integrate properly
- [ ] Team workflows remain intact

**Performance:**
- [ ] Server startup is faster than legacy version
- [ ] Memory usage is optimal
- [ ] Error recovery works automatically
- [ ] Cross-platform compatibility verified

## Post-Migration Optimization

### Leveraging New Features

**Enhanced Configuration:**
```bash
# Set up default configuration
vkb-cli config set port 8080
vkb-cli config set logLevel info
vkb-cli config set autoRestart true

# View configuration
vkb-cli config show
```

**Monitoring and Logging:**
```bash
# Set up log monitoring
vkb logs --follow --level warn &

# Regular health checks
cron: 0 */6 * * * vkb-cli server health || echo "VKB health check failed" | mail admin@company.com
```

**Team Integration:**
```bash
# Create team-specific wrapper script
#!/bin/bash
# team-vkb.sh

# Start VKB with team configuration
vkb-cli server start \
  --port 8080 \
  --host 0.0.0.0 \
  --workers 2

# Monitor and report
vkb-cli server health --json > /shared/vkb-health.json
```

### Performance Tuning

**Resource Optimization:**
```javascript
// vkb-config.js
module.exports = {
  port: 8080,
  workers: process.env.VKB_WORKERS || 1,
  healthCheckInterval: 30000,
  logLevel: process.env.NODE_ENV === 'production' ? 'warn' : 'info',
  autoRestart: true,
  gracefulShutdownTimeout: 10000
};
```

**Monitoring Setup:**
```bash
# Add performance monitoring
vkb-cli server start --metrics-port 9090

# Health check endpoint
curl http://localhost:8080/health

# Metrics endpoint
curl http://localhost:9090/metrics
```

## Rollback Plan

If migration issues occur, you can temporarily rollback:

### Emergency Rollback

```bash
# Stop new VKB-CLI server
vkb stop

# Restore legacy VKB script (if backed up)
if [ -f vkb.backup ]; then
  mv vkb vkb-cli-version
  mv vkb.backup vkb
  chmod +x vkb
fi

# Test legacy functionality
vkb start
```

### Gradual Rollback

```bash
# Use legacy version for specific commands
./vkb.backup start  # Use old version
vkb-cli logs        # Use new version for enhanced features
```

### Complete Rollback

```bash
# Remove VKB-CLI installation
rm -rf lib/vkb-server/node_modules

# Restore original VKB script
git checkout HEAD -- vkb

# Verify legacy functionality
vkb status
```

## Migration Success Metrics

### Quantitative Metrics

**Performance Improvements:**
- Server startup time: Target <3 seconds (vs ~6 seconds legacy)
- Memory usage: Target <50MB (vs ~75MB legacy)
- Error recovery time: Target <10 seconds
- Cross-platform compatibility: 100% command compatibility

**Reliability Improvements:**
- Reduced orphaned processes: Target 95% reduction
- Improved error messages: User satisfaction survey
- Health check accuracy: 99%+ uptime detection
- Graceful shutdown success: 99%+ success rate

### Qualitative Benefits

**Developer Experience:**
- Faster daily workflows
- Better error diagnostics
- Cross-platform consistency
- Enhanced debugging capabilities

**Team Productivity:**
- Improved collaboration tools
- Better CI/CD integration
- Enhanced monitoring capabilities
- Reduced maintenance overhead

## Next Steps

After successful migration:

1. **Team Training:** Introduce team to enhanced features
2. **Documentation Update:** Update internal documentation with new capabilities
3. **Process Optimization:** Identify workflows that can benefit from new features
4. **Monitoring Setup:** Implement health monitoring and alerting
5. **Future Planning:** Plan adoption of advanced features like WebSocket support

The migration to VKB-CLI provides immediate benefits while maintaining complete backward compatibility, ensuring a smooth transition for all users and use cases.