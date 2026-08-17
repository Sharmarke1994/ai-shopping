import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { conceptValueFamilySchema } from "./concept-definition";
import {
  criterionAuthoritySchema,
  criterionLifecycleSchema,
  criterionStrengthSchema,
  decisionCriterionSchema,
  targetSemanticsSchema,
  type DecisionCriterion,
} from "./decision-criterion";
import {
  conceptDefinitionIdSchema,
  criterionIdSchema,
  criterionLineageIdSchema,
  shoppingTaskIdSchema,
  stateChangeApplicationIdSchema,
  taskInputIdSchema,
} from "./ids";
import { measurementUnitSchema, semanticValueSchema } from "./semantic-value";
import { taskRevisionSchema } from "./task";

export const APPLIED_STATE_DELTA_SCHEMA_VERSION = 1 as const;

const revisionStringSchema = z.string().regex(/^(?:0|[1-9]\d*)$/);

export const criterionSnapshotV1Schema = z
  .strictObject({
    id: criterionIdSchema,
    lineageId: criterionLineageIdSchema,
    conceptId: conceptDefinitionIdSchema,
    authority: criterionAuthoritySchema,
    strength: criterionStrengthSchema.nullable(),
    targetSemantics: targetSemanticsSchema,
    valueSchemaVersion: z.literal(1),
    valueKind: z.enum([
      "boolean",
      "qualitative",
      "measurement",
      "measurement_range",
      "money",
      "money_stretch",
      "categorical",
      "comparison",
      "indifferent",
    ]),
    semanticValue: semanticValueSchema,
    lifecycle: criterionLifecycleSchema,
    createdRevision: revisionStringSchema,
    endedRevision: revisionStringSchema.nullable(),
    supersededById: criterionIdSchema.nullable(),
  })
  .superRefine((snapshot, context) => {
    if (snapshot.valueKind !== snapshot.semanticValue.kind) {
      context.addIssue({
        code: "custom",
        message: "Snapshot value discriminators must match",
      });
    }
    const indifferent = snapshot.semanticValue.kind === "indifferent";
    const hasIndifferentDimensions =
      snapshot.targetSemantics === "indifferent" && snapshot.strength === null;
    const hasOrdinaryDimensions =
      snapshot.targetSemantics !== "indifferent" && snapshot.strength !== null;
    if (
      (indifferent && !hasIndifferentDimensions) ||
      (!indifferent && !hasOrdinaryDimensions)
    ) {
      context.addIssue({
        code: "custom",
        message: "Snapshot indifference dimensions must agree",
      });
    }
    if (
      (snapshot.lifecycle === "active" &&
        (snapshot.endedRevision !== null ||
          snapshot.supersededById !== null)) ||
      (snapshot.lifecycle === "removed" &&
        (snapshot.endedRevision === null ||
          snapshot.supersededById !== null)) ||
      (snapshot.lifecycle === "superseded" &&
        (snapshot.endedRevision === null || snapshot.supersededById === null))
    ) {
      context.addIssue({
        code: "custom",
        message: "Snapshot lifecycle fields must agree",
      });
    }
  });

export type CriterionSnapshotV1 = z.infer<typeof criterionSnapshotV1Schema>;

const conceptSnapshotSchema = z
  .strictObject({
    id: conceptDefinitionIdSchema,
    label: z.string().trim().min(1).max(120),
    definition: z.string().trim().min(1).max(500),
    valueFamily: conceptValueFamilySchema,
    canonicalUnit: measurementUnitSchema.nullable(),
    createdRevision: revisionStringSchema,
  })
  .superRefine((concept, context) => {
    if (
      (concept.valueFamily === "measurement") !==
      (concept.canonicalUnit !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Only measurement concept snapshots have a canonical unit",
      });
    }
  });

const replacementEntryBase = {
  before: criterionSnapshotV1Schema,
  ended: criterionSnapshotV1Schema,
  after: criterionSnapshotV1Schema,
};

