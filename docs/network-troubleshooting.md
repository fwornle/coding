# Network Troubleshooting Guide

This guide helps diagnose and resolve common network-related issues when using the Claude Knowledge Management system in enterprise environments.

## Common Issues and Solutions

### 1. SSH Connection Failures

**Symptoms:**

- `Permission denied (publickey)` errors
- `Connection refused` when accessing corporate GitHub
- SSH timeouts during installation

**Diagnostics:**

```bash
# Test SSH connectivity
ssh -T git@cc-github.bmwgroup.net
ssh -T git@github.com

# Check SSH agent
ssh-add -l

# Verbose SSH debugging
ssh -vvv -T git@cc-github.bmwgroup.net
```

**Solutions:**

```bash
# Ensure SSH keys are loaded
ssh-add ~/.ssh/id_rsa_work
ssh-add ~/.ssh/id_rsa_personal

# Fix SSH key permissions
chmod 600 ~/.ssh/id_rsa*
chmod 644 ~/.ssh/id_rsa*.pub

# Add to SSH config
cat >> ~/.ssh/config << 'EOF'
Host cc-github.bmwgroup.net
    User git
    IdentityFile ~/.ssh/id_rsa_work
    IdentitiesOnly yes
EOF
```

### 2. Corporate Proxy Issues

**Symptoms:**

- Installation hangs on external repository access
- `curl: (7) Failed to connect` errors
- Git operations timeout

**Diagnostics:**

```bash
# Test external connectivity
curl -I https://google.de
curl -I https://github.com

# Check proxy settings
echo $http_proxy
echo $https_proxy
env | grep -i proxy
```

**Solutions:**
```bash
# Configure git proxy (if needed)
git config --global http.proxy http://proxy.company.com:8080
git config --global https.proxy http://proxy.company.com:8080

# Bypass proxy for internal hosts
git config --global http.https://cc-github.bmwgroup.net.proxy ""

# Test with timeout
timeout 10s git ls-remote https://github.com/user/repo.git
```

### 3. Network Detection Failures

**Symptoms:**
- Installation script fails to detect corporate network
- Wrong repository URLs selected
- "Unable to determine network environment" errors

**Manual Network Detection:**
```bash
# Test corporate network access
timeout 5s ssh -o BatchMode=yes -o ConnectTimeout=5 -T git@cc-github.bmwgroup.net

# Test external access
timeout 5s curl -s --connect-timeout 5 https://google.de

# Check DNS resolution
nslookup cc-github.bmwgroup.net
nslookup github.com
```

**Solutions:**
```bash
# Force network mode in install script
export FORCE_CORPORATE_NETWORK=true
./install.sh

# Or force public mode
export FORCE_PUBLIC_NETWORK=true
./install.sh
```

### 4. Installation Hangs

**Symptoms:**
- Script stops responding during git operations
- No output for extended periods
- Process must be killed with Ctrl+C

**Diagnostics:**
```bash
# Check running processes
ps aux | grep git
ps aux | grep curl

# Monitor network activity
netstat -an | grep :22    # SSH connections
netstat -an | grep :443   # HTTPS connections
```

**Solutions:**
```bash
# Kill hung processes
pkill -f "git clone"
pkill -f "git pull"

# Run with verbose logging
export DEBUG=true
./install.sh

# Use shorter timeouts
export GIT_TIMEOUT=10
./install.sh
```

### 5. PATH and Alias Issues

**Symptoms:**
- `ukb: command not found` after installation
- Commands point to old paths
- Aliases don't work in new shell sessions

**Diagnostics:**
```bash
# Check current PATH
echo $PATH

# Check command locations
which ukb
which vkb

# Check aliases
alias | grep ukb
alias | grep vkb

# Check shell configuration files
grep -r "ukb\|vkb" ~/.bashrc ~/.zshrc ~/.bash_profile 2>/dev/null
```

**Solutions:**
```bash
# Reload shell configuration
source ~/.zshrc    # or ~/.bashrc

# Manual activation
source $PROJECT_ROOT/.activate

# Fix PATH manually
export PATH="$PROJECT_ROOT/bin:$PATH"

# Remove old aliases
unalias ukb 2>/dev/null || true
unalias vkb 2>/dev/null || true
```

## Environment-Specific Guidance

### Inside Corporate Network

1. **Use corporate mirrors** for modified repositories
2. **SSH access** should work for cc-github.bmwgroup.net
3. **External access** may be limited by proxy
4. **Timeouts** are more common due to security scanning

**Recommended approach:**
```bash
# Test corporate access first
ssh -T git@cc-github.bmwgroup.net

# If successful, use corporate installation mode
export PREFER_CORPORATE_REPOS=true
./install.sh
```

### Outside Corporate Network

1. **Use public repositories** for all components
2. **Corporate GitHub** will be unreachable
3. **SSH keys** for public GitHub should be configured
4. **Network timeouts** are less common

**Recommended approach:**
```bash
# Ensure public SSH key is configured
ssh -T git@github.com

# Use public installation mode
export PREFER_PUBLIC_REPOS=true
./install.sh
```

### VPN Scenarios

**When connected to corporate VPN:**
- May have access to both corporate and public repositories
- Proxy settings might interfere with external access
- DNS resolution may favor internal domains

**When not connected to VPN:**
- Only public repositories accessible
- Standard internet connectivity
- No corporate proxy restrictions

## Advanced Troubleshooting

### Network Connectivity Matrix

Test connectivity to determine your environment:

| Test | Inside Corporate | Outside Corporate | VPN Connected |
|------|-----------------|-------------------|---------------|
| `ssh -T git@cc-github.bmwgroup.net` | ✅ | ❌ | ✅ |
| `ssh -T git@github.com` | ✅/❌* | ✅ | ✅ |
| `curl https://google.de` | ✅/❌** | ✅ | ✅ |

*May be blocked by corporate firewall
**May require proxy configuration

### Log Analysis

Check installation logs for patterns:

```bash
# View recent ukb/vkb logs
ls -la /tmp/ukb-session-*.log
ls -la /tmp/vkb-server.log

# Search for specific errors
grep -i "error\|failed\|timeout" /tmp/ukb-session-*.log
grep -i "connection\|refused\|denied" /tmp/vkb-server.log
```

### Clean Installation

If all else fails, perform a clean installation:

```bash
# Remove existing installation
./uninstall.sh

# Clear temporary files
rm -rf /tmp/ukb-* /tmp/vkb-*

# Remove shell configuration entries
# Edit ~/.zshrc, ~/.bashrc, ~/.bash_profile to remove Claude entries

# Fresh installation
git pull  # Get latest changes
./install.sh
```

## Getting Help

If issues persist:

1. **Check the installation logs** in `/tmp/ukb-session-*.log`
2. **Test network connectivity** using the diagnostics above
3. **Try manual installation steps** from [team-knowledge-setup.md](team-knowledge-setup.md)
4. **Contact the team** with specific error messages and environment details

Include this information when reporting issues:
- Operating system and version
- Network environment (corporate/public/VPN)
- Error messages from logs
- Output of network diagnostic commands
- Whether SSH keys are configured for both GitHub instances
