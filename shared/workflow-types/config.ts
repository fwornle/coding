/**
 * RunConfig and RunProgress Zod schemas for workflow state machine.
 *
 * RunConfig is immutable (readonly) -- set once at workflow start, never mutated.
 * RunProgress is mutable -- tracks the current execution position and timing.
 *
 * Types are derived via z.infer<> -- Zod schemas are the single source of truth.
 */

import { z } from 'zod';

/**
 * RunConfig: Immutable configuration set at workflow start.
 *
 * These values are determined before execution begins and remain
 * constant throughout the workflow run. The schema enforces compile-time
 * immutability via .readonly().
 */
export const RunConfigSchema = z
  .object({
    /** Whether to pause after each step completes */
    singleStepMode: z.boolean(),
    /** Whether to use mock LLM responses instead of real calls */
    mockLLM: z.boolean(),
    /** Which LLM backend to use for this run */
    llmMode: z.enum(['public', 'local', 'mock']),
    /** Whether to pause at substep level (finer granularity than singleStepMode) */
    stepIntoSubsteps: z.boolean(),
    /** Simulated delay in milliseconds when using mock LLM */
    mockLLMDelay: z.number().optional(),
  })
  .readonly();

/** Immutable workflow configuration, set once at start */
export type RunConfig = z.infer<typeof RunConfigSchema>;

/**
 * RunProgress: Mutable execution position tracker.
 *
 * Updated as the workflow advances through steps and substeps.
 * Separated from RunConfig to enforce the principle that configuration
 * and runtime position are distinct concerns.
 */
export const RunProgressSchema = z.object({
  /** 0-based index of the current step in the step array */
  currentStepIndex: z.number(),
  /** Human-readable name of the current step */
  currentStepName: z.string(),
  /** 0-based substep index when stepped into a step's substeps */
  currentSubstepIndex: z.number().optional(),
  /** Identifier of the current substep */
  currentSubstepId: z.string().optional(),
  /** Names of all steps that have completed successfully */
  completedSteps: z.array(z.string()),
  /** Which wave is currently active (for wave-based workflows) */
  currentWave: z.number().optional(),
  /** Total number of waves in the workflow */
  totalWaves: z.number().optional(),
  /** ISO 8601 timestamp of when the workflow started */
  startTime: z.string(),
  /** ISO 8601 timestamp of the last state change */
  lastUpdate: z.string(),
  /** Seconds elapsed since workflow start */
  elapsedSeconds: z.number(),
});

/** Mutable workflow execution position */
export type RunProgress = z.infer<typeof RunProgressSchema>;
