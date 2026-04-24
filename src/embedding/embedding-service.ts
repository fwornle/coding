import { EmbeddingModel, FlagEmbedding } from "fastembed";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Embedding configuration loaded from embedding-config.json */
interface EmbeddingConfig {
  model: string;
  dimensions: number;
  distance: string;
  version: string;
  collections: Record<string, { payloadIndexes: string[] }>;
}

// Config lives in src/embedding/ but this runs from dist/embedding/
// Resolve relative to project root to work in both dev (tsx) and compiled (tsc) modes
const projectRoot = join(__dirname, "..", "..");
const configPath = join(projectRoot, "src", "embedding", "embedding-config.json");
const config: EmbeddingConfig = JSON.parse(
  readFileSync(configPath, "utf-8")
);

type FastEmbedModel = Awaited<ReturnType<typeof FlagEmbedding.init>>;

/**
 * Singleton fastembed wrapper providing embedOne and embedBatch methods.
 * Reads model configuration from embedding-config.json (single source of truth per D-02).
 * Uses lazy initialization — the ONNX model is loaded on first use.
 */
export class EmbeddingService {
  private model: FastEmbedModel | null = null;
  private initPromise: Promise<void> | null = null;

  /**
   * Initialize the fastembed model. Guarded: safe to call multiple times.
   * First call downloads/loads the ONNX model; subsequent calls are no-ops.
   */
  async initialize(): Promise<void> {
    if (this.model) return;
    if (this.initPromise) {
      await this.initPromise;
      return;
    }
    this.initPromise = (async () => {
      process.stderr.write(
        `[EmbeddingService] Initializing fastembed model: ${config.model} (${config.dimensions}-dim)\n`
      );
      this.model = await FlagEmbedding.init({
        model: EmbeddingModel.AllMiniLML6V2,
      });
      process.stderr.write(
        `[EmbeddingService] Model initialized successfully (v${config.version})\n`
      );
    })();
    await this.initPromise;
  }

  /**
   * Embed a single text string. Returns a number[] of length config.dimensions.
   * Initializes the model on first call if not already initialized.
   */
  async embedOne(text: string): Promise<number[]> {
    await this.initialize();
    const result = await this.model!.queryEmbed(text);
    // fastembed returns a typed array (Float32Array); convert to plain number[]
    return Array.from(result as ArrayLike<number>);
  }

  /**
   * Embed a batch of texts using fastembed's async generator.
   * Yields arrays of embedding vectors (number[][]) in batches.
   * Use for bulk embedding (backfill) to avoid loading all vectors into memory at once.
   */
  async *embedBatch(
    texts: string[],
    batchSize = 64
  ): AsyncGenerator<number[][]> {
    await this.initialize();
    const generator = this.model!.embed(texts, batchSize);
    for await (const batch of generator) {
      // Each batch element may be a typed array; convert to plain number[][]
      yield batch.map((vec: ArrayLike<number>) => Array.from(vec));
    }
  }

  /**
   * Returns the parsed embedding configuration (model, dimensions, collections, etc.).
   */
  getConfig(): EmbeddingConfig {
    return config;
  }
}

let instance: EmbeddingService | null = null;

/**
 * Get the singleton EmbeddingService instance.
 * Creates the instance on first call (does NOT initialize the model — call embedOne/embedBatch for that).
 */
export function getEmbeddingService(): EmbeddingService {
  if (!instance) {
    instance = new EmbeddingService();
  }
  return instance;
}
