import { createHash } from "node:crypto";
import { z } from "zod";
import {
  shoppingTaskIdSchema,
  taskInputIdSchema,
  userMessageIdSchema,
} from "./ids";
import { taskRevisionSchema } from "./task";

export const TASK_INPUT_SCHEMA_VERSION = 1 as const;
export const REQUEST_FINGERPRINT_VERSION = 1 as const;

const rawUserText = z
  .string()
  .min(1)
  .max(10_000)
  .refine((value) => value.trim().length > 0, "Expected non-whitespace text");

const stableClientIdentifier = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

const inputRequestBase = {
  inputSchemaVersion: z.literal(TASK_INPUT_SCHEMA_VERSION),
  expectedRevision: taskRevisionSchema,
};

export const taskInputRequestSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...inputRequestBase,
    kind: z.literal("message"),
    body: rawUserText,
  }),
  z.strictObject({
    ...inputRequestBase,
    kind: z.literal("question_answer"),
    questionId: stableClientIdentifier,
    optionId: stableClientIdentifier,
    answerText: rawUserText,
  }),
  z.strictObject({
    ...inputRequestBase,
    kind: z.literal("direct_brief_action"),
    controlId: stableClientIdentifier,
    submittedText: rawUserText,
  }),
]);

export type TaskInputRequest = z.infer<typeof taskInputRequestSchema>;

const taskInputPayloadSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    schemaVersion: z.literal(TASK_INPUT_SCHEMA_VERSION),
    kind: z.literal("message"),
  }),
  z.strictObject({
    schemaVersion: z.literal(TASK_INPUT_SCHEMA_VERSION),
    kind: z.literal("question_answer"),
    questionId: stableClientIdentifier,
    optionId: stableClientIdentifier,
    answerText: rawUserText,
  }),
  z.strictObject({
    schemaVersion: z.literal(TASK_INPUT_SCHEMA_VERSION),
    kind: z.literal("direct_brief_action"),
    controlId: stableClientIdentifier,
    submittedText: rawUserText,
  }),
]);

export type TaskInputPayload = z.infer<typeof taskInputPayloadSchema>;

export const taskInputSchema = z.strictObject({
  id: taskInputIdSchema,
  taskId: shoppingTaskIdSchema,
  clientActionId: stableClientIdentifier,
  inputSchemaVersion: z.literal(TASK_INPUT_SCHEMA_VERSION),
  inputPayload: taskInputPayloadSchema,
  fingerprintVersion: z.literal(REQUEST_FINGERPRINT_VERSION),
  requestFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  expectedRevision: taskRevisionSchema,
  receivedAt: z.date(),
});

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

function fingerprintEnvelopeV1(request: TaskInputRequest): CanonicalJson {
  const common = {
    expectedRevision: request.expectedRevision.toString(),
    fingerprintVersion: REQUEST_FINGERPRINT_VERSION,
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

const fingerprintCanonicalizers = {
  [REQUEST_FINGERPRINT_VERSION]: (request: TaskInputRequest) =>
    canonicalJson(fingerprintEnvelopeV1(request)),
} as const;

export type RequestFingerprintVersion = keyof typeof fingerprintCanonicalizers;

export function createRequestFingerprint(
  requestInput: unknown,
  version: RequestFingerprintVersion = REQUEST_FINGERPRINT_VERSION,
) {
  const request = taskInputRequestSchema.parse(requestInput);
  const canonicalizer = fingerprintCanonicalizers[version];

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
  return (
    createRequestFingerprint(options.request, version) ===
    options.requestFingerprint
  );
}

export function toTaskInputPayload(requestInput: unknown): TaskInputPayload {
  const request = taskInputRequestSchema.parse(requestInput);

  switch (request.kind) {
    case "message":
      return { schemaVersion: TASK_INPUT_SCHEMA_VERSION, kind: "message" };
    case "question_answer":
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
