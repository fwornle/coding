# Agent Adapter API Reference

This document provides a comprehensive reference for the agent adapter APIs used in the agent-agnostic coding tools system.

## Core Interfaces

### AgentAdapter (Abstract Base Class)

The base class that all agent-specific adapters must extend.

```typescript
abstract class AgentAdapter {
  config: AdapterConfig;
  initialized: boolean;
  capabilities: string[];

  constructor(config?: AdapterConfig);
  
  // Lifecycle methods
  abstract initialize(): Promise<void>;
  cleanup(): Promise<void>;
  
  // Command execution
  abstract executeCommand(command: string, args?: string[]): Promise<any>;
  
  // Memory operations
  abstract memoryCreate(entities: Entity[]): Promise<CreateResult>;
  abstract memoryCreateRelations(relations: Relation[]): Promise<CreateResult>;
  abstract memorySearch(query: string): Promise<Entity[]>;
  abstract memoryRead(): Promise<GraphData>;
  abstract memoryDelete(entityNames: string[]): Promise<DeleteResult>;
  
  // Browser operations
  abstract browserNavigate(url: string): Promise<NavigationResult>;
  abstract browserAct(action: string, variables?: Record<string, any>): Promise<ActionResult>;
  abstract browserExtract(): Promise<string>;
  abstract browserScreenshot(options?: ScreenshotOptions): Promise<Buffer>;
  
  // Logging operations
  abstract logConversation(data: ConversationEntry): Promise<LogResult>;
  abstract readConversationHistory(options?: HistoryOptions): Promise<ConversationEntry[]>;
  
  // Utility methods
  hasCapability(capability: string): boolean;
  getCapabilities(): string[];
  isInitialized(): boolean;
}
```

### Type Definitions

```typescript
interface AdapterConfig {
  [key: string]: any;
}

interface Entity {
  name: string;
  entityType: string;
  observations: string[];
  significance?: number;
  created?: string;
  lastUpdated?: string;
  metadata?: Record<string, any>;
}

interface Relation {
  from: string;
  to: string;
  relationType: string;
  created?: string;
  metadata?: Record<string, any>;
}

interface GraphData {
  nodes: Entity[];
  edges: Relation[];
  metadata?: {
    nodeCount: number;
    edgeCount: number;
    lastAccessed: string;
  };
}

interface CreateResult {
  success: boolean;
  created?: number;
  updated?: number;
  total?: number;
  errors?: string[];
}

interface DeleteResult {
  success: boolean;
  deleted: number;
  notFound: number;
}

interface NavigationResult {
  success: boolean;
  url: string;
  title?: string;
  status?: number;
  error?: string;
}

interface ActionResult {
  success: boolean;
  action: string;
  selector?: string;
  text?: string;
  error?: string;
}

interface ScreenshotOptions {
  fullPage?: boolean;
  type?: 'png' | 'jpeg';
  quality?: number;
}

interface ConversationEntry {
  content: string;
  type?: string;
  timestamp?: string;
  metadata?: Record<string, any>;
}

interface LogResult {
  success: boolean;
  method?: string;
  entryId?: string;
  error?: string;
}

interface HistoryOptions {
  limit?: number;
  agent?: string;
  after?: string;
  before?: string;
}
```

## Agent Detection API

### AgentDetector

```typescript
class AgentDetector {
  constructor();
  
  // Individual agent detection
  detectClaude(): Promise<boolean>;
  detectCoPilot(): Promise<boolean>;
  detectSpecstoryExtension(): Promise<boolean>;
  
  // Comprehensive detection
  detectAll(): Promise<DetectionResults>;
  getBest(): Promise<string | null>;
  
  // Capability queries
  getCapabilities(agent: string): string[];
  
  // CLI interface
  runCLI(args: string[]): Promise<void>;
}

interface DetectionResults {
  claude: boolean;
  copilot: boolean;
  specstory: boolean;
}
```

### Usage Examples

```typescript
// Detect available agents
const detector = new AgentDetector();
const results = await detector.detectAll();
console.log(results); // { claude: true, copilot: false, specstory: true }

// Get best available agent
const bestAgent = await detector.getBest();
console.log(bestAgent); // 'claude'

// Check capabilities
const capabilities = detector.getCapabilities('claude');
console.log(capabilities); // ['mcp', 'memory', 'browser', 'logging']
```

## Agent Registry API

### AgentRegistry

```typescript
class AgentRegistry {
  constructor();
  
  // Registration
  register(agentName: string, adapterClass: typeof AgentAdapter): void;
  
  // Adapter management
  getAdapter(agentName: string, config?: AdapterConfig): Promise<AgentAdapter>;
  getBestAdapter(config?: AdapterConfig): Promise<AgentAdapter>;
  
  // Registry queries
  listAdapters(): string[];
  hasAdapter(agentName: string): boolean;
}
```

