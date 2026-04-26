/**
 * ObservationSanitizer — corruption recovery + dedup for observation,
 * digest, and insight rows.
 *
 * Two responsibilities:
 *
 * 1. **Recover from `<AWS_SECRET_REDACTED>` corruption.**
 *    The aws_secret_standalone regex used to eat the leading 40 chars of
 *    long paths. The original characters are gone, but in many cases the
 *    same row contains an UNCORRUPTED variant of the same path (in the
 *    summary, in a sibling files_touched entry, etc.). We use those as
 *    the recovery oracle first. Only if no in-context hint is available
 *    do we fall back to a repo-wide `git ls-files` suffix search.
 *
 * 2. **Dedupe redundant file references.**
 *    files_touched arrays often contain both the bare filename and the
 *    full path for the same file (e.g. ["server.js", "/Users/<id>/...
 *    /server.js"]). Group by basename and keep the longest non-corrupted
 *    variant per group.
 *
 * The module is consumed by:
 *   - scripts/sanitize-observations.js (one-time DB sweep)
 *   - eventually: ObservationConsolidator at write time, so new digests
 *     are sanitized before they're persisted
 */

import { execSync } from 'node:child_process';

export const REDACTION_TOKEN = '<AWS_SECRET_REDACTED>';
const FRAGMENT_RX = /<AWS_SECRET_REDACTED>([A-Za-z0-9._/+\-]+)/g;
const PATH_TOKEN_RX = /[A-Za-z0-9._/+\-]{8,}/g;

export class ObservationSanitizer {
  /**
   * @param {object} [opts]
   * @param {string[]} [opts.repoPaths] - Pre-built `git ls-files` corpus.
   *   Pass null to skip repo-wide fallback. Use loadRepoPaths() to build.
   */
  constructor(opts = {}) {
    this.repoPaths = opts.repoPaths || null;
    this.userIdToken = opts.userIdToken || '<USER_ID_REDACTED>';
    this.codingRoot = opts.codingRoot || `/Users/${this.userIdToken}/Agentic/coding`;
  }

  /**
   * Build the path corpus for repo-wide fallback. Excludes large noisy
   * directories so the suffix lookup stays focused on real source files.
   */
  static loadRepoPaths(repoRoot) {
    const out = execSync('git ls-files', {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
    });
    return out.split('\n').filter((p) => {
      if (!p) return false;
      if (p.startsWith('node_modules/') || p.includes('/node_modules/')) return false;
      if (p.startsWith('.specstory/')) return false;
      if (/\.(png|jpg|jpeg|gif|webp|ico|woff2?|ttf|eot)$/i.test(p)) return false;
      return true;
    });
  }

  /** Extract all path-like tokens from a body of text (≥8 chars). */
  _extractTokens(text) {
    if (!text) return [];
    const tokens = [];
    let m;
    PATH_TOKEN_RX.lastIndex = 0;
    while ((m = PATH_TOKEN_RX.exec(text)) !== null) {
      if (!m[0].includes(REDACTION_TOKEN)) tokens.push(m[0]);
    }
    return tokens;
  }

  /**
   * Try to recover a corrupted fragment by finding a clean token in the
   * supplied context that ends with the same suffix.
   *
   * @param {string} frag - the fragment that survived after the redaction token
   * @param {string[]} contextTokens - clean tokens to search
   * @returns {string|null} the recovered full token, or null
   */
  _recoverFromContext(frag, contextTokens) {
    if (!frag || !contextTokens.length) return null;
    const lowerFrag = frag.toLowerCase();
    // Match: any clean token whose tail equals frag (case-insensitive)
    // and has at least one extra leading char.
    const matches = contextTokens.filter((t) =>
      t.length > frag.length &&
      t.toLowerCase().endsWith(lowerFrag)
    );
    if (matches.length === 0) return null;
    // Pick the longest, most-specific match (full path beats bare basename)
    matches.sort((a, b) => b.length - a.length);
    return matches[0];
  }

  /**
   * Repo-wide fallback: find a unique repo file whose path ends with the
   * fragment (or a `/`-trimmed shorter suffix). Returns the canonical
   * absolute path if exactly one match, else null.
   */
  _recoverFromRepo(frag) {
    if (!this.repoPaths || !frag) return null;
    const candidates = [frag];
    let cur = frag;
    while (cur.includes('/')) {
      cur = cur.slice(cur.indexOf('/') + 1);
      if (cur.length >= 6) candidates.push(cur);
    }
    for (const c of candidates) {
      const target = c.startsWith('/') ? c : '/' + c;
      const matches = this.repoPaths.filter((p) => ('/' + p).endsWith(target));
      if (matches.length === 1) return `${this.codingRoot}/${matches[0]}`;
    }
    return null;
  }

