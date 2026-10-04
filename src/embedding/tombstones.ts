// The kg_entities points a deletion left behind.
//
// A deleted entity travels to other machines as a tombstone in the export
// (`attributes.kmTombstones`, km-core merge.ts), and the merge drops it from
// the graph — but its Qdrant point was made on write, by whichever machine
// embedded it, and nothing ever removed it: injection kept serving knowledge
// the graph no longer held (T8). Own module so it can be tested without
// importing backfill.ts, which runs its backfill on import.

import { keyToUuid } from "./point-id.js";

interface TombstonedGraph {
  attributes?: Record<string, unknown>;
  nodes?: Array<{ key: string }>;
}

/**
 * Point ids of every tombstoned entity of a MERGED graph. A key the graph
 * still holds was re-created after its deletion (a newer copy won the merge),
 * so its point stays.
 */
export function tombstonedPointIds(graph: TombstonedGraph): string[] {
  const stones = (graph.attributes?.kmTombstones ?? {}) as { entities?: Record<string, unknown> };
  const live = new Set((graph.nodes ?? []).map((n) => n.key));
  return Object.keys(stones.entities ?? {})
    .filter((key) => !live.has(key))
    .map(keyToUuid);
}
