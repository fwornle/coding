/**
 * Working memory assembly for retrieval responses.
 *
 * Queries KG entities (Project + Component) via VKB HTTP API and parses
 * STATE.md frontmatter for current milestone/phase/status. Assembles a
 * token-budgeted markdown section (<=300 tokens) prepended to retrieval results.
 *
 * Fail-open design: if VKB is unreachable or STATE.md is missing, returns
 * empty working memory and lets semantic search use the full token budget.
 *
 * @module working-memory
 */

import { readFileSync } from 'node:fs';
import { countTokens } from 'gpt-tokenizer';

/** Firm 300-token ceiling for working memory (D-05). */
const WM_BUDGET = 300;

/** 2-second abort timeout for VKB API calls (pitfall 1). */
const VKB_TIMEOUT = 2000;

/** VKB API base URL. */
const VKB_BASE = 'http://localhost:8080';

/**
 * Fetch Project and Component entities from the VKB API.
 *
 * Uses Promise.all for parallel fetches with AbortSignal.timeout
 * to prevent hung requests (T-31-01 mitigation).
 *
 * @returns {Promise<{ project: object|null, components: Array<object> }>}
 */
async function fetchKGStructure() {
  try {
    const base = `${VKB_BASE}/api/entities?team=coding`;
    const [projectRes, componentRes] = await Promise.all([
      fetch(`${base}&type=Project`, { signal: AbortSignal.timeout(VKB_TIMEOUT) }),
      fetch(`${base}&type=Component`, { signal: AbortSignal.timeout(VKB_TIMEOUT) }),
    ]);

    if (!projectRes.ok || !componentRes.ok) {
      process.stderr.write(
        `[WorkingMemory] VKB API returned non-OK: project=${projectRes.status}, component=${componentRes.status}\n`
      );
      return { project: null, components: [] };
    }

    const projectData = await projectRes.json();
    const componentData = await componentRes.json();

    return {
      project: projectData.entities?.[0] || null,
      components: componentData.entities || [],
    };
  } catch (err) {
    process.stderr.write(`[WorkingMemory] VKB fetch failed: ${err.message}\n`);
    return { project: null, components: [] };
  }
}

/**
 * Parse STATE.md frontmatter and Blockers/Concerns section.
 *
 * Extracts YAML frontmatter between --- markers using regex (no YAML
 * dependency needed for simple key-value pairs). Also parses the
 * Blockers/Concerns section from the body for known issues.
 *
 * @param {string} codingRoot - Path to the coding repo root
 * @returns {object|null} Parsed state data, or null on error
 */
function parseStateFrontmatter(codingRoot) {
  try {
    const statePath = `${codingRoot}/.planning/STATE.md`;
    const content = readFileSync(statePath, 'utf8');

    // Extract frontmatter
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) return null;

    const fm = fmMatch[1];
    const get = (key) => {
      const m = fm.match(new RegExp('^' + key + ':\\s*(.+)$', 'm'));
      return m ? m[1].replace(/^["']|["']$/g, '').trim() : null;
    };

    // Extract Blockers/Concerns section from body
    const concerns = [];
    const bodyAfterFrontmatter = content.slice(fmMatch[0].length);
    const concernsMatch = bodyAfterFrontmatter.match(/### Blockers\/Concerns\n([\s\S]*?)(?=\n##|\n---|\n$)/);
    if (concernsMatch) {
      const lines = concernsMatch[1].split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('- ')) {
          concerns.push(trimmed.slice(2).trim());
        }
      }
    }

    return {
      milestone: get('milestone'),
      milestoneName: get('milestone_name'),
      status: get('status'),
      stoppedAt: get('stopped_at'),
      lastActivity: get('last_activity'),
      concerns,
    };
  } catch {
    return null;
  }
}

/**
 * Extract a short description from a component's observations.
 *
 * Uses the first observation's content, strips [LLM] prefix,
 * and truncates to maxLen characters.
 *
 * @param {object} component - KG entity with observations array
 * @param {number} [maxLen=60] - Maximum description length
 * @returns {string} Truncated description or empty string
 */
function extractDescription(component, maxLen = 60) {
  const content = component.observations?.[0]?.content;
  if (!content) return '';
  const cleaned = content.replace(/^\[LLM\]\s*/, '');
  if (cleaned.length <= maxLen) return cleaned;
  return cleaned.slice(0, maxLen - 3) + '...';
}

/**
 * Assemble markdown from KG structure and STATE.md data.
 *
 * Builds a structured markdown section with project hierarchy
 * and current state information.
 *
 * @param {object} kgData - { project, components } from fetchKGStructure
 * @param {object|null} stateData - Parsed STATE.md data or null
 * @returns {string} Assembled markdown string
 */