const appliedDeltaEntryV1Schema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("concept_created"),
    concept: conceptSnapshotSchema,
  }),
  z.strictObject({
    kind: z.literal("criterion_added"),
    after: criterionSnapshotV1Schema,
  }),
  z.strictObject({
    kind: z.literal("criterion_replaced"),
    ...replacementEntryBase,
  }),
  z.strictObject({
    kind: z.literal("criterion_relaxed"),
    ...replacementEntryBase,
  }),
  z.strictObject({
    kind: z.literal("criterion_tightened"),
    ...replacementEntryBase,
  }),
  z.strictObject({
    kind: z.literal("criterion_removed"),
    before: criterionSnapshotV1Schema,
    after: criterionSnapshotV1Schema,
  }),
  z.strictObject({
    kind: z.literal("concept_marked_indifferent"),
    conceptId: conceptDefinitionIdSchema,
    before: z.array(criterionSnapshotV1Schema),
    ended: z.array(criterionSnapshotV1Schema),
    after: criterionSnapshotV1Schema,
  }),
  z.strictObject({
    kind: z.literal("criterion_restored_by_undo"),
    targetApplicationId: stateChangeApplicationIdSchema,
    restoredFrom: criterionSnapshotV1Schema,
    after: criterionSnapshotV1Schema,
  }),
  z.strictObject({
    kind: z.literal("criterion_ended_by_undo"),
    targetApplicationId: stateChangeApplicationIdSchema,
    before: criterionSnapshotV1Schema,
    after: criterionSnapshotV1Schema,
  }),
]);

function sameVersionIdentity(
  left: CriterionSnapshotV1,
  right: CriterionSnapshotV1,
) {
  return (
    left.id === right.id &&
    left.lineageId === right.lineageId &&
    left.conceptId === right.conceptId &&
    left.authority === right.authority &&
    left.strength === right.strength &&
    left.targetSemantics === right.targetSemantics &&
    left.valueSchemaVersion === right.valueSchemaVersion &&
    left.valueKind === right.valueKind &&
    isDeepStrictEqual(left.semanticValue, right.semanticValue) &&
    left.createdRevision === right.createdRevision
  );
}

function sameRecordedMeaning(
  left: CriterionSnapshotV1,
  right: CriterionSnapshotV1,
) {
  return (
    left.lineageId === right.lineageId &&
    left.conceptId === right.conceptId &&
    left.strength === right.strength &&
    left.targetSemantics === right.targetSemantics &&
    left.valueSchemaVersion === right.valueSchemaVersion &&
    left.valueKind === right.valueKind &&
    isDeepStrictEqual(left.semanticValue, right.semanticValue)
  );
}

