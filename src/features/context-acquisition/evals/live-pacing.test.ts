import { describe, expect, it } from "vitest";
import type { ContextAcquisitionModel, ModelCallMetadata } from "../model-port";
import { withMinimumCompletedCallInterval } from "./live-pacing";

const metadata: ModelCallMetadata = {
  provider: "test",
  model: "test-model",
  promptVersion: "test-prompt",
  providerSchemaVersion: 1,
  providerRequestId: null,
  durationMs: 0,
  inputTokens: null,
  outputTokens: null,
};

describe("V0-05 live-eval pacing", () => {
  it("paces from completion so an internal retry cannot crowd the next stage", async () => {
    let now = 0;
    const starts: number[] = [];
    const waits: number[] = [];
    const failed = {
      status: "provider_failed" as const,
      errorCode: "test_failure",
      metadata,
    };
    const model: ContextAcquisitionModel = {
      interpret: async () => {
        starts.push(now);
        now += 30_000;
        return failed;
      },
      selectAction: async () => {
        starts.push(now);
        return failed;
      },
    };
    const paced = withMinimumCompletedCallInterval(model, 35_000, {
      now: () => now,
      wait: async (milliseconds) => {
        waits.push(milliseconds);
        now += milliseconds;
      },
    });

    await paced.interpret({ providerInputSchemaVersion: 1, payload: {} });
    await paced.selectAction({ providerInputSchemaVersion: 1, payload: {} });

    expect(waits).toEqual([35_000]);
    expect(starts).toEqual([0, 65_000]);
  });

  it("serializes concurrent calls through the same pacing boundary", async () => {
    let now = 0;
    const starts: number[] = [];
    const failed = {
      status: "provider_failed" as const,
      errorCode: "test_failure",
      metadata,
    };
    const model: ContextAcquisitionModel = {
      interpret: async () => {
        starts.push(now);
        return failed;
      },
      selectAction: async () => {
        starts.push(now);
        return failed;
      },
    };
    const paced = withMinimumCompletedCallInterval(model, 35_000, {
      now: () => now,
      wait: async (milliseconds) => {
        now += milliseconds;
      },
    });

    await Promise.all([
      paced.interpret({ providerInputSchemaVersion: 1, payload: {} }),
      paced.selectAction({ providerInputSchemaVersion: 1, payload: {} }),
    ]);

    expect(starts).toEqual([0, 35_000]);
  });
});
