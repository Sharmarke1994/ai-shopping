import { PersistedDataCorruptionError } from "../../../domain/shopping-state/errors";
import {
  type ConceptDefinition,
  conceptDefinitionSchema,
} from "../../../domain/shopping-state/concept-definition";
import {
  type CriterionSource,
  type DecisionCriterion,
  criterionSourceSchema,
  decisionCriterionSchema,
} from "../../../domain/shopping-state/decision-criterion";
import {
  type TaskInput,
  type UserMessage,
  taskInputSchema,
  userMessageSchema,
} from "../../../domain/shopping-state/task-input";
import {
  type ShoppingTask,
  shoppingTaskSchema,
} from "../../../domain/shopping-state/task";

function parsePersisted<T>(options: {
  recordType: string;
  recordId: string;
  parse: () => T;
}) {
  try {
    return options.parse();
  } catch (cause) {
    throw new PersistedDataCorruptionError({
      recordType: options.recordType,
      recordId: options.recordId,
      cause,
    });
  }
}

export function mapShoppingTask(row: {
  id: string;
  currentRevision: bigint;
  marketCountry: string;
  languageTag: string;
  currencyCode: string;
  createdAt: Date;
  updatedAt: Date;
}): ShoppingTask {
  return parsePersisted({
    recordType: "ShoppingTask",
    recordId: row.id,
    parse: () =>
      shoppingTaskSchema.parse({
        id: row.id,
        currentRevision: row.currentRevision,
        market: {
          country: row.marketCountry,
          language: row.languageTag,
          currency: row.currencyCode,
        },
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }),
  });
}

export function mapTaskInput(row: {
  id: string;
  taskId: string;
  clientActionId: string;
  inputSchemaVersion: number;
  inputPayload: unknown;
  fingerprintVersion: number;
  requestFingerprint: string;
  expectedRevision: bigint;
  receivedAt: Date;
}): TaskInput {
  return parsePersisted({
    recordType: "TaskInput",
    recordId: row.id,
    parse: () =>
      taskInputSchema.parse({
        id: row.id,
        taskId: row.taskId,
        clientActionId: row.clientActionId,
        inputSchemaVersion: row.inputSchemaVersion,
        inputPayload: row.inputPayload,
        fingerprintVersion: row.fingerprintVersion,
        requestFingerprint: row.requestFingerprint,
        expectedRevision: row.expectedRevision,
        receivedAt: row.receivedAt,
      }),
  });
}

export function mapUserMessage(row: {
  id: string;
  taskId: string;
  taskInputId: string;
  body: string;
  receivedAtRevision: bigint;
  createdAt: Date;
}): UserMessage {
  return parsePersisted({
    recordType: "UserMessage",
    recordId: row.id,
    parse: () => userMessageSchema.parse(row),
  });
}

export function mapConceptDefinition(row: {
  id: string;
  taskId: string;
  label: string;
  definition: string;
  valueFamily: string;
  canonicalUnit: string | null;
  createdRevision: bigint;
  createdAt: Date;
}): ConceptDefinition {
  return parsePersisted({
    recordType: "ConceptDefinition",
    recordId: row.id,
    parse: () => conceptDefinitionSchema.parse(row),
  });
}

export function mapDecisionCriterion(row: {
  id: string;
  taskId: string;
  lineageId: string;
  conceptId: string;
  authority: string;
  strength: string | null;
  targetSemantics: string;
  valueSchemaVersion: number;
  valueKind: string;
  semanticValue: unknown;
  lifecycle: string;
  createdRevision: bigint;
  endedRevision: bigint | null;
  supersededById: string | null;
  createdAt: Date;
  updatedAt: Date;
}): DecisionCriterion {
  return parsePersisted({
    recordType: "DecisionCriterion",
    recordId: row.id,
    parse: () => decisionCriterionSchema.parse(row),
  });
}

export function mapCriterionSource(row: {
  id: string;
  taskId: string;
  criterionId: string;
  sourceRole: string;
  sourceKind: string;
  taskInputId: string;
  messageId: string | null;
  createdAt: Date;
}): CriterionSource {
  return parsePersisted({
    recordType: "CriterionSource",
    recordId: row.id,
    parse: () => criterionSourceSchema.parse(row),
  });
}