function entryRelationshipError(
  entry: z.infer<typeof appliedDeltaEntryV1Schema>,
) {
  switch (entry.kind) {
    case "concept_created":
      return null;
    case "criterion_added":
      return entry.after.lifecycle === "active"
        ? null
        : "An added criterion must be active";
    case "criterion_replaced":
    case "criterion_relaxed":
    case "criterion_tightened":
      return !sameVersionIdentity(entry.before, entry.ended)
        ? "Replacement before and ended snapshots must identify one version"
        : entry.before.lifecycle !== "active" ||
            entry.ended.lifecycle !== "superseded"
          ? "Replacement snapshots must move from active to superseded"
          : entry.ended.supersededById !== entry.after.id
            ? "Replacement successor must be the recorded after version"
            : entry.before.id === entry.after.id ||
                entry.before.lineageId !== entry.after.lineageId ||
                entry.before.conceptId !== entry.after.conceptId ||
                entry.after.lifecycle !== "active"
              ? "Replacement successor identity is incoherent"
              : null;
    case "criterion_removed":
      return !sameVersionIdentity(entry.before, entry.after)
        ? "Removal before and after snapshots must identify one version"
        : entry.before.lifecycle !== "active" ||
            entry.after.lifecycle !== "removed" ||
            entry.after.supersededById !== null
          ? "Removal snapshots must move from active to removed"
          : null;
    case "concept_marked_indifferent": {
      const beforeIds = entry.before.map((snapshot) => snapshot.id).sort();
      const endedIds = entry.ended.map((snapshot) => snapshot.id).sort();
      if (
        beforeIds.length !== new Set(beforeIds).size ||
        endedIds.length !== new Set(endedIds).size ||
        !isDeepStrictEqual(beforeIds, endedIds)
      ) {
        return "Indifference before and ended snapshots must be one exact set";
      }
      const endedById = new Map(
        entry.ended.map((snapshot) => [snapshot.id, snapshot] as const),
      );
      if (
        entry.before.some((before) => {
          const ended = endedById.get(before.id);
          return (
            ended === undefined ||
            !sameVersionIdentity(before, ended) ||
            before.lifecycle !== "active" ||
            ended.lifecycle !== "removed" ||
            ended.supersededById !== null ||
            before.conceptId !== entry.conceptId
          );
        }) ||
        entry.after.conceptId !== entry.conceptId ||
        entry.after.lifecycle !== "active" ||
        entry.after.semanticValue.kind !== "indifferent" ||
        beforeIds.includes(entry.after.id)
      ) {
        return "Indifference snapshots do not describe one coherent concept transition";
      }
      return null;
    }
    case "criterion_ended_by_undo":
      return !sameVersionIdentity(entry.before, entry.after)
        ? "Undo-ended snapshots must identify one semantic version"
        : entry.before.lifecycle !== "active" ||
            (entry.after.lifecycle !== "removed" &&
              entry.after.lifecycle !== "superseded")
          ? "Undo-ended snapshots must move an active version to terminal state"
          : null;
    case "criterion_restored_by_undo":
      return !sameRecordedMeaning(entry.restoredFrom, entry.after)
        ? "Undo restoration must preserve lineage, concept, and recorded meaning"
        : entry.restoredFrom.id === entry.after.id ||
            entry.after.lifecycle !== "active" ||
            entry.after.authority !== "user_explicit"
          ? "Undo restoration must create a new active user-explicit version"
          : null;
  }
}

export const appliedStateDeltaV1Schema = z
  .strictObject({
    schemaVersion: z.literal(APPLIED_STATE_DELTA_SCHEMA_VERSION),
    entries: z.array(appliedDeltaEntryV1Schema),
  })
  .superRefine((delta, context) => {
    const restoredById = new Map(
      delta.entries.flatMap((entry) =>
        entry.kind === "criterion_restored_by_undo"
          ? [[entry.after.id, entry.after] as const]
          : [],
      ),
    );
    delta.entries.forEach((entry, index) => {
      const message = entryRelationshipError(entry);
      if (message !== null) {
        context.addIssue({ code: "custom", path: ["entries", index], message });
      }
      if (
        entry.kind === "criterion_ended_by_undo" &&
        entry.after.lifecycle === "superseded"
      ) {
        const successor =
          entry.after.supersededById === null
            ? undefined
            : restoredById.get(entry.after.supersededById);
        if (
          successor === undefined ||
          successor.lineageId !== entry.after.lineageId ||
          successor.conceptId !== entry.after.conceptId
        ) {
          context.addIssue({
            code: "custom",
            path: ["entries", index],
            message:
              "A superseded undo-ended version must identify its restored successor",
          });
        }
      }
    });
  });

export type AppliedStateDeltaV1 = z.infer<typeof appliedStateDeltaV1Schema>;
export type AppliedDeltaEntryV1 = AppliedStateDeltaV1["entries"][number];