### Convenience Functions

```typescript
// Get adapter for specific agent
async function getAdapter(agentName: string, config?: AdapterConfig): Promise<AgentAdapter>;

// Get best available adapter
async function getBestAdapter(config?: AdapterConfig): Promise<AgentAdapter>;
```

### Usage Examples

```typescript
import { getAdapter, getBestAdapter } from './lib/agent-registry';

// Get specific adapter
const claudeAdapter = await getAdapter('claude');
await claudeAdapter.initialize();

// Get best available adapter
const adapter = await getBestAdapter();
await adapter.initialize();

// Use adapter
const entities = [{
  name: 'TestPattern',
  entityType: 'Pattern',
  observations: ['Test observation']
}];

await adapter.memoryCreate(entities);
const results = await adapter.memorySearch('test');
```

## Claude MCP Adapter API

### ClaudeMCPAdapter

```typescript
class ClaudeMCPAdapter extends AgentAdapter {
  mcpConfigPath: string | null;
  mcpConfig: any;
  
  constructor(config?: AdapterConfig);
  
  // Lifecycle
  initialize(): Promise<void>;
  
  // Execution
  executeCommand(command?: string, args?: string[]): Promise<string>;
  
  // Memory operations (delegates to MCP)
  memoryCreate(entities: Entity[]): Promise<CreateResult>;
  memoryCreateRelations(relations: Relation[]): Promise<CreateResult>;
  memorySearch(query: string): Promise<Entity[]>;
  memoryRead(): Promise<GraphData>;
  memoryDelete(entityNames: string[]): Promise<DeleteResult>;
  
  // Browser operations (delegates to MCP)
  browserNavigate(url: string): Promise<NavigationResult>;
  browserAct(action: string, variables?: Record<string, any>): Promise<ActionResult>;
  browserExtract(): Promise<string>;
  browserScreenshot(options?: ScreenshotOptions): Promise<Buffer>;
  
  // Logging operations
  logConversation(data: ConversationEntry): Promise<LogResult>;
  readConversationHistory(options?: HistoryOptions): Promise<ConversationEntry[]>;
  
  // Private methods
  private findMCPConfig(): Promise<string | null>;
  private checkAndSyncMemory(): Promise<void>;
}
```

### Configuration

```typescript
interface ClaudeConfig extends AdapterConfig {
  mcpConfigPath?: string;
  autoSync?: boolean;
}
```

### Usage Examples

```typescript
const adapter = new ClaudeMCPAdapter({
  mcpConfigPath: './claude-code-mcp-processed.json',
  autoSync: true
});

await adapter.initialize();

// All operations delegate to MCP servers
await adapter.memoryCreate(entities);
await adapter.browserNavigate('https://example.com');
```

## CoPilot Adapter API

### CoPilotAdapter

```typescript
class CoPilotAdapter extends AgentAdapter {
  memoryService: MemoryFallbackService;
  browserService: BrowserFallbackService;
  loggingService: LoggerFallbackService;
  hasSpecstory: boolean;
  
  constructor(config?: AdapterConfig);
  
  // Lifecycle
  initialize(): Promise<void>;
  cleanup(): Promise<void>;
  
  // Execution
  executeCommand(command?: string, args?: string[]): Promise<string>;
  
  // Memory operations (uses Graphology)
  memoryCreate(entities: Entity[]): Promise<CreateResult>;
  memoryCreateRelations(relations: Relation[]): Promise<CreateResult>;
  memorySearch(query: string): Promise<Entity[]>;
  memoryRead(): Promise<GraphData>;
  memoryDelete(entityNames: string[]): Promise<DeleteResult>;
  
  // Browser operations (uses Playwright)
  browserNavigate(url: string): Promise<NavigationResult>;
  browserAct(action: string, variables?: Record<string, any>): Promise<ActionResult>;
  browserExtract(): Promise<string>;
  browserScreenshot(options?: ScreenshotOptions): Promise<Buffer>;
  
  // Logging operations (uses Specstory or file-based)
  logConversation(data: ConversationEntry): Promise<LogResult>;
  readConversationHistory(options?: HistoryOptions): Promise<ConversationEntry[]>;
  
  // CoPilot-specific methods
  suggest(prompt: string): Promise<SuggestionResult>;
  explain(code: string): Promise<ExplanationResult>;
  
  // Private methods
  private startMemoryService(): Promise<void>;
  private startBrowserService(): Promise<void>;
  private startLoggingService(): Promise<void>;
  private importExistingKnowledge(): Promise<void>;
}
```

### Configuration

