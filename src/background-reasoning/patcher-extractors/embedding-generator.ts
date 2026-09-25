// W5 Y3 · embedding-generator — local-first embedding fan-out for KGS FTS5/vector index.
// Cf. ROADMAP-background-reasoning §3.7 + KGS P2 FTS5 (Y1 #2402).
// Embedding model is injected; extractor only knows record → vector pair.

import type { NormalizedRecord } from './log-normalizer.js';

export interface EmbeddingVector {
  /** Source record kind for downstream filter. */
  sourceKind: string;
  /** Numeric vector. Length is model-dependent. */
  vector: number[];
  /** Echoed text the embedding was computed over. */
  text: string;
}

export interface EmbeddingCallable {
  (texts: string[]): Promise<number[][]>;
}

export interface EmbeddingGeneratorDeps {
  callable: EmbeddingCallable;
  /** Max texts per embedding call. Default 64. */
  batchSize?: number;
}

export class EmbeddingGenerator {
  private readonly callable: EmbeddingCallable;
  private readonly batchSize: number;

  constructor(deps: EmbeddingGeneratorDeps) {
    this.callable = deps.callable;
    this.batchSize = Math.max(1, deps.batchSize ?? 64);
  }

  async generate(records: NormalizedRecord[]): Promise<EmbeddingVector[]> {
    if (records.length === 0) return [];
    const out: EmbeddingVector[] = [];
    for (let i = 0; i < records.length; i += this.batchSize) {
      const batch = records.slice(i, i + this.batchSize);
      const texts = batch.map((r) => r.text);
      const vectors = await this.callable(texts);
      for (let j = 0; j < batch.length; j++) {
        out.push({
          sourceKind: batch[j]!.kind,
          vector: vectors[j] ?? [],
          text: texts[j]!,
        });
      }
    }
    return out;
  }
}
