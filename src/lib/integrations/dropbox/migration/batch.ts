// Shared bounded-concurrency helper — every migration phase (preview, copy,
// verify) must process Dropbox API calls in tightly bounded batches, never
// an unbounded Promise.all ("no Dropbox API flood").
export const DEFAULT_BATCH_SIZE = 10;
export const MAX_BATCH_SIZE = 20;

export async function runInBatches<T, R>(
  items: T[],
  worker: (item: T) => Promise<R>,
  batchSize: number = DEFAULT_BATCH_SIZE
): Promise<R[]> {
  const size = Math.min(Math.max(1, batchSize), MAX_BATCH_SIZE);
  const results: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    const chunk = items.slice(i, i + size);
    const chunkResults = await Promise.all(chunk.map(worker));
    results.push(...chunkResults);
  }
  return results;
}
