#!/bin/bash
# VKB Diagnostic Script for Linux
# Helps identify why vkb might not be working

echo "=== VKB Linux Diagnostic Tool ==="
echo "================================="
echo

# System Information
echo "1. System Information:"
echo "   OS: $(uname -s)"
echo "   Kernel: $(uname -r)"
echo "   Distribution: $(lsb_release -d 2>/dev/null | cut -f2 || echo 'Unknown')"
echo

# Required Dependencies
echo "2. Required Dependencies:"
echo -n "   Python3: "
if command -v python3 >/dev/null 2>&1; then
    echo "✓ $(python3 --version)"
else
    echo "✗ NOT FOUND - Install with: sudo apt-get install python3"
fi

echo -n "   jq: "
if command -v jq >/dev/null 2>&1; then
    echo "✓ $(jq --version)"
else
    echo "✗ NOT FOUND - Install with: sudo apt-get install jq"
fi
echo

# Port Checking Tools
echo "3. Port Checking Tools (at least one required):"
echo -n "   lsof: "
if command -v lsof >/dev/null 2>&1; then
    echo "✓ Found at $(which lsof)"
else
    echo "○ Not found"
fi

echo -n "   ss: "
if command -v ss >/dev/null 2>&1; then
    echo "✓ Found at $(which ss)"
else
    echo "○ Not found"
fi

echo -n "   netstat: "
if command -v netstat >/dev/null 2>&1; then
    echo "✓ Found at $(which netstat)"
else
    echo "○ Not found"
fi

if ! command -v lsof >/dev/null 2>&1 && ! command -v ss >/dev/null 2>&1 && ! command -v netstat >/dev/null 2>&1; then
    echo "   ⚠️  WARNING: No port checking tool found!"
    echo "   Install one with: sudo apt-get install lsof"
fi
echo

# Browser Tools
echo "4. Browser Opening Tools:"
echo -n "   xdg-open: "
if command -v xdg-open >/dev/null 2>&1; then
    echo "✓ Found at $(which xdg-open)"
else
    echo "○ Not found - Install with: sudo apt-get install xdg-utils"
fi
echo

# File System Checks
echo "5. File System Checks:"
echo -n "   /tmp writable: "
if touch /tmp/vkb-test-$$ 2>/dev/null && rm /tmp/vkb-test-$$ 2>/dev/null; then
    echo "✓ Yes"
else
    echo "✗ No - This will prevent logs from being created"
fi

echo -n "   VKB script location: "
if command -v vkb >/dev/null 2>&1; then
    VKB_PATH=$(which vkb)
    echo "✓ $VKB_PATH"
    echo -n "   VKB script executable: "
    if [[ -x "$VKB_PATH" ]]; then
        echo "✓ Yes"
    else
        echo "✗ No - Run: chmod +x $VKB_PATH"
    fi
else
    echo "✗ Not in PATH"
fi
echo

# Repository Checks
echo "6. Repository Checks:"
echo -n "   CODING_REPO environment: "
if [[ -n "$CODING_REPO" ]]; then
    echo "✓ $CODING_REPO"
    
    echo -n "   shared-memory.json: "
    if [[ -f "$CODING_REPO/shared-memory.json" ]]; then
        echo "✓ Found"
    else
        echo "✗ Not found at $CODING_REPO/shared-memory.json"
    fi
    
    echo -n "   memory-visualizer dir: "
    if [[ -d "$CODING_REPO/memory-visualizer" ]]; then
        echo "✓ Found"
        echo -n "   memory-visualizer/dist: "
        if [[ -d "$CODING_REPO/memory-visualizer/dist" ]]; then
            echo "✓ Found"
        else
            echo "○ Not found (will be created)"
        fi
    else
        echo "✗ Not found at $CODING_REPO/memory-visualizer"
    fi
else
    echo "✗ Not set"
    echo "   Set with: export CODING_REPO=/path/to/your/coding/repo"
fi
echo

# Port 8080 Check
echo "7. Port 8080 Status:"
PORT_IN_USE=false
if command -v lsof >/dev/null 2>&1; then
    if lsof -i :8080 >/dev/null 2>&1; then
        PORT_IN_USE=true
        echo "   ⚠️  Port 8080 is already in use:"
        lsof -i :8080 | head -5
    fi
elif command -v ss >/dev/null 2>&1; then
    if ss -tlnp 2>/dev/null | grep -q ":8080"; then
        PORT_IN_USE=true
        echo "   ⚠️  Port 8080 is already in use:"
        ss -tlnp | grep ":8080"
    fi
elif command -v netstat >/dev/null 2>&1; then
    if netstat -tlnp 2>/dev/null | grep -q ":8080"; then
        PORT_IN_USE=true
        echo "   ⚠️  Port 8080 is already in use:"
        netstat -tlnp 2>/dev/null | grep ":8080"
    fi
fi

if [[ "$PORT_IN_USE" == "false" ]]; then
    echo "   ✓ Port 8080 is available"
fi
echo

# Python HTTP Server Test
echo "8. Python HTTP Server Test:"
echo -n "   Can start HTTP server: "
TEMP_DIR=$(mktemp -d)
echo "<html><body>Test</body></html>" > "$TEMP_DIR/index.html"
cd "$TEMP_DIR"
timeout 2 python3 -m http.server 8081 >/dev/null 2>&1 &
PY_PID=$!
sleep 1
if kill -0 $PY_PID 2>/dev/null; then
    echo "✓ Yes"
    kill $PY_PID 2>/dev/null
else
    echo "✗ No - Python HTTP server failed to start"
fi
cd - >/dev/null
rm -rf "$TEMP_DIR"
echo

# Summary
echo "=== Summary ==="
ISSUES=0

if ! command -v python3 >/dev/null 2>&1; then
    echo "❌ Python3 is not installed"
    ((ISSUES++))
fi

if ! command -v jq >/dev/null 2>&1; then
    echo "❌ jq is not installed"
    ((ISSUES++))
fi

if ! command -v lsof >/dev/null 2>&1 && ! command -v ss >/dev/null 2>&1 && ! command -v netstat >/dev/null 2>&1; then
    echo "❌ No port checking tool installed"
    ((ISSUES++))
fi

if [[ -z "$CODING_REPO" ]]; then
    echo "❌ CODING_REPO environment variable not set"
    ((ISSUES++))
elif [[ ! -d "$CODING_REPO/memory-visualizer" ]]; then
    echo "❌ memory-visualizer directory not found"
    ((ISSUES++))
fi

if [[ $ISSUES -eq 0 ]]; then
    echo "✅ All checks passed! VKB should work correctly."
    echo
    echo "Try running: vkb start"
else
    echo
    echo "⚠️  Found $ISSUES issue(s) that need to be fixed."
    echo
    echo "Quick fix commands:"
    if ! command -v python3 >/dev/null 2>&1 || ! command -v jq >/dev/null 2>&1; then
        echo "  Ubuntu/Debian: sudo apt-get update && sudo apt-get install python3 jq"
        echo "  Fedora/RHEL:  sudo dnf install python3 jq"
    fi
    if ! command -v lsof >/dev/null 2>&1 && ! command -v ss >/dev/null 2>&1 && ! command -v netstat >/dev/null 2>&1; then
        echo "  Ubuntu/Debian: sudo apt-get install lsof"
        echo "  Fedora/RHEL:  sudo dnf install lsof"
    fi
    if [[ -z "$CODING_REPO" ]]; then
        echo "  Set CODING_REPO: export CODING_REPO=/path/to/your/coding/repo"
    fi
fi

echo
echo "For detailed troubleshooting, see: docs/vkb-linux-troubleshooting.md"