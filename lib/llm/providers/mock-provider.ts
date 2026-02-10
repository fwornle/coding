/**
 * Mock Provider
 *
 * Delegates to an injected MockServiceInterface.
 * Used for debug/test workflows to avoid real LLM calls.
 */

import { BaseProvider } from './base-provider.js';
import type { LLMCompletionRequest, LLMCompletionResult, ProviderConfig, ProviderName, MockServiceInterface } from '../types.js';

export class MockProvider extends BaseProvider {
  readonly name: ProviderName = 'mock';
  readonly isLocal = true;

  private mockService: MockServiceInterface | null = null;
  private repositoryPath: string;

  constructor(config: Partial<ProviderConfig> = {}) {
    super(config);
    this.repositoryPath = process.cwd();
  }

  /**
   * Set the mock service implementation (dependency injection)
   */
  setMockService(service: MockServiceInterface): void {
    this.mockService = service;
    this._available = true;
  }

  /**
   * Set the repository path for mock context
   */
  setRepositoryPath(path: string): void {
    this.repositoryPath = path;
  }

  async initialize(): Promise<void> {
    // Available only when a mock service is injected
    this._available = !!this.mockService;
  }

  async complete(request: LLMCompletionRequest): Promise<LLMCompletionResult> {
    if (!this.mockService) {
      throw new Error('Mock service not configured');
    }

    const agentType = request.agentId || request.operationType || 'default';
    const prompt = request.messages.map(m => m.content).join('\n');

    const result = await this.mockService.mockLLMCall(agentType, prompt, this.repositoryPath);

    return {
      ...result,
      provider: 'mock',
      model: result.model || 'mock-llm-v1',
      mock: true,
      local: true,
    };
  }

  getModels() {
    return { fast: 'mock-llm-v1', standard: 'mock-llm-v1', premium: 'mock-llm-v1' };
  }
}
