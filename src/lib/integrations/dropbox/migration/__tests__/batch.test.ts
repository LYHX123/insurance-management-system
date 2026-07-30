import { describe, it, expect, vi } from "vitest";
import { runInBatches, DEFAULT_BATCH_SIZE, MAX_BATCH_SIZE } from "../batch";

describe("runInBatches (Migration Part 15.D.9 — no Dropbox API flood)", () => {
  it("processes all items and preserves order of results", async () => {
    const items = Array.from({ length: 23 }, (_, i) => i);
    const results = await runInBatches(items, async (n) => n * 2, 5);
    expect(results).toEqual(items.map((n) => n * 2));
  });

  it("never has more than batchSize concurrent in-flight workers", async () => {
    const items = Array.from({ length: 12 }, (_, i) => i);
    let concurrent = 0;
    let maxConcurrent = 0;

    await runInBatches(
      items,
      async (n) => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise((r) => setTimeout(r, 1));
        concurrent--;
        return n;
      },
      4
    );

    expect(maxConcurrent).toBeLessThanOrEqual(4);
  });

  it("clamps an oversized batchSize down to MAX_BATCH_SIZE", async () => {
    const items = Array.from({ length: 25 }, (_, i) => i);
    let concurrent = 0;
    let maxConcurrent = 0;

    await runInBatches(
      items,
      async (n) => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise((r) => setTimeout(r, 1));
        concurrent--;
        return n;
      },
      1000
    );

    expect(maxConcurrent).toBeLessThanOrEqual(MAX_BATCH_SIZE);
  });

  it("defaults to DEFAULT_BATCH_SIZE when no batchSize is given", async () => {
    const worker = vi.fn(async (n: number) => n);
    const items = Array.from({ length: DEFAULT_BATCH_SIZE + 3 }, (_, i) => i);
    await runInBatches(items, worker);
    expect(worker).toHaveBeenCalledTimes(items.length);
  });

  it("clamps batchSize below 1 up to 1 (sequential, never zero-sized batches)", async () => {
    const items = [1, 2, 3];
    const order: number[] = [];
    await runInBatches(
      items,
      async (n) => {
        order.push(n);
        return n;
      },
      0
    );
    expect(order).toEqual([1, 2, 3]);
  });
});
