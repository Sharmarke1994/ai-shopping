import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  liveShoppingMutationSchema,
  liveShoppingViewSchema,
} from "./contracts";

describe("live shopping browser contract", () => {
  it("accepts client retry keys and shopper content only", () => {
    const parsed = liveShoppingMutationSchema.parse({
      operation: "answer",
      sessionId: "4318c9d8-2460-4cc2-9861-91dcf681a23e",
      turnId: "7d307e5f-cd17-464d-b21c-f4c85c431a83",
      answer: { mode: "single_select", optionOrdinal: 1 },
    });
    expect(parsed.operation).toBe("answer");
    if (parsed.operation !== "answer") throw new Error("Expected answer");
    expect(parsed.answer).toEqual({
      mode: "single_select",
      optionOrdinal: 1,
    });
  });

  it("accepts bounded same-task refinement and task-scoped listing operations", () => {
    expect(
      liveShoppingMutationSchema.parse({
        operation: "refine",
        sessionId: "4318c9d8-2460-4cc2-9861-91dcf681a23e",
        turnId: "7d307e5f-cd17-464d-b21c-f4c85c431a83",
        message: "Make waterproofing important too",
      }),
    ).toMatchObject({ operation: "refine" });
    expect(
      liveShoppingMutationSchema.parse({
        operation: "save_listing",
        sessionId: "4318c9d8-2460-4cc2-9861-91dcf681a23e",
        candidateListingId: "8a0e451f-0471-4693-81d2-761c19a6ea7d",
      }),
    ).toMatchObject({ operation: "save_listing" });
    expect(
      liveShoppingMutationSchema.parse({
        operation: "reject_listing",
        sessionId: "4318c9d8-2460-4cc2-9861-91dcf681a23e",
        candidateListingId: "8a0e451f-0471-4693-81d2-761c19a6ea7d",
      }),
    ).toMatchObject({ operation: "reject_listing" });
    expect(
      liveShoppingMutationSchema.parse({
        operation: "research_candidate",
        sessionId: "4318c9d8-2460-4cc2-9861-91dcf681a23e",
        candidateListingId: "8a0e451f-0471-4693-81d2-761c19a6ea7d",
      }),
    ).toMatchObject({ operation: "research_candidate" });
  });

  it("accepts one exact optional criterion target for candidate research", () => {
    expect(
      liveShoppingMutationSchema.parse({
        operation: "research_candidate",
        sessionId: "4318c9d8-2460-4cc2-9861-91dcf681a23e",
        candidateListingId: "8a0e451f-0471-4693-81d2-761c19a6ea7d",
        criterionId: "70b74650-a485-4aeb-a507-0ca9b448f64f",
      }),
    ).toEqual({
      operation: "research_candidate",
      sessionId: "4318c9d8-2460-4cc2-9861-91dcf681a23e",
      candidateListingId: "8a0e451f-0471-4693-81d2-761c19a6ea7d",
      criterionId: "70b74650-a485-4aeb-a507-0ca9b448f64f",
    });

    expect(() =>
      liveShoppingMutationSchema.parse({
        operation: "research_candidate",
        sessionId: "4318c9d8-2460-4cc2-9861-91dcf681a23e",
        candidateListingId: "8a0e451f-0471-4693-81d2-761c19a6ea7d",
        criterionId: "not-a-criterion-id",
      }),
    ).toThrow();
  });

  it.each([
    "revision",
    "researchRunId",
    "policyGeneration",
    "sourceUrl",
    "targetCriterionId",
  ])("rejects client-selected research authority field %s", (field) => {
    expect(() =>
      liveShoppingMutationSchema.parse({
        operation: "research_candidate",
        sessionId: "4318c9d8-2460-4cc2-9861-91dcf681a23e",
        candidateListingId: "8a0e451f-0471-4693-81d2-761c19a6ea7d",
        criterionId: "70b74650-a485-4aeb-a507-0ca9b448f64f",
        [field]: "client-chosen",
      }),
    ).toThrow();
  });

  it.each([
    "taskId",
    "revision",
    "contextActionId",
    "questionId",
    "optionId",
    "runId",
  ])("rejects client-selected authoritative field %s", (field) => {
    expect(() =>
      liveShoppingMutationSchema.parse({
        operation: "answer",
        sessionId: "4318c9d8-2460-4cc2-9861-91dcf681a23e",
        turnId: "7d307e5f-cd17-464d-b21c-f4c85c431a83",
        answer: { mode: "single_select", optionOrdinal: 1 },
        [field]: "client-chosen",
      }),
    ).toThrow();
  });

  it("keeps Serper credential names out of the client module boundary", async () => {
    const clientSources = await Promise.all([
      readFile("src/features/live-shopping/live-shopping.tsx", "utf8"),
      readFile("src/features/live-shopping/contracts.ts", "utf8"),
    ]);
    expect(clientSources.join("\n")).not.toMatch(
      /SERPER_API_KEY|ai-shopping-serper|SerperShoppingAdapter/,
    );
  });

  it("does not expose the authoritative state revision in the browser view", () => {
    const valid = {
      schemaVersion: 1 as const,
      sessionId: "4318c9d8-2460-4cc2-9861-91dcf681a23e",
      viewEpoch: "a".repeat(24),
      subject: "A breathable running cap",
      brief: [],
      savedListings: [],
      rejectedListings: [],
      decisionSupport: null,
      action: {
        kind: "understanding_failed" as const,
        notice: "Safe to retry",
        retryable: true as const,
      },
    };
    expect(liveShoppingViewSchema.parse(valid).viewEpoch).toHaveLength(24);
    expect(() =>
      liveShoppingViewSchema.parse({
        ...valid,
        revision: "1",
      }),
    ).toThrow();
  });
});