```typescript
interface CoPilotConfig extends AdapterConfig {
  memoryDbPath?: string;
  browser?: 'chromium' | 'firefox' | 'webkit';
  headless?: boolean;
  logDir?: string;
  specstoryIntegration?: boolean;
}

interface SuggestionResult {
  success: boolean;
  suggestion: string;
  error?: string;
}

interface ExplanationResult {
  success: boolean;
  explanation: string;
  error?: string;
}
```

### Usage Examples

```typescript
const adapter = new CoPilotAdapter({
  memoryDbPath: './.coding-tools/memory.json',
  browser: 'chromium',
  headless: false,
  specstoryIntegration: true
});

await adapter.initialize();

// Memory operations use Graphology
await adapter.memoryCreate(entities);
const results = await adapter.memorySearch('pattern');

// Browser operations use Playwright
await adapter.browserNavigate('https://github.com');
await adapter.browserAct('click the sign in button');

// CoPilot-specific features
const suggestion = await adapter.suggest('add error handling to this function');
const explanation = await adapter.explain('function complex() { ... }');
```

## Memory Fallback Service API

### MemoryFallbackService

```typescript
class MemoryFallbackService {
  graph: Graph;
  dbPath: string;
  initialized: boolean;
  
  constructor(config?: MemoryConfig);
  
  // Lifecycle
  initialize(): Promise<void>;
  cleanup(): Promise<void>;
  
  // Graph operations
  createEntities(entities: Entity[]): Promise<CreateResult>;
  createRelations(relations: Relation[]): Promise<CreateResult>;
  searchNodes(query: string): Promise<Entity[]>;
  readGraph(): Promise<GraphData>;
  deleteEntities(entityNames: string[]): Promise<DeleteResult>;
  
  // Advanced operations
  getConnectedNodes(entityName: string, depth?: number): Promise<GraphData>;
  getStats(): GraphStats;
  
  // Import/Export
  importFromMCP(data: any): Promise<ImportResult>;
  exportToMCP(): Promise<GraphData>;
  
  // Persistence
  loadGraph(): Promise<void>;
  saveGraph(): Promise<void>;
  
  // Utility methods
  private getNodeId(name: string): string;
  private formatNode(nodeId: string, attributes: any): Entity;
}

interface MemoryConfig {
  dbPath?: string;
}

interface GraphStats {
  nodes: number;
  edges: number;
  density: number;
  components: number;
}

interface ImportResult {
  success: boolean;
  entitiesImported?: number;
  relationsImported?: number;
  errors?: string[];
}
```

### Usage Examples

```typescript
const memoryService = new MemoryFallbackService({
  dbPath: './.coding-tools/memory.json'
});

await memoryService.initialize();

// Create entities
const result = await memoryService.createEntities([{
  name: 'GraphPattern',
  entityType: 'Pattern',
  observations: ['Use Graphology for pure JS graphs']
}]);

// Search
const patterns = await memoryService.searchNodes('pattern');

// Get statistics
const stats = memoryService.getStats();
console.log(`Graph has ${stats.nodes} nodes and ${stats.edges} edges`);
```

## Browser Fallback Service API

### BrowserFallbackService

```typescript
class BrowserFallbackService {
  browser: Browser | null;
  context: BrowserContext | null;
  page: Page | null;
  initialized: boolean;
  
  constructor(config?: BrowserConfig);
  
  // Lifecycle
  initialize(): Promise<void>;
  cleanup(): Promise<void>;
  
  // Navigation
  navigate(url: string): Promise<NavigationResult>;
  
  // Actions
  act(action: string, variables?: Record<string, any>): Promise<ActionResult>;
  
  // Content extraction
  extract(): Promise<ExtractionResult>;
  screenshot(options?: ScreenshotOptions): Promise<ScreenshotResult>;
  
  // Advanced operations
  waitFor(selector: string, options?: WaitOptions): Promise<WaitResult>;
  evaluate(script: string, ...args: any[]): Promise<EvaluationResult>;
  
  // Utility methods
  private extractSelector(action: string, variables: Record<string, any>): string;
  private extractText(action: string, variables: Record<string, any>): string;
}

interface BrowserConfig {
  browser?: 'chromium' | 'firefox' | 'webkit';
  headless?: boolean;
  viewport?: { width: number; height: number };
}

interface ExtractionResult {
  success: boolean;
  content: string;
  url: string;
  title: string;
  error?: string;
}

interface ScreenshotResult {
  success: boolean;
  data: Buffer;
  url: string;
  error?: string;
}

interface WaitOptions {
  timeout?: number;
  state?: 'attached' | 'detached' | 'visible' | 'hidden';
}

interface WaitResult {
  success: boolean;
  selector: string;
  error?: string;
}

interface EvaluationResult {
  success: boolean;
  result: any;
  error?: string;
}
```

