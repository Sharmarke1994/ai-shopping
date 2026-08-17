import { createHash } from "node:crypto";
import { z } from "zod";
import { conceptValueFamilySchema } from "./concept-definition";
import {
  InvalidPatchReferenceError,
  StateApplicationIdempotencyConflictError,
} from "./errors";
import {
  conceptDefinitionIdSchema,
  criterionIdSchema,
  shoppingTaskIdSchema,
  stateChangeApplicationIdSchema,
  taskInputIdSchema,
} from "./ids";
import {
  decimalStringSchema,
  measurementUnitSchema,
  semanticValueSchema,
} from "./semantic-value";
import {
  criterionStrengthSchema,
  targetSemanticsSchema,
} from "./decision-criterion";
import { taskRevisionSchema } from "./task";
import { currencyCodeSchema } from "./market-context";

export const STATE_APPLICATION_SCHEMA_VERSION = 1 as const;
export const STATE_APPLICATION_FINGERPRINT_VERSION = 1 as const;

const localRefSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z][a-z0-9_]*$/);

const rawBoundedText = z
  .string()
  .min(1)
  .max(500)
  .refine((value) => value.trim().length > 0, "Expected non-whitespace text");
const rawShortText = z
  .string()
  .min(1)
  .max(120)
  .refine((value) => value.trim().length > 0, "Expected non-whitespace text");

const rawSemanticValueSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    schemaVersion: z.literal(1),
    kind: z.literal("boolean"),
    value: z.boolean(),
  }),
  z.strictObject({
    schemaVersion: z.literal(1),
    kind: z.literal("qualitative"),
    mode: z.enum(["text", "ordinal"]),
    text: rawBoundedText.optional(),
    relation: z.enum(["more", "less", "at_least", "at_most"]).optional(),
    anchor: rawBoundedText.optional(),
  }),
  z.strictObject({
    schemaVersion: z.literal(1),
    kind: z.literal("measurement"),
    amount: decimalStringSchema,
    unit: measurementUnitSchema,
  }),
  z.strictObject({
    schemaVersion: z.literal(1),
    kind: z.literal("measurement_range"),
    lower: z
      .strictObject({ amount: decimalStringSchema, inclusive: z.boolean() })
      .optional(),
    upper: z
      .strictObject({ amount: decimalStringSchema, inclusive: z.boolean() })
      .optional(),
    unit: measurementUnitSchema,
  }),
  z.strictObject({
    schemaVersion: z.literal(1),
    kind: z.literal("money"),
    mode: z.enum(["target", "ceiling"]),
    amountMinor: z.number().int().nonnegative().safe(),
    currency: currencyCodeSchema,
  }),
  z.strictObject({
    schemaVersion: z.literal(1),
    kind: z.literal("money_stretch"),
    targetMinor: z.number().int().nonnegative().safe(),
    stretchCeilingMinor: z.number().int().nonnegative().safe(),
    currency: currencyCodeSchema,
    condition: rawBoundedText,
  }),
  z.strictObject({
    schemaVersion: z.literal(1),
    kind: z.literal("categorical"),
    operator: z.enum(["include", "prefer", "exclude"]),
    values: z.array(rawShortText).min(1).max(50),
  }),
  z.strictObject({
    schemaVersion: z.literal(1),
    kind: z.literal("comparison"),
    relation: z.enum(["more_than", "less_than", "similar_to"]),
    reference: z.strictObject({
      kind: z.literal("candidate_listing"),
      taskId: shoppingTaskIdSchema,
      candidateListingId: z.uuid(),
    }),
  }),
]);

const rawTargetSchema = z.strictObject({
  strength: criterionStrengthSchema,
  targetSemantics: targetSemanticsSchema.exclude(["indifferent"]),
  semanticValue: rawSemanticValueSchema,
});

const conceptRefSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("existing"),
    conceptId: conceptDefinitionIdSchema,
  }),
  z.strictObject({ kind: z.literal("created"), localRef: localRefSchema }),
]);

const createConceptSchema = z.strictObject({
  op: z.literal("create_concept"),
  localRef: localRefSchema,
  label: rawShortText,
  definition: rawBoundedText,
  valueFamily: conceptValueFamilySchema,
  canonicalUnit: measurementUnitSchema.nullable(),
});

