/**
 * ReSi Team Heuristics - Embedded C++ virtual target patterns
 */

import { TeamHeuristics } from './types.js';

export const resiHeuristics: TeamHeuristics = {
  team: 'ReSi',
  description: 'Embedded C++ virtual target development',
  entityHeuristics: [
    {
      entityClass: 'EmbeddedFunction',
      description: 'C++ function in virtual target',
      patterns: [
        {
          keywords: ['function', 'c++', 'cpp', 'embedded', 'virtual target', 'method'],
          requiredKeywords: ['function'],
          baseConfidence: 0.7,
          keywordBoost: 0.05,
          maxConfidence: 0.9,
        },
      ],
    },
    {
      entityClass: 'MF4Container',
      description: 'MF4 file container',
      patterns: [
        {
          keywords: ['mf4', 'measurement', 'file', 'format', 'channel', 'asam'],
          requiredKeywords: ['mf4'],
          baseConfidence: 0.85,
          keywordBoost: 0.05,
          maxConfidence: 0.95,
        },
      ],
    },
    {
      entityClass: 'MCAPContainer',
      description: 'MCAP file container',
      patterns: [
        {
          keywords: ['mcap', 'ros', 'bag', 'topic', 'message'],
          requiredKeywords: ['mcap'],
          baseConfidence: 0.85,
          keywordBoost: 0.05,
          maxConfidence: 0.95,
        },
      ],
    },
    {
      entityClass: 'ProtobufSPP',
      description: 'Protobuf/SPP payload',
      patterns: [
        {
          keywords: ['protobuf', 'spp', 'proto', 'schema', 'serialization'],
          requiredKeywords: ['protobuf'],
          baseConfidence: 0.8,
          keywordBoost: 0.05,
          maxConfidence: 0.95,
        },
      ],
    },
    {
      entityClass: 'CompilationProfile',
      description: 'C++ compilation settings',
      patterns: [
        {
          keywords: ['compilation', 'compiler', 'optimization', 'c++', 'gcc', 'clang', 'flags'],
          requiredKeywords: ['compilation'],
          baseConfidence: 0.75,
          keywordBoost: 0.05,
          maxConfidence: 0.9,
        },
      ],
    },
    {
      entityClass: 'TimingModel',
      description: 'Timing constraints model',
      patterns: [
        {
          keywords: ['timing', 'model', 'cycle', 'latency', 'deadline', 'schedule'],
          requiredKeywords: ['timing'],
          baseConfidence: 0.75,
          keywordBoost: 0.05,
          maxConfidence: 0.9,
        },
      ],
    },
    {
      entityClass: 'HardwareAbstraction',
      description: 'Hardware Abstraction Layer',
      patterns: [
        {
          keywords: ['hal', 'hardware', 'abstraction', 'peripheral', 'register', 'ecu'],
          requiredKeywords: ['hal'],
          baseConfidence: 0.8,
          keywordBoost: 0.05,
          maxConfidence: 0.95,
        },
        {
          keywords: ['hardware', 'abstraction', 'layer', 'peripheral'],
          baseConfidence: 0.7,
        },
      ],
    },
    {
      entityClass: 'DebugConfiguration',
      description: 'Debug settings',
      patterns: [
        {
          keywords: ['debug', 'debugger', 'breakpoint', 'gdb', 'lldb', 'symbols'],
          requiredKeywords: ['debug'],
          baseConfidence: 0.75,
          keywordBoost: 0.05,
          maxConfidence: 0.9,
        },
      ],
    },
  ],
};
