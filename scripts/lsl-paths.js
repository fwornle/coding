/**
 * LSL path helpers — YYYY/MM organized layout for LSL files,
 * classification logs, and metrics files.
 *
 * Layout:
 *   <baseDir>/YYYY/MM/<filename>     (when filename has a date prefix)
 *   <baseDir>/<filename>             (cumulative files: classification.log, classification-status_*.md)
 *
 * The date prefix is detected as the first YYYY-MM-DD substring anywhere in
 * the filename, covering:
 *   2026-04-29_0900-1000_c197ef.md
 *   metrics-2026-01-18.json
 *   operational-2026-02-07.log
 *   2025-09-26_1100-1200_g9b30a_from-curriculum-alignment.md
 */

import fs from 'fs';
import path from 'path';

const DATE_RE = /(\d{4})-(\d{2})-\d{2}/;

/**
 * Extract "YYYY/MM" subpath from a filename.
 * Returns null if no YYYY-MM-DD substring is found.
 */
export function dateSubdirFromFilename(filename) {
  const m = filename.match(DATE_RE);
  if (!m) return null;
  return path.join(m[1], m[2]);
}

/**
 * Build the canonical YYYY/MM-organized path for a file under baseDir.
 * Falls back to <baseDir>/<filename> if filename has no date prefix.
 */
export function lslPath(baseDir, filename) {
  const sub = dateSubdirFromFilename(filename);
  if (!sub) return path.join(baseDir, filename);
  return path.join(baseDir, sub, filename);
}

/**
 * Same as lslPath, but mkdirs the parent dir before returning.
 */
export function lslWritePath(baseDir, filename) {
  const full = lslPath(baseDir, filename);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  return full;
}

/**
 * Resolve a file by name within a YYYY/MM-organized baseDir, with a
 * fallback to the flat-root location for not-yet-migrated files.
 * Returns null if neither exists.
 */
export function resolveLslPath(baseDir, filename) {
  const organized = lslPath(baseDir, filename);
  if (fs.existsSync(organized)) return organized;
  const flat = path.join(baseDir, filename);
  if (fs.existsSync(flat)) return flat;
  return null;
}

/**
 * Recursively list all files under baseDir matching the predicate.
 * Walks YYYY/MM/ subdirs as well as the flat root.
 * Skips dot-directories (.git etc.) and standard ignore dirs.
 */
export function lslListAll(baseDir, predicate = (name) => name.endsWith('.md')) {
  const results = [];
  const ignoreDirs = new Set(['.git', 'node_modules']);
  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (e.name.startsWith('.') || ignoreDirs.has(e.name)) continue;
        walk(path.join(dir, e.name));
      } else if (predicate(e.name)) {
        results.push(path.join(dir, e.name));
      }
    }
  }
  walk(baseDir);
  return results;
}
