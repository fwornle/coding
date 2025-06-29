# Use Cases for Semantic Analysis & Knowledge Management System

This section documents the primary use cases for our semantic analysis and knowledge management system, showing how it integrates with both Claude Code and GitHub CoPilot VSCode Extension.

## Overview

The system provides two primary integration paths:
1. **Claude Code Integration** - Via MCP (Model Context Protocol) servers
2. **GitHub CoPilot Integration** - Via HTTP API and fallback services

## Use Cases

### 1. [Managing Collective Knowledge Base](./managing-knowledge-base.md)
How teams capture, store, and access accumulated knowledge across projects using both Claude Code and VSCode CoPilot.

### 2. [Code Pattern Analysis](./code-pattern-analysis.md)
Automatic detection and documentation of architectural patterns, anti-patterns, and best practices.

### 3. [Conversation Insight Extraction](./conversation-insights.md)
Extracting valuable technical insights from team discussions, code reviews, and AI interactions.

### 4. [Cross-Project Learning](./cross-project-learning.md)
How knowledge accumulates across multiple projects and benefits the entire team.

### 5. [Fallback Service Utilization](./fallback-services.md)
How the system gracefully degrades when semantic agents are unavailable, using direct ukb-cli access.

## Quick Reference

| Use Case | Claude Code | CoPilot | Fallback |
|----------|-------------|---------|----------|
| Knowledge Capture | ✅ MCP Tools | ✅ HTTP API | ✅ ukb-cli |
| Pattern Analysis | ✅ Full | ✅ Full | ❌ N/A |
| Insight Extraction | ✅ Full | ✅ Full | ❌ N/A |
| Knowledge Search | ✅ MCP Tools | ✅ HTTP API | ✅ vkb-cli |
| Real-time Updates | ✅ MCP Memory | ✅ WebSocket | ❌ Manual |

## Architecture Diagrams

- [System Overview](../puml/semantic-analysis-system-overview.png)
- [Knowledge Flow Diagram](../architecture/knowledge-flow.md)
- [Integration Architecture](../architecture/integration-architecture.md)