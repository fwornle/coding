#!/usr/bin/env node
/**
 * convert-transcripts.js - CLI entry point for transcript-to-observation conversion
 *
 * Converts Claude JSONL, Copilot events.jsonl, and .specstory markdown files
 * into observations stored in LibSQL via the ObservationWriter.
 *
 * Usage:
 *   node scripts/convert-transcripts.js claude <path-to-jsonl>
 *   node scripts/convert-transcripts.js copilot <path-to-events.jsonl>
 *   node scripts/convert-transcripts.js specstory <path-to-dir-or-file> [--batch] [--force]
 *   node scripts/convert-transcripts.js --help
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { parseClaude, parseCopilot, parseSpecstory } from '../src/live-logging/TranscriptNormalizer.js';
import { ObservationWriter } from '../src/live-logging/ObservationWriter.js';
import { SpecstoryBatchConverter } from '../src/live-logging/SpecstoryBatchConverter.js';

const USAGE = `
convert-transcripts - Convert coding agent transcripts to observations

Usage:
  node scripts/convert-transcripts.js <subcommand> <target> [options]

Subcommands:
  claude     Convert Claude JSONL transcript file
  copilot    Convert Copilot events.jsonl file
  specstory  Convert .specstory markdown file(s)

Options:
  --batch    (specstory) Process all .md files in the target directory
  --force    Overwrite existing observations
  --help     Show this help message

Examples:
  node scripts/convert-transcripts.js claude ~/.claude/projects/logs/transcript.jsonl
  node scripts/convert-transcripts.js copilot ~/.config/github-copilot/events.jsonl
  node scripts/convert-transcripts.js specstory .specstory/history/ --batch
  node scripts/convert-transcripts.js specstory .specstory/history/2026-03-30_1500-1600_abc.md
`.trim();

// --- Argument Parsing ---

const args = process.argv.slice(2);
const subcommand = args[0];
const target = args[1];
const flags = args.slice(2);

if (!subcommand || subcommand === '--help' || subcommand === '-h') {
  process.stderr.write(USAGE + '\n');
  process.exit(subcommand === '--help' || subcommand === '-h' ? 0 : 1);
}

const validSubcommands = ['claude', 'copilot', 'specstory'];
if (!validSubcommands.includes(subcommand)) {
  process.stderr.write(`Error: Unknown subcommand "${subcommand}"\n`);
  process.stderr.write(`Valid subcommands: ${validSubcommands.join(', ')}\n\n`);
  process.stderr.write(USAGE + '\n');
  process.exit(1);
}

if (!target) {
  process.stderr.write(`Error: Missing target path for "${subcommand}" subcommand\n\n`);
  process.stderr.write(USAGE + '\n');
  process.exit(1);
}

const hasBatch = flags.includes('--batch');
const hasForce = flags.includes('--force');

// --- Handlers ---

/**
 * Process a Claude JSONL transcript file line-by-line.
 * Reads streaming, normalizes via parseClaude, groups into conversation exchanges,
 * and writes observations via ObservationWriter with progress reporting.
 */
async function handleClaude(filePath) {
  if (!fs.existsSync(filePath)) {
    process.stderr.write(`Error: File not found: ${filePath}\n`);
    process.exit(1);
  }

  if (!filePath.endsWith('.jsonl')) {
    process.stderr.write(`Warning: File does not have .jsonl extension: ${filePath}\n`);
  }

  process.stderr.write(`[convert] Claude: processing ${filePath}\n`);

  const writer = new ObservationWriter();
  await writer.init();

  let totalLines = 0;
  let totalObs = 0;
  let errors = 0;
  let currentExchange = [];

  const fileStream = fs.createReadStream(filePath, 'utf-8');
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  for await (const line of rl) {
    totalLines++;
    const msg = parseClaude(line);

    if (!msg) {
      // Count JSON parse failures (non-empty lines that produce no message)
      if (line.trim()) {
        let isParseFail = false;
        try { JSON.parse(line); } catch { isParseFail = true; }
        if (isParseFail) errors++;
      }
      continue;
    }

    currentExchange.push(msg);

    // Group into conversation exchanges: flush when we see a complete user+assistant pair
    // or when exchange reaches a reasonable size
    const hasUser = currentExchange.some(m => m.role === 'user');
    const hasAssistant = currentExchange.some(m => m.role === 'assistant');

    if (hasUser && hasAssistant && msg.role === 'assistant') {
      try {
        const result = await writer.processMessages(currentExchange, {
          agent: 'claude',
          sourceFile: filePath,
        });
        totalObs += result.observations;
        errors += result.errors;
      } catch (err) {
        errors++;
        process.stderr.write(`[convert] Error writing exchange: ${err.message}\n`);
      }
      currentExchange = [];
    }

    // Progress reporting every 100 lines
    if (totalLines % 100 === 0) {
      process.stderr.write(`[convert] Processed ${totalLines} lines, ${totalObs} observations...\n`);
    }
  }

  // Flush remaining exchange
  if (currentExchange.length > 0) {
    try {
      const result = await writer.processMessages(currentExchange, {
        agent: 'claude',
        sourceFile: filePath,
      });
      totalObs += result.observations;
      errors += result.errors;
    } catch (err) {
      errors++;
      process.stderr.write(`[convert] Error writing final exchange: ${err.message}\n`);
    }
  }

  await writer.close();

  process.stderr.write(`[convert] Done: ${totalLines} lines, ${totalObs} observations, ${errors} errors\n`);

  return { observations: totalObs, errors };
}

