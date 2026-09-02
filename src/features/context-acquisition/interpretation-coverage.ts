import { z } from "zod";
import type { CurrentShoppingState } from "@/domain/shopping-state/shopping-state";
import type { InterpretationProposalV1 } from "./provider-wire";
import type { ResolvedShoppingInputV1 } from "./contracts";
import type { ProviderInputEnvelopeV1 } from "./provider-input";

export const INTERPRETATION_COVERAGE_SCHEMA_VERSION = 1 as const;

const issueKindSchema = z.enum([
  "missing_explicit_meaning",
  "strength_mismatch",
  "direction_mismatch",
  "conditional_loss",
  "invented_meaning",
  "wrong_change_of_mind",
]);

const issueSchema = z.strictObject({
  kind: issueKindSchema,
  summary: z.string().min(1).max(240),
});

export const interpretationCoverageProviderWireV1Schema = z
  .strictObject({
    providerSchemaVersion: z.literal(INTERPRETATION_COVERAGE_SCHEMA_VERSION),
    verdict: z.enum(["complete", "needs_repair"]),
    issues: z.array(issueSchema).max(4),
  })
  .superRefine((value, context) => {
    if (value.verdict === "complete" && value.issues.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["issues"],
        message: "A complete coverage verdict cannot contain issues",
      });
    }
    if (value.verdict === "needs_repair" && value.issues.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["issues"],
        message: "A repair verdict must identify at least one issue",
      });
    }
  });

export type InterpretationCoverageProviderWireV1 = z.infer<
  typeof interpretationCoverageProviderWireV1Schema
>;

export type InterpretationCoverageInputV1 = ProviderInputEnvelopeV1;

export function buildInterpretationCoverageInputV1(options: {
  state: CurrentShoppingState;
  sourceInputId: string;
  source: ResolvedShoppingInputV1;
  proposal: InterpretationProposalV1;
  issues?: readonly { kind: string; summary: string }[];
}): InterpretationCoverageInputV1 {
  const state = options.state;
  const payload = {
    requestSchemaVersion: 1,
    taskId: state.task.id,
    sourceInputId: options.sourceInputId,
    currentRevision: state.task.currentRevision.toString(),
    market: state.task.market,
    source: options.source,
    concepts: state.concepts,
    activeCriteria: state.activeCriteria,
    proposal: options.proposal,
    ...(options.issues === undefined ? {} : { verifierIssues: options.issues }),
  } satisfies Record<string, unknown>;
  const envelope = {
    providerInputSchemaVersion: 1 as const,
    payload,
  } satisfies ProviderInputEnvelopeV1;
  if (Buffer.byteLength(JSON.stringify(envelope), "utf8") > 96_000) {
    throw new Error("interpretation_coverage_input_too_large");
  }
  return envelope;
}

export function coverageIssueKinds(
  result: InterpretationCoverageProviderWireV1,
): readonly string[] {
  return [...new Set(result.issues.map((issue) => issue.kind))];
}