### Usage Examples

```typescript
const browserService = new BrowserFallbackService({
  browser: 'chromium',
  headless: false
});

await browserService.initialize();

// Navigate
await browserService.navigate('https://github.com');

// Perform actions
await browserService.act('click the sign in button');
await browserService.act('type "username" into the username field', { 
  username: 'myuser' 
});

// Extract content
const result = await browserService.extract();
console.log(result.content);

// Take screenshot
const screenshot = await browserService.screenshot({ fullPage: true });
```

## Logging Service APIs

### LoggerFallbackService

```typescript
class LoggerFallbackService {
  logDir: string;
  currentSession: string | null;
  specstoryAdapter: SpecstoryAdapter;
  hasSpecstory: boolean;
  
  constructor(config?: LoggerConfig);
  
  // Lifecycle
  initialize(): Promise<void>;
  cleanup(): Promise<void>;
  
  // Logging operations
  logConversation(entry: ConversationEntry): Promise<LogResult>;
  readConversationHistory(options?: HistoryOptions): Promise<ConversationEntry[]>;
  searchHistory(query: string, options?: HistoryOptions): Promise<ConversationEntry[]>;
  
  // Session management
  createSession(): Promise<string>;
  getCurrentSession(): Promise<SessionInfo | null>;
  
  // Export operations
  exportLogs(format: 'json' | 'markdown' | 'csv', options?: HistoryOptions): Promise<string>;
  
  // Utility methods
  private exportAsMarkdown(logs: ConversationEntry[]): string;
  private exportAsCSV(logs: ConversationEntry[]): string;
}

interface LoggerConfig {
  logDir?: string;
}

interface SessionInfo {
  sessionId: string;
  startTime: string;
  agent: string;
  entries: ConversationEntry[];
  lastUpdate?: string;
}
```

### SpecstoryAdapter

```typescript
class SpecstoryAdapter {
  extensionId: string;
  extensionApi: any;
  sessionId: string;
  initialized: boolean;
  
  constructor();
  
  // Lifecycle
  initialize(): Promise<boolean>;
  
  // Logging operations
  logConversation(entry: ConversationEntry): Promise<LogResult>;
  readLogs(options?: any): Promise<ConversationEntry[]>;
  
  // Connection methods
  private connectViaHTTP(): Promise<any>;
  private connectViaIPC(): Promise<any>;
  private connectViaFileWatch(): Promise<any>;
  
  // Utility methods
  isAvailable(): boolean;
  private httpRequest(options: any, data?: string): Promise<string>;
}
```

### Usage Examples

```typescript
const loggerService = new LoggerFallbackService({
  logDir: './.specstory/history'
});

await loggerService.initialize();

// Log conversation
await loggerService.logConversation({
  content: 'User asked about error handling patterns',
  type: 'conversation',
  metadata: { topic: 'error-handling' }
});

// Read history
const history = await loggerService.readConversationHistory({
  limit: 10,
  agent: 'copilot'
});

// Export logs
const markdown = await loggerService.exportLogs('markdown', {
  after: '2024-01-01'
});
```

## Error Handling

### Common Error Types

```typescript
class AgentError extends Error {
  constructor(message: string, public agent: string, public operation: string) {
    super(message);
    this.name = 'AgentError';
  }
}

class InitializationError extends AgentError {
  constructor(agent: string, reason: string) {
    super(`Failed to initialize ${agent}: ${reason}`, agent, 'initialize');
    this.name = 'InitializationError';
  }
}

class MemoryError extends AgentError {
  constructor(agent: string, operation: string, reason: string) {
    super(`Memory operation failed: ${reason}`, agent, operation);
    this.name = 'MemoryError';
  }
}

class BrowserError extends AgentError {
  constructor(agent: string, operation: string, reason: string) {
    super(`Browser operation failed: ${reason}`, agent, operation);
    this.name = 'BrowserError';
  }
}
```

### Error Handling Patterns

```typescript
// Graceful error handling
try {
  const adapter = await getAdapter('copilot');
  await adapter.initialize();
  
  const result = await adapter.memoryCreate(entities);
  if (!result.success) {
    console.warn('Some entities failed to create:', result.errors);
  }
} catch (error) {
  if (error instanceof InitializationError) {
    console.error('Initialization failed:', error.message);
    // Try fallback adapter
    const fallbackAdapter = await getAdapter('claude');
    await fallbackAdapter.initialize();
  } else {
    console.error('Unexpected error:', error);
  }
}
```

This API reference provides comprehensive documentation for all the interfaces and classes in the agent-agnostic coding tools system, enabling developers to effectively use and extend the system.