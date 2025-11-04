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

/**
 * OntologyClassifier - Main classifier combining LLM and heuristics
 */
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
   * Classify text into ontology entity class
   */
  async classify(
    text: string,
    options: ClassificationOptions = {}
  ): Promise<OntologyClassification | null> {
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

        // If confidence is very high (>= 0.85), skip LLM
        if (topHeuristic.confidence >= 0.85) {
          return this.finalizeClassification(
            bestClassification,
            text,
            validate,
            validationOptions
          );
        }
      }
    }

    // Try LLM classification if enabled and heuristics didn't find high-confidence match
    if (enableLLM && highestConfidence < 0.85) {
      const llmResult = await this.classifyWithLLM(text, team, llmBudget);

      if (llmResult && llmResult.confidence > highestConfidence) {
        bestClassification = llmResult;
        highestConfidence = llmResult.confidence;
      }

      // If both methods produced results, mark as hybrid
      if (bestClassification && enableHeuristics && llmResult) {
        bestClassification.method = 'hybrid';
      }
    }

    // Check minimum confidence threshold
    if (!bestClassification || bestClassification.confidence < minConfidence) {
      return null;
    }

    return this.finalizeClassification(
      bestClassification,
      text,
      validate,
      validationOptions
    );
  }

  /**
   * Classify using LLM
   */
  private async classifyWithLLM(
    text: string,
    team?: string,
    llmBudget: number = 1000
  ): Promise<OntologyClassification | null> {
    try {
      // Get available entity classes for context
      const entityClasses = this.ontologyManager.getAllEntityClasses(team);

      // Build LLM prompt
      const prompt = this.buildClassificationPrompt(text, entityClasses, team);

      // Call LLM via UnifiedInferenceEngine
      const response = await this.inferenceEngine.generateCompletion({
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
        maxTokens: llmBudget,
        temperature: 0.3, // Lower temperature for more deterministic classification
      });

      // Parse LLM response
      const classification = this.parseLLMResponse(
        response.content,
        team || 'upper'
      );

      return classification;
    } catch (error) {
      console.error('LLM classification failed:', error);
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

      // Call LLM
      const response = await this.inferenceEngine.generateCompletion({
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
        maxTokens: 500,
        temperature: 0.3,
      });

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
