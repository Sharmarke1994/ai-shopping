import { createHash } from "node:crypto";
import { z } from "zod";
import {
  contextActionIdSchema,
  contextQuestionOptionIdSchema,
  shoppingTaskIdSchema,
  taskInputIdSchema,
  userMessageIdSchema,
} from "./ids";
import { taskRevisionSchema } from "./task";

export const TASK_INPUT_SCHEMA_VERSION = 1 as const;
export const QUESTION_ANSWER_INPUT_SCHEMA_VERSION = 2 as const;
export const REQUEST_FINGERPRINT_VERSION_V1 = 1 as const;
export const REQUEST_FINGERPRINT_VERSION_V2 = 2 as const;

const rawUserText = z
  .string()
  .min(1)
  .max(10_000)
  .refine((value) => value.trim().length > 0, "Expected non-whitespace text");

export const stableClientIdentifierSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

const inputRequestV1Base = {
  inputSchemaVersion: z.literal(TASK_INPUT_SCHEMA_VERSION),
  expectedRevision: taskRevisionSchema,
};

const taskInputRequestV1Schema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...inputRequestV1Base,
    kind: z.literal("message"),
    body: rawUserText,
  }),
  z.strictObject({
    ...inputRequestV1Base,
    kind: z.literal("question_answer"),
    questionId: stableClientIdentifierSchema,
    optionId: stableClientIdentifierSchema,
    answerText: rawUserText,
  }),
  z.strictObject({
    ...inputRequestV1Base,
    kind: z.literal("direct_brief_action"),
    controlId: stableClientIdentifierSchema,
    submittedText: rawUserText,
  }),
]);

const questionAnswerV2Schema = z.strictObject({
  inputSchemaVersion: z.literal(QUESTION_ANSWER_INPUT_SCHEMA_VERSION),
  expectedRevision: taskRevisionSchema,
  kind: z.literal("question_answer"),
  questionId: contextActionIdSchema,
  answer: z.discriminatedUnion("mode", [
    z.strictObject({
      mode: z.literal("open_text"),
      text: rawUserText,
    }),
    z.strictObject({
      mode: z.literal("single_select"),
      optionId: contextQuestionOptionIdSchema,
    }),
  ]),
});

export const taskInputRequestSchema = z.union([
  taskInputRequestV1Schema,
  questionAnswerV2Schema,
]);

export type TaskInputRequest = z.infer<typeof taskInputRequestSchema>;

const taskInputPayloadV1Schema = z.discriminatedUnion("kind", [
  z.strictObject({
    schemaVersion: z.literal(TASK_INPUT_SCHEMA_VERSION),
    kind: z.literal("message"),
  }),
  z.strictObject({
    schemaVersion: z.literal(TASK_INPUT_SCHEMA_VERSION),
    kind: z.literal("question_answer"),
    questionId: stableClientIdentifierSchema,
    optionId: stableClientIdentifierSchema,
    answerText: rawUserText,
  }),
  z.strictObject({
    schemaVersion: z.literal(TASK_INPUT_SCHEMA_VERSION),
    kind: z.literal("direct_brief_action"),
    controlId: stableClientIdentifierSchema,
    submittedText: rawUserText,
  }),
]);

const questionAnswerPayloadV2Schema = z.strictObject({
  schemaVersion: z.literal(QUESTION_ANSWER_INPUT_SCHEMA_VERSION),
  kind: z.literal("question_answer"),
  questionId: contextActionIdSchema,
  answer: z.discriminatedUnion("mode", [
    z.strictObject({
      mode: z.literal("open_text"),
      text: rawUserText,
    }),
    z.strictObject({
      mode: z.literal("single_select"),
      optionId: contextQuestionOptionIdSchema,
    }),
  ]),
});

export type TaskInputPayload =
  | z.infer<typeof taskInputPayloadV1Schema>
  | z.infer<typeof questionAnswerPayloadV2Schema>;

const taskInputBase = {
  id: taskInputIdSchema,
  taskId: shoppingTaskIdSchema,
  clientActionId: stableClientIdentifierSchema,
  requestFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  expectedRevision: taskRevisionSchema,
  receivedAt: z.date(),
};

export const taskInputSchema = z.discriminatedUnion("inputSchemaVersion", [
  z.strictObject({
    ...taskInputBase,
    inputSchemaVersion: z.literal(TASK_INPUT_SCHEMA_VERSION),
    inputPayload: taskInputPayloadV1Schema,
    fingerprintVersion: z.literal(REQUEST_FINGERPRINT_VERSION_V1),
  }),
  z.strictObject({
    ...taskInputBase,
    inputSchemaVersion: z.literal(QUESTION_ANSWER_INPUT_SCHEMA_VERSION),
    inputPayload: questionAnswerPayloadV2Schema,
    fingerprintVersion: z.literal(REQUEST_FINGERPRINT_VERSION_V2),
  }),
]);

export type TaskInput = z.infer<typeof taskInputSchema>;

export const userMessageSchema = z.strictObject({
  id: userMessageIdSchema,
  taskId: shoppingTaskIdSchema,
  taskInputId: taskInputIdSchema,
  body: rawUserText,
  receivedAtRevision: taskRevisionSchema,
  createdAt: z.date(),
});