  /**
   * Repair every `<AWS_SECRET_REDACTED>frag` occurrence in `text`.
   *
   * @param {string} text
   * @param {string[]} [contextStrings] - sibling fields/entries that may
   *   contain a clean version of the same path
   * @returns {{ text: string, fixed: number, ambiguous: number }}
   */
  sanitizeText(text, contextStrings = []) {
    if (!text || typeof text !== 'string' || !text.includes(REDACTION_TOKEN)) {
      return { text, fixed: 0, ambiguous: 0 };
    }

    // Build the recovery oracle: tokens from text + sibling strings.
    const corpus = [text, ...contextStrings.filter((s) => typeof s === 'string')].join('\n');
    const candidateTokens = this._extractTokens(corpus);

    let fixed = 0, ambiguous = 0;
    const out = text.replace(FRAGMENT_RX, (whole, frag) => {
      const ctxMatch = this._recoverFromContext(frag, candidateTokens);
      if (ctxMatch) {
        fixed++;
        return ctxMatch;
      }
      const repoMatch = this._recoverFromRepo(frag);
      if (repoMatch) {
        fixed++;
        return repoMatch;
      }
      ambiguous++;
      return whole;
    });
    return { text: out, fixed, ambiguous };
  }

  /**
   * Sanitize a list of file paths:
   *   1. Repair corrupted entries using siblings as context
   *   2. Dedupe by basename — keep the longest, non-corrupted variant
   *
   * @param {string|string[]} input - JSON string or array
   * @param {string[]} [contextStrings] - extra context (e.g. summary text)
   * @returns {{ result: typeof input, fixed: number, deduped: number }}
   */
  sanitizeFileList(input, contextStrings = []) {
    let arr;
    const wasJson = typeof input === 'string';
    if (wasJson) {
      try { arr = JSON.parse(input); } catch { return { result: input, fixed: 0, deduped: 0 }; }
    } else {
      arr = Array.isArray(input) ? input : [];
    }
    if (!Array.isArray(arr) || arr.length === 0) {
      return { result: input, fixed: 0, deduped: 0 };
    }

    let fixed = 0;

    // Step 1: repair each entry using its siblings + outer context as oracle
    const repaired = arr.map((entry) => {
      if (typeof entry !== 'string' || !entry.includes(REDACTION_TOKEN)) return entry;
      const sibs = arr.filter((e) => e !== entry);
      const r = this.sanitizeText(entry, [...sibs, ...contextStrings]);
      if (r.text !== entry) fixed += r.fixed;
      return r.text;
    });

    // Step 2: dedupe by basename, prefer longest non-corrupted variant
    const byBasename = new Map();
    for (const entry of repaired) {
      if (typeof entry !== 'string' || !entry.length) continue;
      const basename = entry.includes('/') ? entry.slice(entry.lastIndexOf('/') + 1) : entry;
      const existing = byBasename.get(basename);
      if (!existing) {
        byBasename.set(basename, entry);
        continue;
      }
      const existingCorrupt = existing.includes(REDACTION_TOKEN);
      const entryCorrupt = entry.includes(REDACTION_TOKEN);
      if (existingCorrupt && !entryCorrupt) byBasename.set(basename, entry);
      else if (!existingCorrupt && entryCorrupt) { /* keep existing */ }
      else if (entry.length > existing.length) byBasename.set(basename, entry);
    }

    const deduped = [...byBasename.values()];
    const dropped = repaired.length - deduped.length;
    const result = wasJson ? JSON.stringify(deduped) : deduped;
    return { result, fixed, deduped: dropped };
  }

  /**
   * Sanitize a JSON-shaped metadata blob. Walks string values and runs
   * sanitizeText on each. Arrays of paths get sanitizeFileList treatment.
   *
   * @param {string|object} input - JSON string or object
   * @returns {{ result: typeof input, fixed: number, deduped: number }}
   */
  sanitizeMetadata(input, contextStrings = []) {
    let obj;
    const wasJson = typeof input === 'string';
    if (wasJson) {
      try { obj = JSON.parse(input); } catch { return { result: input, fixed: 0, deduped: 0 }; }
    } else {
      obj = input;
    }
    if (!obj || typeof obj !== 'object') return { result: input, fixed: 0, deduped: 0 };

    let fixed = 0, deduped = 0;
    const walk = (node) => {
      if (typeof node === 'string') {
        const r = this.sanitizeText(node, contextStrings);
        fixed += r.fixed;
        return r.text;
      }
      if (Array.isArray(node)) {
        // Heuristic: if it looks like a file list (most strings have / or .ext),
        // run the dedup pass; otherwise just walk strings.
        const looksLikeFileList = node.length > 0 && node.every((x) => typeof x === 'string') &&
          node.filter((s) => s.includes('/') || /\.[a-z]{1,5}$/i.test(s)).length / node.length > 0.5;
        if (looksLikeFileList) {
          const r = this.sanitizeFileList(node, contextStrings);
          fixed += r.fixed;
          deduped += r.deduped;
          return r.result;
        }
        return node.map(walk);
      }
      if (node && typeof node === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(node)) out[k] = walk(v);
        return out;
      }
      return node;
    };

    const cleaned = walk(obj);
    const result = wasJson ? JSON.stringify(cleaned) : cleaned;
    return { result, fixed, deduped };
  }
}

export default ObservationSanitizer;
