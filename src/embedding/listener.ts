#!/usr/bin/env node
/**
 * Embedding Listener - Redis pub/sub consumer that embeds new knowledge items into Qdrant.
 *
 * Subscribes to the "embedding:new" Redis channel and processes incoming events
 * by embedding text content via fastembed and upserting vectors to Qdrant.
 *
 * Runs as a long-lived supervisord process in Docker (see supervisord.conf).
 * Per D-05/D-06: decoupled from write path via event bus.
 *
 * @module EmbeddingListener
 */

import Redis from "ioredis";
import { getEmbeddingService } from "./embedding-service.js";
import { getQdrantClient, ensureCollections } from "./qdrant-collections.js";
import { contentHash } from "./content-hash.js";

/** Event message format published by ObservationWriter (and future writers) */
interface EmbeddingEvent {
  type: "observation" | "digest" | "insight" | "kg_entity";
  id: string;
  content: string;
  metadata: Record<string, string | number | boolean | null>;
  timestamp: string;
}

async function main(): Promise<void> {
  // 1. Initialize fastembed model (downloads ONNX on first run)
  const embedder = getEmbeddingService();
  await embedder.initialize();
  process.stderr.write("[EmbeddingListener] Embedding model initialized\n");

  // 2. Connect to Qdrant and ensure collections exist
  const qdrant = getQdrantClient();
  await ensureCollections(qdrant);
  process.stderr.write("[EmbeddingListener] Qdrant collections ensured\n");

  // 3. Connect to Redis for pub/sub
  const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
  const sub = new Redis(redisUrl, {
    maxRetriesPerRequest: null, // Required for pub/sub mode in ioredis
    retryStrategy(times: number): number | null {
      if (times > 10) {
        process.stderr.write(
          `[EmbeddingListener] Redis retry limit exceeded (${times} attempts), exiting\n`
        );
        process.exit(1);
      }
      const delay = Math.min(times * 500, 5000);
      process.stderr.write(
        `[EmbeddingListener] Redis reconnecting in ${delay}ms (attempt ${times})\n`
      );
      return delay;
    },
  });

  sub.on("error", (err: Error) => {
    process.stderr.write(
      `[EmbeddingListener] Redis error: ${err.message}\n`
    );
  });

  // 4. Subscribe to embedding:new channel
  await sub.subscribe("embedding:new");
  process.stderr.write(
    "[EmbeddingListener] Subscribed to embedding:new, waiting for events...\n"
  );

  // 5. Process incoming messages
  sub.on("message", async (_channel: string, message: string) => {
    try {
      const event: EmbeddingEvent = JSON.parse(message);

      // Map event type to Qdrant collection name
      const collectionName =
        event.type === "kg_entity" ? "kg_entities" : `${event.type}s`;

      // Compute content hash for idempotency metadata
      const hash = contentHash(event.content);

      // Embed the content
      const vector = await embedder.embedOne(event.content);

      // Upsert to Qdrant (wait: false for real-time path -- don't block on persistence)
      await qdrant.upsert(collectionName, {
        wait: false,
        points: [
          {
            id: event.id,
            vector: Array.from(vector),
            payload: {
              ...event.metadata,
              content_hash: hash,
              model_version: embedder.getConfig().version,
              summary_preview: event.content.substring(0, 200),
            },
          },
        ],
      });

      process.stderr.write(
        `[EmbeddingListener] Embedded ${event.type} ${event.id.substring(0, 8)}... -> ${collectionName}\n`
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        `[EmbeddingListener] Failed to process event: ${msg}\n`
      );
      // Do NOT crash -- continue processing next events
    }
  });

  // 6. Graceful shutdown
  const shutdown = async (): Promise<void> => {
    process.stderr.write("[EmbeddingListener] Shutting down...\n");
    try {
      await sub.unsubscribe("embedding:new");
      sub.disconnect();
    } catch {
      // Best effort cleanup
    }
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`[EmbeddingListener] Fatal error: ${msg}\n`);
  process.exit(1);
});