export const stateChangeApplicationSchema = z
  .strictObject({
    id: stateChangeApplicationIdSchema,
    taskId: shoppingTaskIdSchema,
    sourceTaskInputId: taskInputIdSchema,
    applicationKind: z.enum(["patch", "undo"]),
    requestSchemaVersion: z.literal(1),
    fingerprintVersion: z.literal(1),
    requestFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    baseRevision: taskRevisionSchema,
    resultingRevision: taskRevisionSchema,
    outcome: z.enum(["applied", "no_change"]),
    deltaSchemaVersion: z.literal(APPLIED_STATE_DELTA_SCHEMA_VERSION),
    appliedDelta: appliedStateDeltaV1Schema,
    undoesApplicationId: stateChangeApplicationIdSchema.nullable(),
    createdAt: z.date(),
  })
  .superRefine((application, context) => {
    const expectedResult =
      application.outcome === "applied"
        ? application.baseRevision + 1n
        : application.baseRevision;
    if (application.resultingRevision !== expectedResult) {
      context.addIssue({
        code: "custom",
        message: "Receipt revisions do not match its outcome",
      });
    }
    if (
      (application.outcome === "no_change") !==
      (application.appliedDelta.entries.length === 0)
    ) {
      context.addIssue({
        code: "custom",
        message: "Receipt outcome does not match its delta",
      });
    }
    if (
      (application.applicationKind === "undo") !==
      (application.undoesApplicationId !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Only undo receipts require an undo target",
      });
    }
    if (
      application.applicationKind === "undo" &&
      application.outcome !== "applied"
    ) {
      context.addIssue({
        code: "custom",
        message: "Undo cannot be a no-change receipt",
      });
    }
    const forwardKinds = new Set<AppliedDeltaEntryV1["kind"]>([
      "concept_created",
      "criterion_added",
      "criterion_replaced",
      "criterion_relaxed",
      "criterion_tightened",
      "criterion_removed",
      "concept_marked_indifferent",
    ]);
    const undoKinds = new Set<AppliedDeltaEntryV1["kind"]>([
      "criterion_restored_by_undo",
      "criterion_ended_by_undo",
    ]);
    const allowedKinds =
      application.applicationKind === "patch" ? forwardKinds : undoKinds;
    if (
      application.appliedDelta.entries.some(
        (entry) => !allowedKinds.has(entry.kind),
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "Receipt kind and delta entry kinds must agree",
      });
    }
    if (
      application.applicationKind === "undo" &&
      application.undoesApplicationId !== null
    ) {
      if (application.undoesApplicationId === application.id) {
        context.addIssue({
          code: "custom",
          message: "An undo receipt cannot target itself",
        });
      }
      if (
        application.appliedDelta.entries.some(
          (entry) =>
            (entry.kind === "criterion_restored_by_undo" ||
              entry.kind === "criterion_ended_by_undo") &&
            entry.targetApplicationId !== application.undoesApplicationId,
        )
      ) {
        context.addIssue({
          code: "custom",
          message: "Every undo delta entry must identify the receipt target",
        });
      }
    }
  });

export type StateChangeApplication = z.infer<
  typeof stateChangeApplicationSchema
>;

export function snapshotCriterion(
  criterionInput: DecisionCriterion,
): CriterionSnapshotV1 {
  const criterion = decisionCriterionSchema.parse(criterionInput);
  return criterionSnapshotV1Schema.parse({
    id: criterion.id,
    lineageId: criterion.lineageId,
    conceptId: criterion.conceptId,
    authority: criterion.authority,
    strength: criterion.strength,
    targetSemantics: criterion.targetSemantics,
    valueSchemaVersion: criterion.valueSchemaVersion,
    valueKind: criterion.valueKind,
    semanticValue: criterion.semanticValue,
    lifecycle: criterion.lifecycle,
    createdRevision: criterion.createdRevision.toString(),
    endedRevision: criterion.endedRevision?.toString() ?? null,
    supersededById: criterion.supersededById,
  });
}

export function immutableSnapshotMatchesCriterion(
  snapshot: CriterionSnapshotV1,
  criterion: DecisionCriterion,
) {
  const persisted = snapshotCriterion(criterion);
  return (
    snapshot.id === persisted.id &&
    snapshot.lineageId === persisted.lineageId &&
    snapshot.conceptId === persisted.conceptId &&
    snapshot.authority === persisted.authority &&
    snapshot.strength === persisted.strength &&
    snapshot.targetSemantics === persisted.targetSemantics &&
    snapshot.valueSchemaVersion === persisted.valueSchemaVersion &&
    snapshot.valueKind === persisted.valueKind &&
    isDeepStrictEqual(snapshot.semanticValue, persisted.semanticValue) &&
    snapshot.createdRevision === persisted.createdRevision
  );
}
