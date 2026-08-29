import { z } from "zod";

export const RETRIEVAL_QUERY_CONCURRENCY = 3;

/**
 * Settles input work under a small explicit worker cap while retaining input
 * order in the returned settlements. Callers own any policy for stopping work
 * after a rejection; every item handed to this helper is attempted once.
 */
export async function settleWithBoundedWorkers<Input, Output>(options: {
  inputs: readonly Input[];
  concurrency: number;
  execute: (input: Input, index: number) => Promise<Output>;
}): Promise<readonly PromiseSettledResult<Output>[]> {
  const concurrency = z.number().int().positive().parse(options.concurrency);
  if (options.inputs.length === 0) return [];

  const settlements = new Array<PromiseSettledResult<Output>>(
    options.inputs.length,
  );
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, options.inputs.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < options.inputs.length) {
      const index = nextIndex;
      nextIndex += 1;
      const input = options.inputs[index];
      if (input === undefined) {
        throw new Error("Bounded worker claimed an unavailable input");
      }
      try {
        settlements[index] = {
          status: "fulfilled",
          value: await options.execute(input, index),
        };
      } catch (reason) {
        settlements[index] = { status: "rejected", reason };
      }
    }
  });

  const workerSettlements = await Promise.allSettled(workers);
  const workerFailure = workerSettlements.find(
    (settlement): settlement is PromiseRejectedResult =>
      settlement.status === "rejected",
  );
  if (workerFailure !== undefined) throw workerFailure.reason;
  if (settlements.some((settlement) => settlement === undefined)) {
    throw new Error("Bounded workers did not settle every input");
  }
  return settlements;
}
