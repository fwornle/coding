#!/bin/bash

# Setup script for Browser Access MCP Server
# This script sets up the Stagehand MCP server for use with Claude Code

set -e

echo "🌐 Setting up Browser Access MCP Server for Claude Code..."

# Check if we're in the correct directory
if [ ! -f "package.json" ]; then
    echo "❌ Error: This script must be run from the browser-access directory"
    exit 1
fi

# Build the TypeScript code
echo "📦 Building TypeScript code..."
npm run build

# Check if build was successful
if [ ! -f "dist/index.js" ]; then
    echo "❌ Error: Build failed - dist/index.js not found"
    exit 1
fi

# Make the binary executable
chmod +x dist/index.js

echo "✅ Browser Access MCP Server setup complete!"
echo ""
echo "📋 Next steps:"
echo "1. Set your environment variables:"
echo "   export ANTHROPIC_API_KEY='your-anthropic-api-key'"
echo "   export BROWSERBASE_API_KEY='your-browserbase-api-key'  # Optional: for cloud browser"
echo "   export BROWSERBASE_PROJECT_ID='your-project-id'        # Optional: for cloud browser"
echo "   export LOCAL_CDP_URL='ws://localhost:9222'             # Optional: for local browser"
echo ""
echo "2. For local browser testing, start Chrome/Chromium with:"
echo "   google-chrome --remote-debugging-port=9222 --no-sandbox --disable-web-security"
echo ""
echo "3. Test the server:"
echo "   ./test-browser-access.sh"
echo ""
echo "4. Add to Claude Code MCP configuration (see README.md)"