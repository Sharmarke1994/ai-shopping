import { performance } from "node:perf_hooks";
import { z } from "zod";

const durationMsSchema = z.number().int().nonnegative().safe();

export const retrievalTimingSchema = z.strictObject({
  schemaVersion: z.literal(1),
  planningMs: durationMsSchema,
  providerWallMs: durationMsSchema,
  persistenceWallMs: durationMsSchema,
  totalMs: durationMsSchema,
  providerLogicalCallCount: z.number().int().nonnegative(),
  transportAttemptCount: z.null(),
  durationSemantics: z.literal("non_additive_monotonic_wall_intervals"),
  providerCallSemantics: z.literal(
    "logical_provider_port_invocations_transport_attempts_unobserved",
  ),
});

export type RetrievalTiming = z.infer<typeof retrievalTimingSchema>;

type Interval = Readonly<{ startedAt: number; finishedAt: number }>;
type Phase = "planning" | "provider" | "persistence";

function safeClockValue(value: number) {
  return Number.isFinite(value) ? value : 0;
}

function sanitizedDuration(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.round(value)));
}

export function intervalUnionDurationMs(intervals: readonly Interval[]) {
  const ordered = intervals
    .filter(
      ({ startedAt, finishedAt }) =>
        Number.isFinite(startedAt) && Number.isFinite(finishedAt),
    )
    .map(({ startedAt, finishedAt }) => ({
      startedAt,
      finishedAt: Math.max(startedAt, finishedAt),
    }))
    .sort(
      (left, right) =>
        left.startedAt - right.startedAt || left.finishedAt - right.finishedAt,
    );
  const first = ordered[0];
  if (first === undefined) return 0;

  let total = 0;
  let intervalStart = first.startedAt;
  let intervalEnd = first.finishedAt;
  for (const interval of ordered.slice(1)) {
    if (interval.startedAt <= intervalEnd) {
      intervalEnd = Math.max(intervalEnd, interval.finishedAt);
      continue;
    }
    total += intervalEnd - intervalStart;
    intervalStart = interval.startedAt;
    intervalEnd = interval.finishedAt;
  }
  return sanitizedDuration(total + intervalEnd - intervalStart);
}

export function createRetrievalTimingRecorder(
  clock: () => number = () => performance.now(),
) {
  const now = () => safeClockValue(clock());
  const totalStartedAt = now();
  const intervals: Record<Phase, Interval[]> = {
    planning: [],
    provider: [],
    persistence: [],
  };
  let providerLogicalCallCount = 0;

  const measure = async <Value>(
    phase: Phase,
    operation: () => Promise<Value>,
  ) => {
    const startedAt = now();
    try {
      return await operation();
    } finally {
      intervals[phase].push({ startedAt, finishedAt: now() });
    }
  };

  return {
    measurePlanning<Value>(operation: () => Value): Value {
      const startedAt = now();
      try {
        return operation();
      } finally {
        intervals.planning.push({ startedAt, finishedAt: now() });
      }
    },
    measurePersistence<Value>(operation: () => Promise<Value>) {
      return measure("persistence", operation);
    },
    measureProvider<Value>(operation: () => Promise<Value>) {
      providerLogicalCallCount += 1;
      return measure("provider", operation);
    },
    snapshot(): RetrievalTiming {
      return retrievalTimingSchema.parse({
        schemaVersion: 1,
        planningMs: intervalUnionDurationMs(intervals.planning),
        providerWallMs: intervalUnionDurationMs(intervals.provider),
        persistenceWallMs: intervalUnionDurationMs(intervals.persistence),
        totalMs: sanitizedDuration(now() - totalStartedAt),
        providerLogicalCallCount,
        transportAttemptCount: null,
        durationSemantics: "non_additive_monotonic_wall_intervals",
        providerCallSemantics:
          "logical_provider_port_invocations_transport_attempts_unobserved",
      });
    },
  };
}
