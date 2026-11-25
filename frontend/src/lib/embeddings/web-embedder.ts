/**
 * Client-side embedding generation using Transformers.js (@xenova/transformers).
 * Generates 384-dimensional normalized float vectors for query and chunk embeddings.
 */

import { yieldToMain } from "../scheduler";

export interface EmbeddingProgress {
  status: "init" | "downloading" | "ready" | "processing";
  progress?: number;
  file?: string;
}

type FeatureExtractor = (
  text: string,
  options?: { pooling: "mean" | "cls"; normalize: boolean }
) => Promise<{ data: Float32Array; dims: number[] }>;

let extractorInstance: FeatureExtractor | null = null;
let extractorPromise: Promise<FeatureExtractor> | null = null;

export async function getWebEmbedder(
  onProgress?: (p: EmbeddingProgress) => void
): Promise<FeatureExtractor> {
  if (extractorInstance) {
    return extractorInstance;
  }

  if (!extractorPromise) {
    extractorPromise = (async () => {
      if (typeof window === "undefined") {
        throw new Error("Web embedder is designed to run in browser environments.");
      }

      onProgress?.({ status: "init" });
      await yieldToMain();

      const { pipeline, env } = await import("@xenova/transformers");
      env.allowLocalModels = false;
      env.useBrowserCache = true;

      const pipe = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", {
        quantized: true,
        progress_callback: (item: { status?: string; progress?: number; file?: string }) => {
          if (item?.status === "progress" && item.progress !== undefined) {
            onProgress?.({
              status: "downloading",
              progress: Math.round(item.progress),
              file: item.file,
            });
          }
        },
      });

      onProgress?.({ status: "ready" });
      await yieldToMain();
      extractorInstance = pipe as unknown as FeatureExtractor;
      return extractorInstance;
    })().catch((err) => {
      // Reset cached promise on failure so subsequent attempts can retry (API-06)
      extractorPromise = null;
      throw err;
    });
  }

  return extractorPromise;
}

/**
 * Generate 384-dimensional dense vector for a single text string.
 * Returns null for empty/whitespace-only text to avoid zero-vector NaN cosine distances in pgvector.
 */
export async function embedText(
  text: string,
  onProgress?: (p: EmbeddingProgress) => void
): Promise<number[] | null> {
  const clean = text.trim();
  if (!clean) {
    return null;
  }

  await yieldToMain();
  const extractor = await getWebEmbedder(onProgress);
  await yieldToMain();
  const output = await extractor(clean, { pooling: "mean", normalize: true });
  return Array.from(output.data);
}

/**
 * Generate 384-dimensional embeddings for a batch of texts sequentially.
 * Returns null for empty/whitespace-only entries.
 */
export async function embedBatch(
  texts: string[],
  onProgress?: (index: number, total: number) => void
): Promise<Array<number[] | null>> {
  const extractor = await getWebEmbedder();
  const results: Array<number[] | null> = [];

  for (let i = 0; i < texts.length; i++) {
    const text = texts[i].trim();
    if (!text) {
      results.push(null);
    } else {
      await yieldToMain();
      const output = await extractor(text, { pooling: "mean", normalize: true });
      results.push(Array.from(output.data));
    }
    onProgress?.(i + 1, texts.length);
  }

  return results;
}
