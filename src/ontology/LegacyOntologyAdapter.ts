/**
 * LegacyOntologyAdapter — thin wrapper around km-core's OntologyRegistry
 * that exposes the small slice of B's deleted ontology-load class surface
 * still consumed by the surviving Validator / Classifier / QueryEngine.
 *
 * Phase 42 Plan 03 background:
 *   - D-53 keeps OntologyClassifier + OntologyValidator + OntologyQueryEngine
 *     (B-specific intelligence) but deletes the old ontology-load class.
 *   - Those three modules call:
 *       legacy.hasEntityClass(name, team?)
 *       legacy.getAllEntityClasses(team?)
 *       legacy.resolveEntityDefinition(name, team?)
 *   - km-core's registry provides direct analogs for the first two
 *     (isValidClass / getAllClassNames) but no equivalent of
 *     resolveEntityDefinition. This adapter synthesizes the rich shape
 *     by reading registry.getClass(name) + registry.parentChainOf(name).
 *   - The `team` argument is accepted for source-compatibility but IGNORED:
 *     km-core's registry is per-instance and single-team (D-53b).
 *     Recorded in Phase 42-03 SUMMARY.
 *
 * The adapter is intentionally separate from km-core (we own the legacy
 * surface contract).
 */

import type { OntologyRegistry, ResolvedClass } from '@fwornle/km-core';
import type {
  EntityDefinition,
  OntologyType,
  PropertyDefinition,
} from './types.js';

/**
 * Resolved entity definition shape — identical to the one B's deleted
 * legacy ontology-load class used to return.
 *
 * The surviving Validator + Classifier callers depend on:
 *   - .properties (Record) — sourced from km-core class
 *   - .requiredProperties (string[] | undefined) — NOT in km-core; we return []
 *   - .description, .examples — sourced where available
 *   - .ontologyType ('upper' | 'lower') — derived from registry.provenanceOf()
 *   - .inheritanceChain (string[]) — sourced from registry.parentChainOf()
 */
export interface ResolvedEntityDefinition extends EntityDefinition {
  /** Team that defined this entity. Always undefined in this single-team adapter. */
  team?: string;

  /** Ontology type where this entity is defined. Derived from km-core source name. */
  ontologyType: OntologyType;

  /** Full inheritance chain (closest parent first, root last). */
  inheritanceChain: string[];
}

/**
 * Adapter shape — exposes the 3 methods the surviving modules call.
 */
export class LegacyOntologyAdapter {
  constructor(private readonly registry: OntologyRegistry) {}

  /**
   * Existence check — direct alias to km-core's isValidClass.
   * `team` argument is accepted for source-compatibility but IGNORED.
   */
  hasEntityClass(entityClass: string, _team?: string): boolean {
    return this.registry.isValidClass(entityClass);
  }

  /**
   * Class enumeration. `team` argument is accepted but IGNORED.
   * Returns all classes loaded by the registry (upper + every lower domain).
   */
  getAllEntityClasses(_team?: string): string[] {
    return this.registry.getAllClassNames();
  }

  /**
   * Reload through the registry. km-core's reload is atomic + async.
   */
  async reload(): Promise<void> {
    await this.registry.reload();
  }

  /**
   * Synthesize the rich ResolvedEntityDefinition shape that B's
   * Validator / Classifier consumers expect, from km-core's flatter
   * ResolvedClass + parent-chain primitives.
   *
   * Throws a plain Error if the class isn't in the registry — matches the
   * original legacy throw semantics (Validator handles via try/catch).
   */
  resolveEntityDefinition(
    entityClass: string,
    team?: string,
  ): ResolvedEntityDefinition {
    const cls: ResolvedClass | undefined = this.registry.getClass(entityClass);
    if (!cls) {
      throw new Error(
        `Entity class '${entityClass}' not found in ${team ? "team '" + team + "'" : 'any ontology'}`,
      );
    }

    const chain = this.registry.parentChainOf(entityClass);
    const inheritanceChain = [entityClass, ...chain.map((c) => c.name)];

    const source = this.registry.provenanceOf(entityClass);
    // km-core stores the source domain name (e.g., 'upper' or 'coding-ontology').
    // We translate to the legacy 'upper' | 'lower' union: source==='upper' → 'upper',
    // anything else → 'lower'.
    const ontologyType: OntologyType = source === 'upper' ? 'upper' : 'lower';

    // km-core's `properties` field has the same shape as B's PropertyDefinition
    // (free-form { type, description, ... }). Pass-through with a cast.
    const properties = (cls.properties ?? {}) as Record<string, PropertyDefinition>;

    return {
      description: cls.description,
      properties,
      // km-core's ResolvedClass does not carry requiredProperties or examples;
      // legacy consumers tolerate an empty array (Validator early-returns on
      // empty/undefined; Classifier never reads either field).
      requiredProperties: [],
      examples: [],
      extendsEntity: cls.extends,
      team,
      ontologyType,
      inheritanceChain,
    };
  }
}
