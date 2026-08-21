import type { ContextAcquisitionModel } from "../model-port";

type LiveEvalTiming = Readonly<{
  now: () => number;
  wait: (milliseconds: number) => Promise<void>;
}>;

const realTiming: LiveEvalTiming = {
  now: Date.now,
  wait: (milliseconds) =>
    new Promise<void>((resolveWait) => setTimeout(resolveWait, milliseconds)),
};

export function withMinimumCompletedCallInterval(
  model: ContextAcquisitionModel,
  intervalMs: number,
  timing: LiveEvalTiming = realTiming,
): ContextAcquisitionModel {
  if (!Number.isFinite(intervalMs) || intervalMs < 0)
    throw new RangeError("Live-eval model-call interval must be non-negative");
  let previousCallCompletedAt = Number.NEGATIVE_INFINITY;
  let queue: Promise<void> = Promise.resolve();
  const pace = <T>(call: () => Promise<T>) => {
    const result = queue.then(async () => {
      const waitMs = Math.max(
        0,
        previousCallCompletedAt + intervalMs - timing.now(),
      );
      if (waitMs > 0) await timing.wait(waitMs);
      try {
        return await call();
      } finally {
        previousCallCompletedAt = timing.now();
      }
    });
    queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
  return {
    interpret: (input) => pace(() => model.interpret(input)),
    selectAction: (input) => pace(() => model.selectAction(input)),
  };
}
