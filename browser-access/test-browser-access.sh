#!/bin/bash

# Test script for Browser Access MCP Server
# This script tests if the MCP server is working correctly

set -e

echo "🧪 Testing Browser Access MCP Server..."

# Check if built
if [ ! -f "dist/index.js" ]; then
    echo "❌ Error: Server not built. Run setup-browser-access.sh first"
    exit 1
fi

# Check environment variables
if [ -z "$ANTHROPIC_API_KEY" ]; then
    echo "⚠️  Warning: ANTHROPIC_API_KEY not set"
fi

# Check if we have either local or cloud browser setup
if [ -z "$BROWSERBASE_API_KEY" ] && [ -z "$LOCAL_CDP_URL" ]; then
    echo "⚠️  Warning: Neither BROWSERBASE_API_KEY nor LOCAL_CDP_URL is set"
    echo "    Setting LOCAL_CDP_URL to default: ws://localhost:9222"
    export LOCAL_CDP_URL="ws://localhost:9222"
fi

echo "📋 Configuration:"
echo "  ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY:+***set***}"
echo "  BROWSERBASE_API_KEY: ${BROWSERBASE_API_KEY:+***set***}"
echo "  BROWSERBASE_PROJECT_ID: ${BROWSERBASE_PROJECT_ID:-not set}"
echo "  LOCAL_CDP_URL: ${LOCAL_CDP_URL:-not set}"

# Test if server starts
echo ""
echo "🚀 Testing server startup..."
timeout 5s node dist/index.js <<< '{"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2024-11-05", "capabilities": {}, "clientInfo": {"name": "test", "version": "1.0.0"}}}' || true

echo ""
echo "✅ Browser Access MCP Server test complete!"
echo ""
echo "📋 To use with Claude Code, add this to your MCP configuration:"
echo "{"
echo "  \"mcpServers\": {"
echo "    \"browser-access\": {"
echo "      \"command\": \"node\","
echo "      \"args\": [\"$(pwd)/dist/index.js\"],"
echo "      \"env\": {"
echo "        \"ANTHROPIC_API_KEY\": \"your-anthropic-api-key\""
if [ -n "$BROWSERBASE_API_KEY" ]; then
    echo "        ,\"BROWSERBASE_API_KEY\": \"your-browserbase-api-key\""
    echo "        ,\"BROWSERBASE_PROJECT_ID\": \"your-project-id\""
fi
if [ -n "$LOCAL_CDP_URL" ]; then
    echo "        ,\"LOCAL_CDP_URL\": \"$LOCAL_CDP_URL\""
fi
echo "      }"
echo "    }"
echo "  }"
echo "}"