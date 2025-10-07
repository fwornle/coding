# Network Setup and Troubleshooting

## Network-Aware Installation

The installer automatically detects your network location and selects appropriate repositories:

### Corporate Network Detection

**🏢 Inside Corporate Network (CN):**
- **Detection:** Tests SSH/HTTPS access to internal repositories
- **memory-visualizer:** Uses CN mirror with team modifications
- **browserbase:** Uses public repo with proxy detection and graceful fallback

**🌍 Outside Corporate Network:**
- **Detection:** Internal repositories not accessible
- **memory-visualizer:** Uses public fork (`github.com/fwornle/memory-visualizer`)
- **browserbase:** Uses public repo (`github.com/browserbase/mcp-server-browserbase`)

### Proxy Detection and Handling

**🔍 Proxy Detection:**
When inside CN, the installer tests external connectivity using `curl google.de` to determine if proxy access is available.

**📦 Repository Strategy:**
- **Mirrored repos** (memory-visualizer): Always use CN mirror when inside CN
- **Non-mirrored repos** (browserbase): Intelligent handling based on proxy status

**⚡ Graceful Degradation:**
- **Repository exists + No proxy:** Skip updates, continue with existing version
- **Repository missing + No proxy:** Report failure with helpful hints
- **Repository exists + Proxy working:** Update successfully
- **Repository missing + Proxy working:** Clone successfully

## Installation Status Indicators

**📊 Installation Status:**
- **🟢 Success:** All components installed successfully
- **🟡 Warnings:** Some updates skipped due to network restrictions
- **🔴 Failures:** Some components missing and couldn't be installed

## Network Troubleshooting

### Common Network Issues

#### 1. Clone Failures
```bash
# Test repository access
git ls-remote <repository-url>

# If fails, try HTTPS instead of SSH
git clone https://github.com/username/repo.git
```

#### 2. MCP Server Port Conflicts
```bash
# Check if ports are in use
lsof -i :8765  # HTTP server
lsof -i :8080  # Memory visualizer

# Kill processes if needed
kill $(lsof -t -i :8765)
```

#### 3. Proxy Configuration
```bash
# Configure git for proxy
git config --global http.proxy http://proxy.company.com:8080
git config --global https.proxy https://proxy.company.com:8080

# Configure npm for proxy
npm config set proxy http://proxy.company.com:8080
npm config set https-proxy https://proxy.company.com:8080
```

#### 4. SSH Key Issues
```bash
# Test SSH connectivity
ssh -T git@github.com

# Generate new SSH key if needed
ssh-keygen -t ed25519 -C "your.email@company.com"
ssh-add ~/.ssh/id_ed25519
```

### Firewall Configuration

#### Required Outbound Ports
- **80/443**: HTTPS access to repositories
- **22**: SSH access to repositories (if using SSH)
- **8765**: Fallback HTTP server (local)
- **8080**: Memory visualizer (local)

#### Corporate Network Setup
```bash
# Test external connectivity
curl -I https://github.com
curl -I https://npmjs.org

# Test internal connectivity (if applicable)
curl -I https://internal-git.company.com
```

### Network Diagnostics

#### Connection Testing Script
```bash
#!/bin/bash
echo "Testing network connectivity..."

# Test DNS resolution
nslookup github.com

# Test HTTP connectivity
curl -I --connect-timeout 5 https://github.com

# Test SSH connectivity
ssh -T -o ConnectTimeout=5 git@github.com

# Test proxy settings
env | grep -i proxy

echo "Network test complete"
```

#### Debug Mode Installation
```bash
# Run installer with debug output
DEBUG=1 ./install.sh

# Check installation logs
tail -f ~/.coding-tools/logs/install.log
```

### Alternative Installation Methods

#### Offline Installation
```bash
# Download dependencies on connected machine
npm pack <package-name>

# Transfer to offline machine and install
npm install <package-name>.tgz
```

#### Manual Repository Setup
```bash
# If automatic detection fails, manually configure
export CODING_TOOLS_PATH="$HOME/coding"
export MEMORY_VISUALIZER_REPO="https://github.com/alternative/memory-visualizer"
./install.sh
```

### Corporate Network Best Practices

1. **Use HTTPS over SSH** when behind firewalls
2. **Configure proxy settings** for all tools (git, npm, pip)
3. **Whitelist required domains** with IT security
4. **Use internal mirrors** when available
5. **Test connectivity** before installation

### Required Domain Whitelist

For corporate firewalls, request access to:
- `github.com`
- `npmjs.org`
- `pypi.org`
- `raw.githubusercontent.com`
- Internal repository domains (if applicable)

## Next Steps

- **[Quick Start](quick-start.md)** - Basic installation
- **[MCP Configuration](mcp-configuration.md)** - Claude Code setup
- **[System Architecture](../architecture/system-overview.md)** - Understand the system