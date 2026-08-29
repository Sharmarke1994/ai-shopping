import { describe, expect, it } from "vitest";
import {
  RETRIEVAL_QUERY_CONCURRENCY,
  settleWithBoundedWorkers,
} from "./bounded-workers";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("bounded retrieval workers", () => {
  it("never exceeds the retrieval cap and returns settlements in input order", async () => {
    const gates = Array.from({ length: 7 }, deferred);
    let active = 0;
    let maximumActive = 0;
    const started: number[] = [];
    const fourthStarted = deferred();
    const work = settleWithBoundedWorkers({
      inputs: gates.map((_, index) => index),
      concurrency: RETRIEVAL_QUERY_CONCURRENCY,
      execute: async (index) => {
        started.push(index);
        if (started.length === 4) fourthStarted.resolve();
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await gates[index]?.promise;
        active -= 1;
        if (index === 4) throw new Error("terminal fixture failure");
        return `result-${index}`;
      },
    });

    await Promise.resolve();
    expect(started).toEqual([0, 1, 2]);
    gates[2]?.resolve();
    await fourthStarted.promise;
    expect(started).toEqual([0, 1, 2, 3]);
    gates[0]?.resolve();
    gates[1]?.resolve();
    for (const gate of gates.slice(3)) gate.resolve();

    const settlements = await work;
    expect(maximumActive).toBe(RETRIEVAL_QUERY_CONCURRENCY);
    expect(settlements.map(({ status }) => status)).toEqual([
      "fulfilled",
      "fulfilled",
      "fulfilled",
      "fulfilled",
      "rejected",
      "fulfilled",
      "fulfilled",
    ]);
    expect(settlements[0]).toEqual({
      status: "fulfilled",
      value: "result-0",
    });
    expect(settlements[4]).toMatchObject({
      status: "rejected",
      reason: new Error("terminal fixture failure"),
    });
  });
});
