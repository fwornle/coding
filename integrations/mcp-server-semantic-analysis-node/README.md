# Semantic Analysis MCP Server (Node.js)

A Node.js/TypeScript implementation of the Model Context Protocol (MCP) server for semantic analysis and knowledge management, replacing the previous Python implementation.

## Features

- **LLM Integration**: Anthropic Claude and OpenAI GPT with automatic fallback
- **Code Analysis**: Pattern detection, quality assessment, and architectural insights
- **Repository Analysis**: Comprehensive codebase analysis and structure understanding
- **Knowledge Management**: UKB (Universal Knowledge Base) integration for insight persistence
- **Pattern Extraction**: Automated identification and documentation of reusable patterns
- **Stable Connection**: Built on proven Node.js MCP architecture, eliminating Python environment issues

## Architecture

This server is built using:
- **TypeScript** for type safety and maintainability
- **@modelcontextprotocol/sdk** for stable MCP communication
- **@anthropic-ai/sdk** and **openai** for LLM integration
- Modular agent architecture for extensibility

## Tools

### Core Analysis Tools
- `test_connection` - Test server connectivity
- `determine_insights` - Extract insights from content using LLM analysis
- `analyze_code` - Analyze code for patterns, quality, and architectural insights
- `analyze_repository` - Comprehensive repository structure and pattern analysis
- `extract_patterns` - Extract reusable design and architectural patterns

### Knowledge Management
- `create_ukb_entity_with_insight` - Create UKB entities with detailed insights

## Installation

1. **Build the server:**
   ```bash
   npm install
   npm run build
   ```

2. **Test the server:**
   ```bash
   node test-server.js
   ```

## Configuration

The server requires these environment variables:
- `ANTHROPIC_API_KEY` - Anthropic Claude API key
- `OPENAI_API_KEY` - OpenAI API key (fallback)
- `CODING_TOOLS_PATH` - Path to the coding tools directory

## Usage with Claude Code

The server is automatically configured in the Claude Code MCP setup. After building, restart Claude Code to pick up the new Node.js implementation.

## Migration from Python

This Node.js implementation replaces the previous Python version, providing:

✅ **Eliminated Issues:**
- No more Python virtual environment conflicts  
- No more system Python vs venv Python issues
- No more MCP connection drops at 60 seconds
- No more complex Python dependency management

✅ **Maintained Capabilities:**
- All semantic analysis functionality preserved
- UKB integration continues to work
- Same tool interface and functionality
- Enhanced logging and error handling

## Development

- `npm run build` - Build TypeScript to JavaScript
- `npm run watch` - Watch mode for development
- `npm run dev` - Build and run the server

## Logging

Server logs are written to:
- `logs/semantic-analysis-YYYY-MM-DD.log` - Structured JSON logs
- `stderr` - Human-readable logs (visible during development)

## Architecture Benefits

Using the proven browser-access Node.js architecture provides:
- Stable `StdioServerTransport` implementation
- Reliable connection management  
- Clean separation of concerns
- Easy testing and debugging
- No environment conflicts

This implementation eliminates the Python complexity while maintaining all the powerful semantic analysis capabilities.