#!/bin/bash

# Chrome Debug Mode Startup Script
# Usage: browser [URL]
# Starts Chrome in debug mode with remote debugging enabled for browser automation

set -e

# Default settings
DEBUG_PORT=9222
CHROME_DATA_DIR="/tmp/chrome-debug-profile"
DEFAULT_URL="about:blank"

# Parse arguments
URL="${1:-$DEFAULT_URL}"

# Function to find Chrome executable
find_chrome() {
    local chrome_paths=(
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        "/Applications/Chromium.app/Contents/MacOS/Chromium"
        "/usr/bin/google-chrome"
        "/usr/bin/chromium"
        "/usr/bin/chromium-browser"
        "/opt/google/chrome/chrome"
    )
    
    for path in "${chrome_paths[@]}"; do
        if [[ -x "$path" ]]; then
            echo "$path"
            return 0
        fi
    done
    
    # Try to find via which command
    if which google-chrome >/dev/null 2>&1; then
        which google-chrome
        return 0
    elif which chromium >/dev/null 2>&1; then
        which chromium
        return 0
    elif which chrome >/dev/null 2>&1; then
        which chrome
        return 0
    fi
    
    return 1
}

# Function to check if Chrome is already running on debug port
is_debug_chrome_running() {
    lsof -i :$DEBUG_PORT >/dev/null 2>&1
}

# Function to kill existing Chrome debug instances
kill_debug_chrome() {
    echo "🔄 Stopping existing Chrome debug instances..."
    pkill -f "remote-debugging-port=$DEBUG_PORT" 2>/dev/null || true
    sleep 2
}

# Main function
main() {
    echo "🌐 Starting Chrome in debug mode..."
    
    # Find Chrome executable
    CHROME_EXEC=$(find_chrome)
    if [[ $? -ne 0 ]]; then
        echo "❌ Error: Chrome/Chromium not found!"
        echo "   Please install Google Chrome or Chromium"
        exit 1
    fi
    
    echo "📍 Found Chrome: $CHROME_EXEC"
    
    # Check if debug Chrome is already running
    if is_debug_chrome_running; then
        echo "⚠️  Chrome debug instance already running on port $DEBUG_PORT"
        read -p "   Kill existing instance and restart? (y/N): " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            kill_debug_chrome
        else
            echo "   Opening URL in existing instance..."
            if [[ "$URL" != "about:blank" ]]; then
                open "$URL"
            fi
            echo "✅ Chrome debug mode ready at ws://localhost:$DEBUG_PORT"
            exit 0
        fi
    fi
    
    # Clean up old profile directory
    if [[ -d "$CHROME_DATA_DIR" ]]; then
        rm -rf "$CHROME_DATA_DIR"
    fi
    mkdir -p "$CHROME_DATA_DIR"
    
    # Chrome debug flags
    CHROME_ARGS=(
        --remote-debugging-port=$DEBUG_PORT
        --remote-debugging-address=0.0.0.0
        --no-sandbox
        --disable-web-security
        --disable-features=VizDisplayCompositor
        --disable-background-timer-throttling
        --disable-backgrounding-occluded-windows
        --disable-renderer-backgrounding
        --disable-field-trial-config
        --disable-ipc-flooding-protection
        --user-data-dir="$CHROME_DATA_DIR"
        --no-first-run
        --no-default-browser-check
        --disable-default-apps
        --disable-popup-blocking
        --disable-prompt-on-repost
        --disable-hang-monitor
        --disable-background-networking
        --disable-background-sync
        --disable-client-side-phishing-detection
        --disable-sync
        --disable-translate
        --disable-features=TranslateUI
        --disable-ipc-flooding-protection
    )
    
    # Add URL if provided
    if [[ "$URL" != "about:blank" ]]; then
        CHROME_ARGS+=("$URL")
    fi
    
    echo "🚀 Launching Chrome with debug flags..."
    echo "   Debug port: $DEBUG_PORT"
    echo "   Profile dir: $CHROME_DATA_DIR"
    echo "   URL: $URL"
    echo ""
    
    # Start Chrome in background
    "$CHROME_EXEC" "${CHROME_ARGS[@]}" > /dev/null 2>&1 &
    CHROME_PID=$!
    
    # Wait a moment for Chrome to start
    sleep 3
    
    # Check if Chrome started successfully
    if kill -0 $CHROME_PID 2>/dev/null; then
        echo "✅ Chrome debug mode started successfully!"
        echo "   PID: $CHROME_PID"
        echo "   Debug endpoint: ws://localhost:$DEBUG_PORT"
        echo "   Web interface: http://localhost:$DEBUG_PORT"
        echo ""
        echo "🔧 Ready for browser automation with Claude Code!"
        echo "   To stop: pkill -f 'remote-debugging-port=$DEBUG_PORT'"
    else
        echo "❌ Failed to start Chrome in debug mode"
        exit 1
    fi
}

# Help function
show_help() {
    echo "Chrome Debug Mode Startup Script"
    echo ""
    echo "Usage:"
    echo "  browser                    # Start Chrome in debug mode"
    echo "  browser <URL>              # Start Chrome and navigate to URL"
    echo "  browser --help             # Show this help"
    echo ""
    echo "Examples:"
    echo "  browser                    # Start with blank page"
    echo "  browser google.com         # Start and go to Google"
    echo "  browser https://github.com # Start and go to GitHub"
    echo ""
    echo "Debug endpoint will be available at: ws://localhost:9222"
    echo "Web debugging interface at: http://localhost:9222"
}

# Parse command line arguments
case "${1:-}" in
    --help|-h)
        show_help
        exit 0
        ;;
    *)
        main "$@"
        ;;
esac