/**
 * OntologyClassifier - Hybrid LLM + Heuristic entity classification
 *
 * Responsibilities:
 * - Classify text/data into ontology entity classes
 * - Support LLM-based classification (via UnifiedInferenceEngine)
 * - Support heuristic pattern-based classification
 * - Combine results from both methods (hybrid mode)
 * - Handle confidence scoring and thresholding
 * - Support team-specific and mixed team classification
 * - Optionally validate classified entities
 */

import {
  OntologyClassification,
  ClassificationOptions,
  ValidationOptions,
  UnifiedInferenceEngine,
} from './types.js';
import { OntologyManager } from './OntologyManager.js';
import { OntologyValidator } from './OntologyValidator.js';
import { HeuristicClassifier } from './heuristics/HeuristicClassifier.js';
import { ontologyMetrics, startTimer } from './metrics.js';
import { SemanticAnalyzer } from '../agents/semantic-analyzer.js';
import * as fs from 'fs';
import * as path from 'path';

// Debug logging function that writes to file (persists when stdio is discarded)
const DEBUG_LOG_PATH = path.join(process.cwd(), '.data', 'ontology-debug.log');
function debugLog(message: string, data?: any): void {
  try {
    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] ${message}${data ? ' ' + JSON.stringify(data) : ''}\n`;
    fs.appendFileSync(DEBUG_LOG_PATH, logLine);
  } catch (e) {
    // Silently fail if we can't write to log
  }
}

/**
 * OntologyClassifier - Main classifier combining LLM and heuristics
 */
// LLM call timeout to prevent indefinite hangs (30 seconds)
const LLM_TIMEOUT_MS = 30000;

export class OntologyClassifier {
  private heuristicClassifier: HeuristicClassifier;
  private inferenceEngine: UnifiedInferenceEngine;

  constructor(
    private ontologyManager: OntologyManager,
    private validator: OntologyValidator,
    heuristicClassifier: HeuristicClassifier,
    inferenceEngine: UnifiedInferenceEngine
  ) {
    this.heuristicClassifier = heuristicClassifier;
    this.inferenceEngine = inferenceEngine;
  }

  /**
   * Wrap LLM call with timeout to prevent indefinite hangs
   */
  private async generateWithTimeout<T>(
    llmCall: Promise<T>,
    timeoutMs: number = LLM_TIMEOUT_MS
  ): Promise<T> {
    let timeoutId: NodeJS.Timeout;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`LLM call timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    try {
      const result = await Promise.race([llmCall, timeoutPromise]);
      clearTimeout(timeoutId!);
      return result;
    } catch (error) {
      clearTimeout(timeoutId!);
      throw error;
    }
  }

  /**
   * Classify text into ontology entity class
   */
  async classify(
    text: string,
    options: ClassificationOptions = {}
  ): Promise<OntologyClassification | null> {
    const timer = startTimer('ontology_classification_duration_seconds', { team: options.team || 'all' });
    ontologyMetrics.incrementCounter('ontology_classification_total', { team: options.team || 'all' });

    const {
      team,
      mixedTeamScope = false,
      minConfidence = 0.5,
      enableLLM = true,
      enableHeuristics = true,
      llmBudget = 1000,
      validate = false,
      validationOptions,
    } = options;

    let bestClassification: OntologyClassification | null = null;
    let highestConfidence = 0;

    // Try heuristic classification first (faster, no cost)
    if (enableHeuristics) {
      const heuristicResults = this.heuristicClassifier.classify(
        text,
        mixedTeamScope ? undefined : team,
        minConfidence
      );

      if (heuristicResults.length > 0) {
        const topHeuristic = heuristicResults[0];
        const ontology = team || 'upper';

        bestClassification = {
          entityClass: topHeuristic.entityClass,
          confidence: topHeuristic.confidence,
          ontology,
          method: 'heuristic',
        };
        highestConfidence = topHeuristic.confidence;

        // If confidence is very high (>= 0.98), skip LLM
        // NOTE: Threshold raised from 0.92 to 0.98 to ensure LLM is used more often
        // Heuristics typically return 0.94-0.95 for good matches, so 0.98 threshold
        // ensures LLM is used in most cases for semantic verification
        if (topHeuristic.confidence >= 0.98) {
          console.log(`[OntologyClassifier] Skipping LLM - heuristic confidence ${topHeuristic.confidence} >= 0.98 for class: ${topHeuristic.entityClass}`);
          return this.finalizeClassification(
            bestClassification,
            text,
            validate,
            validationOptions
          );
        } else {
          console.log(`[OntologyClassifier] Heuristic confidence ${topHeuristic.confidence} < 0.98, will try LLM for potential improvement`);
        }
      }
    }

    // Try LLM classification if enabled and heuristics didn't find high-confidence match
    if (enableLLM && highestConfidence < 0.98) {
      console.log(`[OntologyClassifier] Calling LLM - enableLLM=${enableLLM}, highestConfidence=${highestConfidence} < 0.98`);
      debugLog('LLM decision: CALLING LLM', { enableLLM, highestConfidence, threshold: 0.98 });
      const llmResult = await this.classifyWithLLM(text, team, llmBudget);

      if (llmResult) {
        console.log(`[OntologyClassifier] LLM returned: class=${llmResult.entityClass}, confidence=${llmResult.confidence}, method=${llmResult.method}`);
        debugLog('LLM returned result', { class: llmResult.entityClass, confidence: llmResult.confidence, method: llmResult.method });
        if (llmResult.confidence > highestConfidence) {
          console.log(`[OntologyClassifier] LLM result (${llmResult.confidence}) better than heuristic (${highestConfidence}), using LLM`);
          debugLog('Using LLM result (better confidence)', { llm: llmResult.confidence, heuristic: highestConfidence });
          bestClassification = llmResult;
          highestConfidence = llmResult.confidence;
        } else {
          console.log(`[OntologyClassifier] LLM result (${llmResult.confidence}) not better than heuristic (${highestConfidence}), keeping heuristic`);
          debugLog('Keeping heuristic (better confidence)', { llm: llmResult.confidence, heuristic: highestConfidence });
        }
      } else {
        console.log(`[OntologyClassifier] LLM returned null - using heuristic fallback`);
        debugLog('LLM returned NULL - falling back to heuristic');
      }

      // If both methods produced results, mark as hybrid
      if (bestClassification && enableHeuristics && llmResult) {
        bestClassification.method = 'hybrid';
      }
    } else if (!enableLLM) {
      console.log(`[OntologyClassifier] LLM disabled - using heuristic only`);
      debugLog('LLM decision: DISABLED', { enableLLM });
    } else {
      console.log(`[OntologyClassifier] Skipping LLM - highestConfidence=${highestConfidence} >= 0.98`);
      debugLog('LLM decision: SKIPPED (confidence >= 0.98)', { highestConfidence });
    }

    // Check minimum confidence threshold
    if (!bestClassification || bestClassification.confidence < minConfidence) {
      ontologyMetrics.incrementCounter('ontology_classification_failure', { team: options.team || 'all' });
      timer.stop();
      return null;
    }

    // Record success and confidence
    ontologyMetrics.incrementCounter('ontology_classification_success', {
      team: options.team || 'all',
      method: bestClassification.method
    });
    ontologyMetrics.observeHistogram('ontology_classification_confidence', bestClassification.confidence, {
      team: options.team || 'all',
      method: bestClassification.method
    });

    const result = await this.finalizeClassification(
      bestClassification,
      text,
      validate,
      validationOptions
    );

    timer.stop();
    return result;
  }

  /**
   * Classify using LLM
   */
  private async classifyWithLLM(
    text: string,
    team?: string,
    llmBudget: number = 1000
  ): Promise<OntologyClassification | null> {
    const llmTimer = startTimer('ontology_llm_duration_seconds', { team: team || 'all' });
    ontologyMetrics.incrementCounter('ontology_llm_calls_total', { team: team || 'all' });

    const logInfo = { team, budget: llmBudget, textLength: text.length };
    console.log(`[OntologyClassifier] classifyWithLLM called - team=${team}, budget=${llmBudget}, textLength=${text.length}`);
    debugLog('classifyWithLLM called', logInfo);

    try {
      // Get available entity classes for context
      const entityClasses = this.ontologyManager.getAllEntityClasses(team);
      console.log(`[OntologyClassifier] Available entity classes: ${entityClasses.length}`);
      debugLog('Available entity classes', { count: entityClasses.length });

      // Build LLM prompt
      const prompt = this.buildClassificationPrompt(text, entityClasses, team);
      console.log(`[OntologyClassifier] Built prompt, length=${prompt.length}`);
      debugLog('Built prompt', { length: prompt.length });

      // Call LLM via UnifiedInferenceEngine (with timeout protection)
      console.log(`[OntologyClassifier] Calling inferenceEngine.generateCompletion...`);
      debugLog('Calling inferenceEngine.generateCompletion...');
      const response = await this.generateWithTimeout(
        this.inferenceEngine.generateCompletion({
          messages: [
            {
              role: 'user',
              content: prompt,
            },
          ],
          maxTokens: llmBudget,
          temperature: 0.3, // Lower temperature for more deterministic classification
        })
      );

      console.log(`[OntologyClassifier] LLM response received - model=${response.model}, contentLength=${response.content?.length || 0}`);
      debugLog('LLM response received', { model: response.model, contentLength: response.content?.length || 0 });

      // Track token usage
      if (response.usage) {
        console.log(`[OntologyClassifier] Token usage - prompt=${response.usage.promptTokens}, completion=${response.usage.completionTokens}`);
        debugLog('Token usage', { prompt: response.usage.promptTokens, completion: response.usage.completionTokens });
        ontologyMetrics.incrementCounter('ontology_llm_tokens_prompt', { team: team || 'all' }, response.usage.promptTokens);
        ontologyMetrics.incrementCounter('ontology_llm_tokens_completion', { team: team || 'all' }, response.usage.completionTokens);
      }

      // Parse LLM response
      const classification = this.parseLLMResponse(
        response.content,
        team || 'upper'
      );

      if (classification) {
        // Validate that the returned class is in the known entity class list
        // LLMs can hallucinate class names (e.g., returning _comment_quality from ontology JSON)
        if (classification.entityClass.startsWith('_comment_') ||
            (entityClasses.length > 0 && !entityClasses.includes(classification.entityClass))) {
          debugLog('LLM returned invalid entity class, rejecting', {
            returnedClass: classification.entityClass,
            validClasses: entityClasses.length
          });
          llmTimer.stop();
          return null;
        }

        // Use provider from response if available, otherwise infer from model name
        const provider = (response as any).provider || this.extractProviderFromModel(response.model);
        const inputTokens = response.usage?.promptTokens || 0;
        const outputTokens = response.usage?.completionTokens || 0;
        const totalTokens = inputTokens + outputTokens;

        // Add LLM usage stats to classification result
        classification.llmUsage = {
          model: response.model,
          provider,
          promptTokens: inputTokens,
          completionTokens: outputTokens,
          totalTokens,
        };

        // Record metrics with SemanticAnalyzer for unified step-level tracking
        SemanticAnalyzer.recordMetricsFromExternal({
          provider: provider || 'unknown',
          model: response.model || 'unknown',
          inputTokens,
          outputTokens,
          totalTokens,
        });

        debugLog('Parsed LLM response', { class: classification.entityClass, confidence: classification.confidence, llmUsage: classification.llmUsage });
      } else {
        console.log(`[OntologyClassifier] Failed to parse LLM response - content: ${response.content?.substring(0, 200)}...`);
        debugLog('Failed to parse LLM response', { content: response.content?.substring(0, 200) });
      }

      llmTimer.stop();
      return classification;
    } catch (error) {
      const errorInfo = error instanceof Error ? { message: error.message, stack: error.stack } : { error: String(error) };
      console.error('[OntologyClassifier] LLM classification failed:', error);
      debugLog('LLM classification FAILED', errorInfo);
      llmTimer.stop();
      return null;
    }
  }

  /**
   * Build classification prompt for LLM
   */
  private buildClassificationPrompt(
    text: string,
    entityClasses: string[],
    team?: string
  ): string {
    const teamContext = team
      ? `Team context: ${team}\n`
      : 'Cross-team classification\n';

    return `${teamContext}
Classify the following text into one of the ontology entity classes.

Available entity classes:
${entityClasses.map((cls) => `- ${cls}`).join('\n')}

Text to classify:
"""
${text}
"""

Respond with JSON in this format:
{
  "entityClass": "EntityClassName",
  "confidence": 0.85,
  "reasoning": "Brief explanation"
}

Choose the most appropriate entity class and provide a confidence score between 0 and 1.`;
  }

  /**
   * Parse LLM response into OntologyClassification
   */
  private parseLLMResponse(
    response: string,
    ontology: string
  ): OntologyClassification | null {
    try {
      // Extract JSON from response (handle markdown code blocks)
      const jsonMatch = response.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/) ||
        response.match(/(\{[\s\S]*?\})/);

      if (!jsonMatch) {
        return null;
      }

      const parsed = JSON.parse(jsonMatch[1]);

      if (!parsed.entityClass || typeof parsed.confidence !== 'number') {
        return null;
      }

      return {
        entityClass: parsed.entityClass,
        confidence: Math.min(Math.max(parsed.confidence, 0), 1), // Clamp to [0, 1]
        ontology,
        method: 'llm',
      };
    } catch (error) {
      console.error('Failed to parse LLM response:', error);
      return null;
    }
  }

  /**
   * Finalize classification with optional validation
   */
  private async finalizeClassification(
    classification: OntologyClassification,
    text: string,
    validate: boolean,
    validationOptions?: ValidationOptions
  ): Promise<OntologyClassification> {
    // Extract properties if validation is requested
    if (validate && validationOptions) {
      // Optionally extract properties from text using LLM
      const properties = await this.extractProperties(
        text,
        classification.entityClass,
        classification.ontology as string
      );

      if (properties) {
        classification.properties = properties;

        // Validate extracted properties
        const team =
          classification.ontology !== 'upper'
            ? (classification.ontology as string)
            : undefined;

        const validationResult = this.validator.validate(
          classification.entityClass,
          properties,
          { ...validationOptions, team }
        );

        classification.validation = validationResult;

        // Reduce confidence if validation failed
        if (!validationResult.valid) {
          classification.confidence *= 0.8; // Penalty for validation failure
        }
      }
    }

    return classification;
  }

  /**
   * Extract entity properties from text using LLM
   */
  private async extractProperties(
    text: string,
    entityClass: string,
    ontology: string
  ): Promise<Record<string, any> | null> {
    try {
      // Get entity definition
      const team = ontology !== 'upper' ? ontology : undefined;
      const entityDef = this.ontologyManager.resolveEntityDefinition(
        entityClass,
        team
      );

      // Build extraction prompt
      const prompt = this.buildExtractionPrompt(text, entityClass, entityDef);

      // Call LLM (with timeout protection)
      const response = await this.generateWithTimeout(
        this.inferenceEngine.generateCompletion({
          messages: [
            {
              role: 'user',
              content: prompt,
            },
          ],
          maxTokens: 500,
          temperature: 0.3,
        })
      );

      // Parse response
      const jsonMatch = response.content.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/) ||
        response.content.match(/(\{[\s\S]*?\})/);

      if (!jsonMatch) {
        return null;
      }

      return JSON.parse(jsonMatch[1]);
    } catch (error) {
      console.error('Property extraction failed:', error);
      return null;
    }
  }

  /**
   * Build property extraction prompt
   */
  private buildExtractionPrompt(
    text: string,
    entityClass: string,
    entityDef: any
  ): string {
    const propertyDescriptions = Object.entries(entityDef.properties)
      .map(([name, def]: [string, any]) => `  "${name}": ${def.description} (${def.type})`)
      .join('\n');

    return `Extract properties for entity class: ${entityClass}

Properties to extract:
${propertyDescriptions}

Text:
"""
${text}
"""

Respond with JSON containing the extracted properties. Only include properties that can be extracted from the text.`;
  }

  /**
   * Batch classify multiple texts
   */
  async batchClassify(
    texts: string[],
    options: ClassificationOptions = {}
  ): Promise<Array<OntologyClassification | null>> {
    return Promise.all(texts.map((text) => this.classify(text, options)));
  }

  /**
   * Extract provider name from model identifier
   */
  private extractProviderFromModel(model?: string): string | undefined {
    if (!model) return undefined;

    const modelLower = model.toLowerCase();

    // Groq models
    if (modelLower.includes('llama') && !modelLower.includes('ollama')) {
      return 'groq';
    }
    if (modelLower.includes('mixtral') || modelLower.includes('gemma')) {
      return 'groq';
    }

    // Ollama models (local)
    if (modelLower.includes('ollama') || modelLower.startsWith('llama3.2')) {
      return 'ollama';
    }

    // OpenAI models
    if (modelLower.includes('gpt-') || modelLower.includes('o1-') || modelLower.includes('o3-')) {
      return 'openai';
    }

    // Anthropic models
    if (modelLower.includes('claude')) {
      return 'anthropic';
    }

    // Google models
    if (modelLower.includes('gemini') || modelLower.includes('palm')) {
      return 'gemini';
    }

    return 'unknown';
  }

  /**
   * Get classification statistics
   */
  getStatistics(): {
    heuristicTeams: string[];
    totalEntityClasses: number;
  } {
    return {
      heuristicTeams: this.heuristicClassifier.getRegisteredTeams(),
      totalEntityClasses: this.ontologyManager.getAllEntityClasses().length,
    };
  }
}
