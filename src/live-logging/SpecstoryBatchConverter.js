/**
 * SpecstoryBatchConverter - Batch conversion of .specstory files with manifest-based idempotency
 *
 * Scans a directory of .specstory markdown files, converts them to observations
 * via TranscriptNormalizer + ObservationWriter, and tracks progress in a manifest
 * file to enable idempotent re-runs.
 *
 * @module SpecstoryBatchConverter
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseSpecstory } from './TranscriptNormalizer.js';
import { ObservationWriter } from './ObservationWriter.js';

export class SpecstoryBatchConverter {
  /**
   * @param {Object} [options]
   * @param {string} [options.manifestPath] - Path to conversion manifest JSON
   * @param {boolean} [options.force] - Re-process already-converted files
   * @param {Object} [options.writerOptions] - Options passed to ObservationWriter
   */
  constructor(options = {}) {
    this.manifestPath = options.manifestPath || '.observations/conversion-manifest.json';
    this.force = options.force || false;
    this.writerOptions = options.writerOptions || {};
    this.writer = null;
    this.manifest = null;
  }

  /**
   * Initialize the converter: load manifest and create ObservationWriter.
   */
  async init() {
    this.manifest = this.loadManifest();
    this.writer = new ObservationWriter(this.writerOptions);
    await this.writer.init();
  }

  /**
   * Convert all .md files in a directory, processing in chronological order.
   * Skips already-converted files unless force is true.
   *
   * @param {string} dirPath - Path to directory containing .specstory .md files
   * @returns {Promise<{converted: number, skipped: number, total: number, totalObservations: number, errors: number}>}
   */
  async convertDirectory(dirPath) {
    const resolvedDir = path.resolve(dirPath);

    if (!fs.existsSync(resolvedDir) || !fs.statSync(resolvedDir).isDirectory()) {
      throw new Error(`Not a valid directory: ${resolvedDir}`);
    }

    // Scan and sort .md files alphabetically (chronological per YYYY-MM-DD_HHMM filename pattern)
    const files = fs.readdirSync(resolvedDir)
      .filter(f => f.endsWith('.md'))
      .sort()
      .map(f => path.join(resolvedDir, f));

    const total = files.length;
    let converted = 0;
    let skipped = 0;
    let totalObservations = 0;
    let errors = 0;

    process.stderr.write(`[specstory] Found ${total} .md files in ${resolvedDir}\n`);

    for (const filePath of files) {
      const relativePath = path.relative(process.cwd(), filePath);
      const hash = this.fileHash(filePath);
      const manifestEntry = this.manifest.files[relativePath];

      // Check manifest for idempotency
      if (!this.force && manifestEntry && manifestEntry.hash === hash) {
        skipped++;
        process.stderr.write(`[specstory] Skipped ${path.basename(filePath)} (already converted)\n`);
        continue;
      }

      try {
        const obsCount = await this.convertFile(filePath);
        totalObservations += obsCount;
        converted++;

        // Update manifest entry after successful conversion
        this.manifest.files[relativePath] = {
          hash,
          convertedAt: new Date().toISOString(),
          observationCount: obsCount,
        };

        // Save manifest after each file for crash-safe incremental progress
        this.saveManifest(this.manifest);

        process.stderr.write(
          `[specstory] Converted ${path.basename(filePath)} (${obsCount} observations)\n`
        );
      } catch (err) {
        errors++;
        process.stderr.write(
          `[specstory] Error converting ${path.basename(filePath)}: ${err.message}\n`
        );
      }
    }

    process.stderr.write(
      `[specstory] Batch complete: ${converted}/${total} files, ${totalObservations} observations, ${skipped} skipped\n`
    );

    return { converted, skipped, total, totalObservations, errors };
  }

  /**
   * Convert a single .specstory file to observations.
   *
   * @param {string} filePath - Absolute path to a .specstory .md file
   * @returns {Promise<number>} Number of observations created
   */
  async convertFile(filePath) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const filename = path.basename(filePath);

    // Parse specstory markdown into MastraDBMessage array
    const messages = parseSpecstory(content, { sourceFile: filename });

    if (messages.length === 0) {
      return 0;
    }

    // Extract session date from filename pattern: YYYY-MM-DD_HHMM-HHMM_hash.md
    const dateMatch = filename.match(/^(\d{4}-\d{2}-\d{2})/);
    const sessionDate = dateMatch ? dateMatch[1] : undefined;

    // Extract session hash from filename
    const hashMatch = filename.match(/_([a-f0-9]+)(?:_[^.]+)?\.md$/i);
    const sessionHash = hashMatch ? hashMatch[1] : undefined;

    const result = await this.writer.processMessages(messages, {
      agent: 'specstory',
      sourceFile: filePath,
      sessionDate,
      sessionId: sessionHash,
    });

    return result.observations;
  }

  /**
   * Load the conversion manifest from disk.
   * Returns a fresh manifest if the file does not exist or is corrupt.
   *
   * @returns {{ version: number, files: Object<string, { hash: string, convertedAt: string, observationCount: number }> }}
   */
  loadManifest() {
    try {
      if (fs.existsSync(this.manifestPath)) {
        const raw = fs.readFileSync(this.manifestPath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed && parsed.version === 1 && typeof parsed.files === 'object') {
          return parsed;
        }
      }
    } catch {
      process.stderr.write(`[specstory] Warning: could not read manifest, starting fresh\n`);
    }
    return { version: 1, files: {} };
  }

  /**
   * Save the conversion manifest to disk atomically (write to temp, rename).
   *
   * @param {{ version: number, files: Object }} manifest
   */
  saveManifest(manifest) {
    const dir = path.dirname(this.manifestPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const tmpPath = this.manifestPath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(manifest, null, 2), 'utf-8');
    fs.renameSync(tmpPath, this.manifestPath);
  }

  /**
   * Compute SHA-256 hash of file contents for change detection.
   *
   * @param {string} filePath
   * @returns {string} Hex-encoded SHA-256 hash
   */
  fileHash(filePath) {
    const content = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  /**
   * Save manifest and close the ObservationWriter.
   */
  async close() {
    if (this.manifest) {
      this.saveManifest(this.manifest);
    }
    if (this.writer) {
      await this.writer.close();
    }
  }
}
