// lib/experiments/taxonomy.mjs
// The curated task-taxonomy primitives (KB-03 / SC-3). All three exports are
// PURE and deterministic — no LLM, no network.
//
//   loadTaxonomy(filePath?)        → { version, classes }   (parses the YAML SoT)
//   isValidClass(cls, taxonomy?)   → boolean                (D-09/SC-4 enforcement)
//   deriveClassFromText(text, tax) → { taskClass, confident } (D-11 zero-LLM scorer)
//
// Single source of truth: config/task-taxonomy.yaml (D-10). isValidClass is the
// closed-6 write-path enforcement primitive — it rejects `unclassified` (the
// quarantine sentinel) and any free string. deriveClassFromText is the zero-LLM
// keyword scorer the /gsd derivation heuristic consumes.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Default config path: <repo>/config/task-taxonomy.yaml. This module lives at
// <repo>/lib/experiments/, so the repo root is two levels up.
const DEFAULT_TAXONOMY_PATH = path.resolve(__dirname, '..', '..', 'config', 'task-taxonomy.yaml');

// The closed-6 (D-09). `unclassified` is deliberately NOT a member — it is the
// quarantine sentinel applied at write-time, never a curated taxonomy class.
const CLOSED_6 = Object.freeze(['refactor', 'bugfix', 'new-feature', 'migration', 'debug', 'docs']);

/**
 * Parse config/task-taxonomy.yaml (or a supplied path) into { version, classes }.
 * @param {string} [filePath] - absolute path to the taxonomy YAML; defaults to the repo SoT.
 * @returns {{ version: number, classes: Record<string, { definition: string, keywords: string[] }> }}
 */
export function loadTaxonomy(filePath = DEFAULT_TAXONOMY_PATH) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = yaml.load(raw);
  return { version: parsed.version, classes: parsed.classes };
}

/**
 * The D-09/SC-4 write-path enforcement primitive: accept ONLY one of the
 * closed-6 class ids. Rejects `unclassified` and any free string. When a parsed
 * taxonomy is supplied its class keys are used; otherwise the static closed-6.
 * @param {unknown} cls
 * @param {{ classes?: Record<string, unknown> }} [taxonomy]
 * @returns {boolean}
 */
export function isValidClass(cls, taxonomy) {
  if (typeof cls !== 'string' || cls.length === 0) return false;
  const valid = taxonomy && taxonomy.classes ? Object.keys(taxonomy.classes) : CLOSED_6;
  return valid.includes(cls);
}

/**
 * Zero-LLM deterministic keyword scorer (D-11). Lowercase + tokenize on word
 * boundaries; hyphenated/multiword keywords are matched as substrings (score +2)
 * so hints like "new-feature" survive tokenization; bare keywords are matched
 * against the token set (score +1). Returns the best-scoring class, or
 * { taskClass: null, confident: false } when no keyword hits.
 * @param {string} text
 * @param {{ classes: Record<string, { keywords: string[] }> }} taxonomy
 * @returns {{ taskClass: string|null, confident: boolean }}
 */
export function deriveClassFromText(text, taxonomy) {
  const lower = String(text).toLowerCase();
  const toks = lower.match(/[a-z][a-z-]+/g) ?? [];
  const tokenSet = new Set(toks);
  let best = null;
  let bestScore = 0;
  for (const [cls, def] of Object.entries(taxonomy.classes)) {
    let score = 0;
    for (const kw of def.keywords) {
      if (kw.includes('-')) {
        if (lower.includes(kw)) score += 2; // multiword/hyphenated literal substring
      } else if (tokenSet.has(kw)) {
        score += 1;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      best = cls;
    }
  }
  return bestScore > 0 ? { taskClass: best, confident: bestScore >= 1 } : { taskClass: null, confident: false };
}
