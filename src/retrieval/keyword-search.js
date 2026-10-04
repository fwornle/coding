/**
 * Keyword search over the live km-core store — the half of hybrid retrieval
 * that needs no vector index.
 *
 * Was SQLite FTS5/LIKE over the observations database. The km-core cutover
 * (Plan 44-18) archived that file, the handle became null, and this source
 * silently returned [] on every query — so injection was Qdrant-only, and a
 * machine whose Qdrant was empty or down (a teammate's fresh clone, T8)
 * injected nothing at all. It also matched the WHOLE prompt as one substring
 * (`LIKE '%<query>%'`), which a natural-language prompt almost never is.
 *
 * Now: the query's terms, IDF-weighted over the store, against each entity's
 * text, a match in the title (topic / name) counting double. Only the tiers
 * retrieve() keeps (insights + kg_entities — its tier gate drops the rest), so
 * observations and digests are not scanned. Ids and payloads are the ones the
 * backfill gives the same entity in Qdrant (src/embedding/backfill.ts), so a
 * keyword hit and a vector hit of one entity fuse into one RRF entry:
 *
 *   insights      Insight entities, id = the node key
 *   kg_entities   every other entity with a description, id = keyToUuid(key)
 *                 (Insight / Observation / Digest are left to their own
 *                 tiers here — vector search already returns them twice)
 *
 * @module keyword-search
 */

import { makePreview, previewVersion } from '../../dist/embedding/preview.js';
import { keyToUuid } from '../../dist/embedding/point-id.js';

/** Words that appear everywhere and carry no topic signal. */
export const STOP_WORDS = new Set([
  'the', 'and', 'for', 'that', 'this', 'with', 'from', 'are', 'was',
  'were', 'been', 'have', 'has', 'had', 'not', 'but', 'what', 'how',
  'why', 'when', 'where', 'which', 'who', 'will', 'can', 'does', 'did',
  'should', 'would', 'could', 'may', 'about', 'into', 'out', 'all',
  'also', 'just', 'than', 'then', 'very', 'some', 'any', 'each',
  'use', 'using', 'used', 'make', 'like', 'need', 'know', 'here',
  'context', 'you', 'your', 'our', 'its', 'their', 'they', 'she',
  'coding', 'project', 'file', 'files', 'system', 'service',
]);

/** The meaningful words of a query: 3+ chars, not a stop word, lowercased. */
export function queryTerms(query) {
  return new Set(
    String(query || '').toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !STOP_WORDS.has(w)),
  );
}

const EPISODIC = new Set(['Observation', 'Digest']);

function projectOf(attrs) {
  const m = attrs?.metadata || {};
  return m.project || m.team || null;
}

export class KeywordSearch {
  /**
   * @param {object} [options]
   * @param {number} [options.limit=10] - Max results per tier
   */
  constructor(options = {}) {
    this.limit = options.limit ?? 10;
    // node key → { stamp, doc }: the lowercased text is rebuilt only when the
    // entity changed, so a query costs a scan, not a re-lowercasing of the graph.
    this._docs = new Map();
  }

  /**
   * @param {{graph: {nodes(): string[], getNodeAttributes(id: string): object}}|null} store
   * @param {string} query
   * @param {{projects?: string[]|null}} [opts] - keep only these projects (before the limit)
   * @returns {Array<{id: string, tier: string, score: number, payload: object}>}
   */
  search(store, query, opts = {}) {
    const graph = store?.graph;
    if (!graph || !query) return [];
    const terms = [...queryTerms(query)];
    if (!terms.length) return [];
    const want = opts.projects ? new Set(opts.projects.map((p) => String(p).toLowerCase())) : null;

    const docs = [];
    const seen = new Set();
    for (const key of graph.nodes()) {
      seen.add(key);
      const attrs = graph.getNodeAttributes(key);
      if (!attrs || attrs.isScaffoldNode || EPISODIC.has(attrs.entityType)) continue;
      if (want) {
        const p = projectOf(attrs);
        if (!p || !want.has(String(p).toLowerCase())) continue;
      }
      const doc = this._doc(key, attrs);
      if (doc) docs.push(doc);
    }
    for (const key of this._docs.keys()) if (!seen.has(key)) this._docs.delete(key);

    // IDF over the scanned documents: a term most entities contain ranks low.
    // Floored like _applyTopicRelevance's, or a term in EVERY document scores
    // 0 — and with a narrow team filter that can be every term of a perfect
    // match (one document left = idf 0 for all).
    const N = docs.length;
    const df = new Map(terms.map((t) => [t, 0]));
    for (const d of docs) for (const t of terms) if (d.text.includes(t)) df.set(t, df.get(t) + 1);
    const idf = (t) => Math.max(Math.log((N + 1) / (df.get(t) + 1)), 0.05);

    const byTier = { insights: [], kg_entities: [] };
    for (const d of docs) {
      let score = 0;
      let matched = 0;
      for (const t of terms) {
        if (!d.text.includes(t)) continue;
        matched++;
        score += idf(t) * (d.title.includes(t) ? 2 : 1);
      }
      // One stray word is not a match once the query has several.
      if (score <= 0 || matched < Math.min(2, terms.length)) continue;
      byTier[d.tier].push({ d, score });
    }

    const out = [];
    for (const [tier, hits] of Object.entries(byTier)) {
      hits.sort((a, b) => b.score - a.score);
      for (const { d, score } of hits.slice(0, this.limit)) {
        out.push({ id: d.id, tier, score, payload: d.payload() });
      }
    }
    return out;
  }

  /** The searchable form of one entity, cached by its updatedAt. */
  _doc(key, attrs) {
    const stamp = attrs.updatedAt || attrs.createdAt || '';
    const hit = this._docs.get(key);
    if (hit && hit.stamp === stamp) return hit.doc;

    const m = attrs.metadata || {};
    const name = attrs.name || key;
    let doc = null;
    if (attrs.entityType === 'Insight') {
      const topic = m.topic || name;
      const summary = m.summary || attrs.description || '';
      if (summary) {
        doc = {
          tier: 'insights',
          id: key,
          title: topic.toLowerCase(),
          text: `${topic}\n${summary}`.toLowerCase(),
          payload: () => ({
            topic,
            confidence: typeof m.confidence === 'number' ? m.confidence : null,
            project: projectOf(attrs),
            summary_preview: makePreview(summary),
            preview_version: previewVersion(),
          }),
        };
      }
    } else {
      const description = typeof attrs.description === 'string' ? attrs.description : '';
      const body = description || (Array.isArray(attrs.observations) ? attrs.observations.join('\n') : '');
      if (body.trim()) {
        const text = `${name}\n${body}`;
        doc = {
          tier: 'kg_entities',
          id: keyToUuid(key),
          title: String(name).toLowerCase(),
          text: text.toLowerCase(),
          payload: () => ({
            entityType: attrs.entityType ?? attrs.type ?? 'Unknown',
            hierarchyLevel: attrs.hierarchyLevel ?? null,
            parentId: attrs.parentEntityName ?? null,
            project: projectOf(attrs),
            summary_preview: makePreview(text),
            preview_version: previewVersion(),
          }),
        };
      }
    }
    this._docs.set(key, { stamp, doc });
    return doc;
  }
}
