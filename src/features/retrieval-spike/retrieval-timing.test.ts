import { describe, expect, it } from "vitest";
import {
  createRetrievalTimingRecorder,
  intervalUnionDurationMs,
} from "./retrieval-timing";

describe("retrieval timing", () => {
  it("reports sanitized non-additive wall intervals and honest call semantics", async () => {
    let now = 10;
    const timing = createRetrievalTimingRecorder(() => now);
    timing.measurePlanning(() => {
      now = 12.4;
    });
    await timing.measurePersistence(async () => {
      now = 16.2;
    });
    await timing.measureProvider(async () => {
      now = 23.1;
    });
    now = 25.2;

    expect(timing.snapshot()).toEqual({
      schemaVersion: 1,
      planningMs: 2,
      providerWallMs: 7,
      persistenceWallMs: 4,
      totalMs: 15,
      providerLogicalCallCount: 1,
      transportAttemptCount: null,
      durationSemantics: "non_additive_monotonic_wall_intervals",
      providerCallSemantics:
        "logical_provider_port_invocations_transport_attempts_unobserved",
    });
  });

  it("counts overlapping work once and clamps backwards or invalid intervals", () => {
    expect(
      intervalUnionDurationMs([
        { startedAt: 0, finishedAt: 10 },
        { startedAt: 2, finishedAt: 5 },
        { startedAt: 8, finishedAt: 13 },
        { startedAt: 20, finishedAt: 19 },
        { startedAt: Number.NaN, finishedAt: 100 },
      ]),
    ).toBe(13);
  });
});
