export interface EmbeddingProvider {
  readonly name: string
  readonly paid: boolean
  embed(texts: readonly string[]): Promise<number[][]>
}
