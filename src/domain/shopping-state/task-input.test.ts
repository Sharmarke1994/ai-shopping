import { describe, expect, it } from "vitest";
import {
  REQUEST_FINGERPRINT_VERSION,
  createRequestFingerprint,
  requestMatchesStoredFingerprint,
  taskInputRequestSchema,
  toTaskInputPayload,
} from "./task-input";

const messageRequest = {
  inputSchemaVersion: 1,
  expectedRevision: 4n,
  kind: "message",
  body: "I would rather avoid white",
} as const;

describe("task input identity", () => {
  it("preserves user text exactly at the fingerprint boundary", () => {
    const parsedRequest = taskInputRequestSchema.parse(messageRequest);
    if (parsedRequest.kind !== "message") {
      throw new Error("Expected the message request variant");
    }
    expect(parsedRequest.body).toBe(messageRequest.body);
    expect(
      createRequestFingerprint({
        ...messageRequest,
        body: ` ${messageRequest.body}`,
      }),
    ).not.toBe(createRequestFingerprint(messageRequest));
    expect(
      createRequestFingerprint({ ...messageRequest, body: "WHITE" }),
    ).not.toBe(createRequestFingerprint({ ...messageRequest, body: "white" }));
  });

  it("canonicalises structure independently of object insertion order", () => {
    const reorderedRequest = {
      body: messageRequest.body,
      kind: messageRequest.kind,
      expectedRevision: messageRequest.expectedRevision,
      inputSchemaVersion: messageRequest.inputSchemaVersion,
    };

    expect(createRequestFingerprint(reorderedRequest)).toBe(
      createRequestFingerprint(messageRequest),
    );
  });

  it("matches retries with the stored fingerprint version", () => {
    const requestFingerprint = createRequestFingerprint(messageRequest);

    expect(
      requestMatchesStoredFingerprint({
        request: messageRequest,
        fingerprintVersion: REQUEST_FINGERPRINT_VERSION,
        requestFingerprint,
      }),
    ).toBe(true);
    expect(
      requestMatchesStoredFingerprint({
        request: messageRequest,
        fingerprintVersion: 999,
        requestFingerprint,
      }),
    ).toBe(false);
  });

  it("does not duplicate a user message body in the input payload", () => {
    expect(toTaskInputPayload(messageRequest)).toEqual({
      schemaVersion: 1,
      kind: "message",
    });
  });

  it("retains a typed question-answer source snapshot", () => {
    expect(
      toTaskInputPayload({
        inputSchemaVersion: 1,
        expectedRevision: 2n,
        kind: "question_answer",
        questionId: "comfort-priority",
        optionId: "glasses-comfort",
        answerText: "Comfort with glasses matters more",
      }),
    ).toEqual({
      schemaVersion: 1,
      kind: "question_answer",
      questionId: "comfort-priority",
      optionId: "glasses-comfort",
      answerText: "Comfort with glasses matters more",
    });
  });
});
