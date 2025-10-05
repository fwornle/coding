#!/bin/bash
# Cleanup aliases from current shell session
unalias ukb 2>/dev/null || true
unalias vkb 2>/dev/null || true
unalias claude-mcp 2>/dev/null || true
unset -f ukb 2>/dev/null || true
unset -f vkb 2>/dev/null || true
unset -f claude-mcp 2>/dev/null || true