function assembleMarkdown(kgData, stateData) {
  const hasKG = kgData.project || kgData.components.length > 0;
  const hasState = stateData !== null;

  if (!hasKG && !hasState) return '';

  const parts = ['## Working Memory'];

  // Structure subsection
  if (hasKG) {
    if (kgData.project) {
      parts.push(`**Project:** ${kgData.project.entity_name}`);
    }
    if (kgData.components.length > 0) {
      for (const comp of kgData.components) {
        const desc = extractDescription(comp);
        if (desc) {
          parts.push(`- **${comp.entity_name}**: ${desc}`);
        } else {
          parts.push(`- **${comp.entity_name}**`);
        }
      }
    }
  }

  // State subsection
  if (hasState) {
    if (stateData.milestone) {
      const name = stateData.milestoneName ? ` ${stateData.milestoneName}` : '';
      parts.push(`**Milestone:** ${stateData.milestone}${name}`);
    }
    if (stateData.status) {
      parts.push(`**Status:** ${stateData.status}`);
    }
    if (stateData.stoppedAt) {
      parts.push(`**Current:** ${stateData.stoppedAt}`);
    }
    if (stateData.concerns && stateData.concerns.length > 0) {
      parts.push('**Known Issues:**');
      const maxConcerns = stateData.concerns.slice(0, 3);
      for (const concern of maxConcerns) {
        parts.push(`- ${concern}`);
      }
    }
  }

  return parts.join('\n');
}

/**
 * Truncate working memory markdown to fit within token budget (D-07).
 *
 * Progressive truncation strategy:
 * 1. Rebuild with component names only (no descriptions)
 * 2. Drop all components, keep Project + state
 * 3. Keep state section only, truncate if needed
 *
 * @param {string} fullMarkdown - Original assembled markdown
 * @param {object} kgData - { project, components } from fetchKGStructure
 * @param {object|null} stateData - Parsed STATE.md data or null
 * @param {number} maxTokens - Token budget ceiling
 * @returns {string} Truncated markdown that fits within budget
 */
function truncateToFit(fullMarkdown, kgData, stateData, maxTokens) {
  // Step 1: Rebuild with component names only (no descriptions)
  const step1KG = {
    project: kgData.project,
    components: kgData.components.map((c) => ({
      ...c,
      observations: [], // Force no descriptions
    })),
  };
  let md = assembleMarkdown(step1KG, stateData);
  if (countTokens(md) <= maxTokens) return md;

  // Step 2: Drop all components, keep Project + state
  const step2KG = {
    project: kgData.project,
    components: [],
  };
  md = assembleMarkdown(step2KG, stateData);
  if (countTokens(md) <= maxTokens) return md;

  // Step 3: State section only (drop KG entirely)
  md = assembleMarkdown({ project: null, components: [] }, stateData);
  if (countTokens(md) <= maxTokens) return md;

  // Step 3b: Truncate state text to fit
  // Build minimal state: just milestone and status
  const minimalState = {
    milestone: stateData?.milestone,
    milestoneName: stateData?.milestoneName,
    status: stateData?.status,
    stoppedAt: null,
    lastActivity: null,
    concerns: [],
  };
  md = assembleMarkdown({ project: null, components: [] }, minimalState);
  if (countTokens(md) <= maxTokens) return md;

  // Absolute fallback: header only
  return '## Working Memory';
}

/**
 * Build working memory section from KG structure and STATE.md.
 *
 * Fetches Project + Component entities from the VKB API and parses
 * STATE.md frontmatter for current milestone/phase/status. Assembles
 * a token-budgeted markdown section (<=300 tokens per D-05).
 *
 * Fail-open: returns { markdown: '', tokens: 0 } on any error (D-03).
 * No caching -- every call queries live data (D-03, D-04).
 *
 * @param {string} codingRoot - Path to the coding repo root
 * @returns {Promise<{ markdown: string, tokens: number }>}
 */
export async function buildWorkingMemory(codingRoot) {
  try {
    const [kgData, stateData] = await Promise.all([
      fetchKGStructure(),
      Promise.resolve(parseStateFrontmatter(codingRoot)),
    ]);

    let markdown = assembleMarkdown(kgData, stateData);

    if (!markdown) {
      return { markdown: '', tokens: 0 };
    }

    let tokens = countTokens(markdown);

    if (tokens > WM_BUDGET) {
      markdown = truncateToFit(markdown, kgData, stateData, WM_BUDGET);
      tokens = countTokens(markdown);
    }

    return { markdown, tokens };
  } catch (err) {
    process.stderr.write(`[WorkingMemory] Failed: ${err.message}\n`);
    return { markdown: '', tokens: 0 };
  }
}