export type UserMessage = z.infer<typeof userMessageSchema>;

type CanonicalJson =
  | boolean
  | null
  | number
  | string
  | readonly CanonicalJson[]
  | { readonly [key: string]: CanonicalJson };

function canonicalJson(value: CanonicalJson): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }

  const objectValue = value as { readonly [key: string]: CanonicalJson };
  return `{${Object.keys(objectValue)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${canonicalJson(objectValue[key] ?? null)}`,
    )
    .join(",")}}`;
}

type TaskInputRequestV1 = z.infer<typeof taskInputRequestV1Schema>;
type QuestionAnswerRequestV2 = z.infer<typeof questionAnswerV2Schema>;

function fingerprintEnvelopeV1(request: TaskInputRequestV1): CanonicalJson {
  const common = {
    expectedRevision: request.expectedRevision.toString(),
    fingerprintVersion: REQUEST_FINGERPRINT_VERSION_V1,
    inputSchemaVersion: request.inputSchemaVersion,
    kind: request.kind,
  } as const;

  switch (request.kind) {
    case "message":
      return { ...common, sourceContent: { body: request.body } };
    case "question_answer":
      return {
        ...common,
        sourceContent: {
          answerText: request.answerText,
          optionId: request.optionId,
          questionId: request.questionId,
        },
      };
    case "direct_brief_action":
      return {
        ...common,
        sourceContent: {
          controlId: request.controlId,
          submittedText: request.submittedText,
        },
      };
  }
}

function fingerprintEnvelopeV2(
  request: QuestionAnswerRequestV2,
): CanonicalJson {
  return {
    expectedRevision: request.expectedRevision.toString(),
    fingerprintVersion: REQUEST_FINGERPRINT_VERSION_V2,
    inputSchemaVersion: request.inputSchemaVersion,
    kind: request.kind,
    sourceContent: {
      answer:
        request.answer.mode === "open_text"
          ? { mode: request.answer.mode, text: request.answer.text }
          : {
              mode: request.answer.mode,
              optionId: request.answer.optionId,
            },
      questionId: request.questionId,
    },
  };
}

const fingerprintCanonicalizers = {
  [REQUEST_FINGERPRINT_VERSION_V1]: (request: unknown) =>
    canonicalJson(
      fingerprintEnvelopeV1(taskInputRequestV1Schema.parse(request)),
    ),
  [REQUEST_FINGERPRINT_VERSION_V2]: (request: unknown) =>
    canonicalJson(fingerprintEnvelopeV2(questionAnswerV2Schema.parse(request))),
} as const;

export type RequestFingerprintVersion = keyof typeof fingerprintCanonicalizers;

export function createRequestFingerprint(
  requestInput: unknown,
  version?: RequestFingerprintVersion,
) {
  const request = taskInputRequestSchema.parse(requestInput);
  const selectedVersion = version ?? requestFingerprintVersionFor(request);
  const canonicalizer = fingerprintCanonicalizers[selectedVersion];

  return createHash("sha256")
    .update(canonicalizer(request), "utf8")
    .digest("hex");
}

export function requestMatchesStoredFingerprint(options: {
  request: unknown;
  fingerprintVersion: number;
  requestFingerprint: string;
}) {
  if (!(options.fingerprintVersion in fingerprintCanonicalizers)) {
    return false;
  }

  const version = options.fingerprintVersion as RequestFingerprintVersion;
  try {
    return (
      createRequestFingerprint(options.request, version) ===
      options.requestFingerprint
    );
  } catch {
    return false;
  }
}

export function requestFingerprintVersionFor(
  requestInput: unknown,
): RequestFingerprintVersion {
  const request = taskInputRequestSchema.parse(requestInput);
  return request.inputSchemaVersion === TASK_INPUT_SCHEMA_VERSION
    ? REQUEST_FINGERPRINT_VERSION_V1
    : REQUEST_FINGERPRINT_VERSION_V2;
}

export function toTaskInputPayload(requestInput: unknown): TaskInputPayload {
  const request = taskInputRequestSchema.parse(requestInput);

  switch (request.kind) {
    case "message":
      return { schemaVersion: TASK_INPUT_SCHEMA_VERSION, kind: "message" };
    case "question_answer":
      if (request.inputSchemaVersion === QUESTION_ANSWER_INPUT_SCHEMA_VERSION) {
        return {
          schemaVersion: QUESTION_ANSWER_INPUT_SCHEMA_VERSION,
          kind: "question_answer",
          questionId: request.questionId,
          answer: request.answer,
        };
      }
      return {
        schemaVersion: TASK_INPUT_SCHEMA_VERSION,
        kind: "question_answer",
        questionId: request.questionId,
        optionId: request.optionId,
        answerText: request.answerText,
      };
    case "direct_brief_action":
      return {
        schemaVersion: TASK_INPUT_SCHEMA_VERSION,
        kind: "direct_brief_action",
        controlId: request.controlId,
        submittedText: request.submittedText,
      };
  }
}
