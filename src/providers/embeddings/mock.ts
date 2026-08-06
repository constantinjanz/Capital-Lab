import { createHash } from 'node:crypto'

import type { EmbeddingProvider } from './types'

/** Deterministic fixture embedding; never use for production semantic quality. */
export class DeterministicMockEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'deterministic-mock-embedding'
  readonly paid = false

  async embed(texts: readonly string[]): Promise<number[][]> {
    return texts.map((text) => {
      const bytes = createHash('sha256').update(text).digest()
      return Array.from(bytes.subarray(0, 16), (byte) => (byte - 127.5) / 127.5)
    })
  }
}
