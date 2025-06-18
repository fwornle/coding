# VKB Linux Troubleshooting Guide

## Common Issues and Solutions

### 1. Server Not Starting / Port 8080 Not Accessible

#### Check Dependencies
```bash
# Verify Python 3 is installed
python3 --version

# Verify jq is installed
jq --version

# Install missing dependencies (Ubuntu/Debian)
sudo apt-get update
sudo apt-get install python3 jq

# Install missing dependencies (Fedora/RHEL)
sudo dnf install python3 jq
```

#### Check Port Availability Tools
```bash
# Check if you have any of these tools
which lsof ss netstat

# Install if missing (Ubuntu/Debian)
sudo apt-get install lsof    # or
sudo apt-get install iproute2 # for ss
sudo apt-get install net-tools # for netstat

# Install if missing (Fedora/RHEL)
sudo dnf install lsof    # or
sudo dnf install iproute # for ss
sudo dnf install net-tools # for netstat
```

### 2. Logs Not Being Created

#### Check Permissions
```bash
# Verify /tmp is writable
ls -ld /tmp
# Should show: drwxrwxrwt ... /tmp

# Check if you can create files in /tmp
touch /tmp/test-file && rm /tmp/test-file
```

#### Run with Debug Output
```bash
# Run vkb in foreground mode (shows server output directly)
vkb fg

# Run vkb with bash debugging
bash -x $(which vkb) start

# Or run directly with verbose output
cd $CODING_REPO
./knowledge-management/vkb start
```

### 3. Script Can't Find Repository

#### Set Environment Variable
```bash
# Set CODING_REPO explicitly
export CODING_REPO="$HOME/path/to/your/coding/repo"

# Make it permanent (add to ~/.bashrc or ~/.zshrc)
echo 'export CODING_REPO="$HOME/path/to/your/coding/repo"' >> ~/.bashrc
source ~/.bashrc
```

#### Check Repository Structure
```bash
# Verify required files exist
ls -la $CODING_REPO/shared-memory.json
ls -la $CODING_REPO/memory-visualizer/
ls -la $CODING_REPO/knowledge-management/
```

### 4. Browser Not Opening

#### Install xdg-utils
```bash
# Ubuntu/Debian
sudo apt-get install xdg-utils

# Fedora/RHEL
sudo dnf install xdg-utils

# Or manually open browser
firefox http://localhost:8080 &
# or
google-chrome http://localhost:8080 &
```

### 5. Port 8080 Already in Use

#### Find and Kill Process
```bash
# Find what's using port 8080
sudo lsof -i :8080
# or
sudo ss -tlnp | grep :8080
# or
sudo netstat -tlnp | grep :8080

# Kill the process (replace PID with actual process ID)
kill PID
# or force kill
kill -9 PID

# Or use a different port
# Edit vkb script and change SERVER_PORT=8080 to another port
```

### 6. SELinux Issues (Fedora/RHEL)

```bash
# Check SELinux status
getenforce

# Temporarily disable (for testing only)
sudo setenforce 0

# Or add exception for Python HTTP server
sudo setsebool -P httpd_can_network_connect 1
```

### 7. Firewall Issues

```bash
# Ubuntu/Debian (ufw)
sudo ufw allow 8080/tcp

# Fedora/RHEL (firewalld)
sudo firewall-cmd --add-port=8080/tcp --permanent
sudo firewall-cmd --reload
```

### 8. CORS Issues with Insight Files

If you can open the knowledge base but clicking on insight files gives 404 or CORS errors:

```bash
# Check if insight files are accessible
ls memory-visualizer/dist/knowledge-management/insights/

# Restart vkb to recreate symlinks
vkb restart

# Check server logs for CORS headers
curl -I http://localhost:8080/knowledge-management/insights/ConditionalLoggingPattern.md
```

The VKB server now includes CORS support automatically. You should see headers like:
```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, OPTIONS
```

## Manual Server Start (For Debugging)

If vkb still doesn't work, try starting the server manually:

```bash
# Navigate to your repository
cd $HOME/path/to/your/coding/repo

# Prepare the memory data manually
mkdir -p memory-visualizer/dist
jq -r '.entities[] | . + {"type": "entity"} | @json' shared-memory.json > memory-visualizer/dist/memory.json
jq -r '.relations[] | @json' shared-memory.json >> memory-visualizer/dist/memory.json

# Start the server manually
cd memory-visualizer
python3 -m http.server 8080 --directory dist

# In another terminal, open browser
xdg-open http://localhost:8080
```

## Verify Installation

Run this diagnostic script:

```bash
#!/bin/bash
echo "=== VKB Linux Diagnostic ==="
echo "Python3: $(which python3 || echo 'NOT FOUND')"
echo "jq: $(which jq || echo 'NOT FOUND')"
echo "Port check tools:"
echo "  lsof: $(which lsof || echo 'not found')"
echo "  ss: $(which ss || echo 'not found')"
echo "  netstat: $(which netstat || echo 'not found')"
echo "Browser opener: $(which xdg-open || echo 'NOT FOUND')"
echo "Temp directory writable: $(touch /tmp/test-$$ && rm /tmp/test-$$ && echo 'YES' || echo 'NO')"
echo "Repository location: ${CODING_REPO:-'NOT SET'}"
if [[ -n "$CODING_REPO" ]]; then
    echo "  shared-memory.json: $(test -f "$CODING_REPO/shared-memory.json" && echo 'EXISTS' || echo 'MISSING')"
    echo "  memory-visualizer: $(test -d "$CODING_REPO/memory-visualizer" && echo 'EXISTS' || echo 'MISSING')"
fi
```

## Get Help

If you're still having issues:
1. Run the diagnostic script above
2. Check the error messages carefully
3. Try the manual server start method
4. Share the output of `bash -x vkb start` for debugging