const operationSchema = z.discriminatedUnion("op", [
  createConceptSchema,
  z.strictObject({
    op: z.literal("add_criterion"),
    concept: conceptRefSchema,
    target: rawTargetSchema,
  }),
  z.strictObject({
    op: z.literal("replace_target"),
    targetCriterionId: criterionIdSchema,
    result: rawTargetSchema,
  }),
  z.strictObject({
    op: z.literal("relax"),
    targetCriterionId: criterionIdSchema,
    result: rawTargetSchema,
  }),
  z.strictObject({
    op: z.literal("tighten"),
    targetCriterionId: criterionIdSchema,
    result: rawTargetSchema,
  }),
  z.strictObject({
    op: z.literal("remove"),
    targetCriterionId: criterionIdSchema,
  }),
  z.strictObject({
    op: z.literal("mark_indifferent"),
    concept: conceptRefSchema,
    replacesCriterionIds: z.array(criterionIdSchema).max(100),
  }),
]);

const rawPatchSchema = z.discriminatedUnion("outcome", [
  z.strictObject({
    schemaVersion: z.literal(1),
    outcome: z.literal("change"),
    operations: z.array(operationSchema).min(1).max(32),
  }),
  z.strictObject({
    schemaVersion: z.literal(1),
    outcome: z.literal("no_change"),
  }),
]);

const sourcePlanSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("user_explicit"),
    inputId: taskInputIdSchema,
  }),
  z.strictObject({
    kind: z.literal("user_confirmed"),
    originInputId: taskInputIdSchema,
    confirmationInputId: taskInputIdSchema,
  }),
]);

export const rawApplyStatePatchCommandV1Schema = z.strictObject({
  applicationSchemaVersion: z.literal(STATE_APPLICATION_SCHEMA_VERSION),
  applicationKind: z.literal("patch"),
  taskId: shoppingTaskIdSchema,
  expectedRevision: taskRevisionSchema,
  source: sourcePlanSchema,
  patch: rawPatchSchema,
});

export const rawUndoStateChangeCommandV1Schema = z.strictObject({
  applicationSchemaVersion: z.literal(STATE_APPLICATION_SCHEMA_VERSION),
  applicationKind: z.literal("undo"),
  taskId: shoppingTaskIdSchema,
  expectedRevision: taskRevisionSchema,
  source: z.strictObject({
    kind: z.literal("user_explicit"),
    inputId: taskInputIdSchema,
  }),
  targetApplicationId: stateChangeApplicationIdSchema,
});

export type RawApplyStatePatchCommandV1 = z.infer<
  typeof rawApplyStatePatchCommandV1Schema
>;
export type UndoStateChangeCommandV1 = z.infer<
  typeof rawUndoStateChangeCommandV1Schema
>;
export type AuthoritySourcePlanV1 = z.infer<typeof sourcePlanSchema>;
export type PatchOperationV1 = z.infer<typeof operationSchema>;

const canonicalTargetSchema = rawTargetSchema.transform((target) => ({
  ...target,
  semanticValue: semanticValueSchema.parse(target.semanticValue),
}));

const canonicalOperationSchema = operationSchema.transform((operation) => {
  if (operation.op === "create_concept") {
    return {
      ...operation,
      label: operation.label.trim(),
      definition: operation.definition.trim(),
    };
  }
  if (operation.op === "add_criterion") {
    return {
      ...operation,
      target: canonicalTargetSchema.parse(operation.target),
    };
  }
  if (
    operation.op === "replace_target" ||
    operation.op === "relax" ||
    operation.op === "tighten"
  ) {
    return {
      ...operation,
      result: canonicalTargetSchema.parse(operation.result),
    };
  }
  return operation;
});

export type CanonicalPatchOperationV1 = z.output<
  typeof canonicalOperationSchema
>;
export type ParsedStateApplicationCommandV1 =
  | (Omit<RawApplyStatePatchCommandV1, "patch"> & {
      patch:
        | { schemaVersion: 1; outcome: "no_change" }
        | {
            schemaVersion: 1;
            outcome: "change";
            operations: CanonicalPatchOperationV1[];
          };
    })
  | UndoStateChangeCommandV1;

