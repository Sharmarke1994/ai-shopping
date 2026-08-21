import { describe, expect, it } from "vitest";
import {
  REQUEST_FINGERPRINT_VERSION_V1,
  REQUEST_FINGERPRINT_VERSION_V2,
  createRequestFingerprint,
  requestMatchesStoredFingerprint,
  requestFingerprintVersionFor,
  taskInputRequestSchema,
  toTaskInputPayload,
} from "./task-input";

const messageRequest = {
  inputSchemaVersion: 1,
  expectedRevision: 4n,
  kind: "message",
  body: "I would rather avoid white",
} as const;

const questionId = "11111111-1111-4111-8111-111111111111";
const optionId = "22222222-2222-4222-8222-222222222222";

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

    expect(requestFingerprintVersionFor(messageRequest)).toBe(
      REQUEST_FINGERPRINT_VERSION_V1,
    );
    expect(
      requestMatchesStoredFingerprint({
        request: messageRequest,
        fingerprintVersion: REQUEST_FINGERPRINT_VERSION_V1,
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

  it("preserves the exact historical V1 canonical fingerprints", () => {
    expect(createRequestFingerprint(messageRequest)).toBe(
      "fc84dbf61309468f68b6b82bceaae04589e257d6ab048102b91544ed16559ab6",
    );
    expect(
      createRequestFingerprint({
        inputSchemaVersion: 1,
        expectedRevision: 2n,
        kind: "question_answer",
        questionId: "comfort-priority",
        optionId: "glasses-comfort",
        answerText: "Comfort with glasses matters more",
      }),
    ).toBe("5d123fd8151366558f97be1221d112d13b058c2e0a6791ef7f780d947a755cf9");
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

  it("preserves exact V2 open text without an invented option", () => {
    const request = {
      inputSchemaVersion: 2,
      expectedRevision: 5n,
      kind: "question_answer",
      questionId,
      answer: {
        mode: "open_text",
        text: "  It has to fit under my desk.  ",
      },
    } as const;

    expect(taskInputRequestSchema.parse(request)).toEqual(request);
    expect(requestFingerprintVersionFor(request)).toBe(
      REQUEST_FINGERPRINT_VERSION_V2,
    );
    expect(toTaskInputPayload(request)).toEqual({
      schemaVersion: 2,
      kind: "question_answer",
      questionId,
      answer: {
        mode: "open_text",
        text: "  It has to fit under my desk.  ",
      },
    });
  });

  it("preserves a V2 single selection without client semantic text", () => {
    const request = {
      inputSchemaVersion: 2,
      expectedRevision: 5n,
      kind: "question_answer",
      questionId,
      answer: { mode: "single_select", optionId },
    } as const;

    expect(taskInputRequestSchema.parse(request)).toEqual(request);
    expect(toTaskInputPayload(request)).toEqual({
      schemaVersion: 2,
      kind: "question_answer",
      questionId,
      answer: { mode: "single_select", optionId },
    });
    expect(() =>
      taskInputRequestSchema.parse({
        ...request,
        answerText: "A client-authored hidden meaning",
      }),
    ).toThrow();
  });

  it("keeps V1 and V2 fingerprint canonicalizers version-bound", () => {
    const request = {
      inputSchemaVersion: 2,
      expectedRevision: 5n,
      kind: "question_answer",
      questionId,
      answer: { mode: "single_select", optionId },
    } as const;
    const fingerprint = createRequestFingerprint(request);

    expect(
      requestMatchesStoredFingerprint({
        request,
        fingerprintVersion: REQUEST_FINGERPRINT_VERSION_V2,
        requestFingerprint: fingerprint,
      }),
    ).toBe(true);
    expect(
      requestMatchesStoredFingerprint({
        request,
        fingerprintVersion: REQUEST_FINGERPRINT_VERSION_V1,
        requestFingerprint: fingerprint,
      }),
    ).toBe(false);
  });
});
