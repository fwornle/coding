# Knowledge Management Copilot Bridge

This VSCode extension enables ukb/vkb commands within GitHub Copilot chat, allowing you to use your knowledge management system directly from VSCode.

## Features

- **@km** chat participant in GitHub Copilot
- `ukb` command support in chat
- `vkb` command support in chat
- Search knowledge base from chat
- Automatic fallback service startup

## Installation

1. Build the extension:
   ```bash
   cd vscode-km-copilot
   npm install
   npm run package
   ```

2. Install in VSCode:
   - Open VSCode
   - Go to Extensions view
   - Click "..." menu → "Install from VSIX..."
   - Select the generated `.vsix` file

## Usage

### In GitHub Copilot Chat:

```
@KM ukb Problem: slow rendering, Solution: use React.memo
@KM vkb
@KM search Redux patterns
```

### Prerequisites

1. Install dependencies in the main coding tools:
   ```bash
   cd /path/to/coding
   npm install
   ```

2. Start the fallback services:
   ```bash
   coding --copilot
   ```

The extension will automatically connect to the running fallback services.

## How It Works

1. The extension registers a chat participant (`@km`) with GitHub Copilot
2. When you use `@km` commands, it communicates with the fallback services
3. The fallback services handle the actual knowledge management operations
4. Results are displayed in the Copilot chat window

## Commands

- `@KM ukb <description>` - Update knowledge base with a new pattern
- `@KM vkb` - Launch the visual knowledge base viewer
- `@KM search <query>` - Search the knowledge base
- `@KM <question>` - Get relevant context from knowledge base