/**
 * Process a Copilot events.jsonl file line-by-line.
 */
async function handleCopilot(filePath) {
  if (!fs.existsSync(filePath)) {
    process.stderr.write(`Error: File not found: ${filePath}\n`);
    process.exit(1);
  }

  process.stderr.write(`[copilot] Processing: ${filePath}\n`);

  const messages = [];
  const fileStream = fs.createReadStream(filePath, 'utf-8');
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  for await (const line of rl) {
    const msg = parseCopilot(line);
    if (msg) messages.push(msg);
  }

  process.stderr.write(`[copilot] Parsed ${messages.length} messages\n`);

  const writer = new ObservationWriter();
  await writer.init();
  const result = await writer.processMessages(messages, {
    agent: 'copilot',
    sourceFile: filePath,
  });
  await writer.close();

  return result;
}

/**
 * Process .specstory markdown file(s).
 * If --batch flag is set and target is a directory, process all .md files.
 */
async function handleSpecstory(targetPath) {
  const resolvedPath = path.resolve(targetPath);
  const isDir = fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isDirectory();

  let files = [];

  if (isDir && hasBatch) {
    // Batch mode: process all .md files in directory
    files = fs.readdirSync(resolvedPath)
      .filter(f => f.endsWith('.md'))
      .map(f => path.join(resolvedPath, f))
      .sort();
    process.stderr.write(`[specstory] Batch mode: found ${files.length} .md files in ${resolvedPath}\n`);
  } else if (isDir && !hasBatch) {
    process.stderr.write(`Error: ${resolvedPath} is a directory. Use --batch to process all files.\n`);
    process.exit(1);
  } else if (fs.existsSync(resolvedPath)) {
    files = [resolvedPath];
  } else {
    process.stderr.write(`Error: Path not found: ${resolvedPath}\n`);
    process.exit(1);
  }

  const writer = new ObservationWriter();
  await writer.init();

  let totalObservations = 0;
  let totalErrors = 0;
  let filesProcessed = 0;

  for (const file of files) {
    try {
      const content = fs.readFileSync(file, 'utf-8');
      const messages = parseSpecstory(content, { sourceFile: path.basename(file) });

      if (messages.length === 0) {
        process.stderr.write(`[specstory] Skipping ${path.basename(file)}: no messages found\n`);
        continue;
      }

      const result = await writer.processMessages(messages, {
        agent: 'claude',
        sourceFile: file,
      });

      totalObservations += result.observations;
      totalErrors += result.errors;
      filesProcessed++;
    } catch (err) {
      totalErrors++;
      process.stderr.write(`[specstory] Error processing ${path.basename(file)}: ${err.message}\n`);
    }
  }

  await writer.close();

  return {
    observations: totalObservations,
    errors: totalErrors,
    files: filesProcessed,
  };
}

// --- Main ---

async function main() {
  const startTime = Date.now();
  let result;

  try {
    switch (subcommand) {
      case 'claude':
        result = await handleClaude(target);
        break;
      case 'copilot':
        result = await handleCopilot(target);
        break;
      case 'specstory':
        result = await handleSpecstory(target);
        break;
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    process.stderr.write(`\n--- Summary ---\n`);
    process.stderr.write(`Subcommand: ${subcommand}\n`);
    if (result.files !== undefined) {
      process.stderr.write(`Files processed: ${result.files}\n`);
    }
    process.stderr.write(`Observations written: ${result.observations}\n`);
    process.stderr.write(`Errors: ${result.errors}\n`);
    process.stderr.write(`Duration: ${elapsed}s\n`);

    process.exit(result.errors > 0 ? 1 : 0);
  } catch (err) {
    process.stderr.write(`Fatal error: ${err.message}\n`);
    process.exit(1);
  }
}

main();