function validatePatchDependencies(command: RawApplyStatePatchCommandV1) {
  if (
    command.source.kind === "user_confirmed" &&
    command.source.originInputId === command.source.confirmationInputId
  ) {
    throw new InvalidPatchReferenceError(
      "Origin and confirmation inputs must be distinct",
    );
  }
  if (command.patch.outcome === "no_change") return;
  const created = new Set<string>();
  const consumed = new Set<string>();
  for (const operation of command.patch.operations) {
    if (operation.op === "create_concept") {
      if (created.has(operation.localRef))
        throw new InvalidPatchReferenceError(
          `Duplicate local concept ref ${operation.localRef}`,
        );
      created.add(operation.localRef);
      continue;
    }
    if (
      (operation.op === "add_criterion" ||
        operation.op === "mark_indifferent") &&
      operation.concept.kind === "created"
    ) {
      if (!created.has(operation.concept.localRef))
        throw new InvalidPatchReferenceError(
          `Missing or forward local concept ref ${operation.concept.localRef}`,
        );
      consumed.add(operation.concept.localRef);
    }
    if (operation.op === "mark_indifferent") {
      const sorted = [...operation.replacesCriterionIds].sort();
      if (
        new Set(sorted).size !== sorted.length ||
        sorted.some((id, index) => id !== operation.replacesCriterionIds[index])
      ) {
        throw new InvalidPatchReferenceError(
          "replacesCriterionIds must be unique and lexicographically sorted",
        );
      }
    }
  }
  for (const localRef of created) {
    if (!consumed.has(localRef))
      throw new InvalidPatchReferenceError(
        `Unused local concept ref ${localRef}`,
      );
  }
}

export function parseStateApplicationCommand(input: unknown): {
  raw: RawApplyStatePatchCommandV1 | UndoStateChangeCommandV1;
  command: ParsedStateApplicationCommandV1;
  causalInputId: z.infer<typeof taskInputIdSchema>;
  fingerprint: string;
} {
  const kind = z
    .object({ applicationKind: z.enum(["patch", "undo"]) })
    .parse(input).applicationKind;
  const raw =
    kind === "patch"
      ? rawApplyStatePatchCommandV1Schema.parse(input)
      : rawUndoStateChangeCommandV1Schema.parse(input);
  if (raw.applicationKind === "patch") validatePatchDependencies(raw);
  const command: ParsedStateApplicationCommandV1 =
    raw.applicationKind === "undo"
      ? raw
      : {
          ...raw,
          patch:
            raw.patch.outcome === "no_change"
              ? raw.patch
              : {
                  ...raw.patch,
                  operations: raw.patch.operations.map((operation) =>
                    canonicalOperationSchema.parse(operation),
                  ),
                },
        };
  const causalInputId =
    raw.source.kind === "user_explicit"
      ? raw.source.inputId
      : raw.source.confirmationInputId;
  return {
    raw,
    command,
    causalInputId,
    fingerprint: createStateApplicationFingerprint(raw),
  };
}

type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };
function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, JsonValue>;
  return `{${Object.keys(record)
    .sort()
    .map(
      (key) => `${JSON.stringify(key)}:${canonicalJson(record[key] ?? null)}`,
    )
    .join(",")}}`;
}
function toFingerprintJson(value: unknown): JsonValue {
  if (typeof value === "bigint") return value.toString();
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  )
    return value;
  if (Array.isArray(value)) return value.map(toFingerprintJson);
  if (typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        toFingerprintJson(entry),
      ]),
    );
  throw new TypeError("Unsupported fingerprint value");
}

export function createStateApplicationFingerprint(
  input: unknown,
  version = STATE_APPLICATION_FINGERPRINT_VERSION,
) {
  if (version !== 1)
    throw new StateApplicationIdempotencyConflictError(
      "unknown-fingerprint-version",
    );
  const raw = z
    .union([
      rawApplyStatePatchCommandV1Schema,
      rawUndoStateChangeCommandV1Schema,
    ])
    .parse(input);
  const fingerprinted = Object.fromEntries(
    Object.entries(raw).filter(([key]) => key !== "taskId"),
  );
  return createHash("sha256")
    .update(canonicalJson(toFingerprintJson(fingerprinted)), "utf8")
    .digest("hex");
}
