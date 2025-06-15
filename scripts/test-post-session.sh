#!/bin/bash
# Test script to verify post-session logging works

echo "🧪 Testing post-session logging..."
echo "📁 Current log files before test:"
ls -lt .specstory/history/ | head -3

echo
echo "🚀 Starting test claude-mcp session..."
echo "This is a test session for post-session logging verification." > /tmp/test-input.txt
echo "/quit" >> /tmp/test-input.txt

# Start claude-mcp with test input
timeout 30s ./scripts/claude-mcp-launcher.sh < /tmp/test-input.txt

echo
echo "📁 Log files after test:"
ls -lt .specstory/history/ | head -3

echo
echo "✅ Test completed - check if new log file was created!"