import { z } from "zod";
import type { ModelCallResult } from "@/features/context-acquisition/model-port";
import type { ProductUnderstandingCallPolicy } from "./model-port";
import type {
  ProductUnderstandingInputV1,
  ProductUnderstandingProviderWireV1,
} from "./provider-wire";

export const productUnderstandingFailureRuleSchema = z.enum([
  "provider_output_invalid_json",
  "provider_output_shape_invalid",
  "provider_schema_version_invalid",
  "observation_shape_invalid",
  "observation_local_ref_duplicate",
  "observation_source_ordinal_out_of_scope",
  "observation_evidence_binding_invalid",
  "observation_criterion_ordinal_out_of_scope",
  "focused_observation_criterion_missing",
  "assessment_shape_invalid",
  "assessment_count_mismatch",
  "assessment_criterion_duplicate",
  "assessment_criterion_missing",
  "assessment_criterion_ordinal_out_of_scope",
  "assessment_observation_ref_missing",
  "assessment_observation_ref_criterion_mismatch",
  "provider_refusal",
  "provider_response_incomplete",
  "provider_response_malformed",
  "provider_timeout",
  "provider_connection_failed",
  "provider_authentication_failed",
  "provider_permission_denied",
  "provider_quota_exhausted",
  "provider_rate_limited",
  "provider_request_rejected",
  "provider_unavailable",
  "provider_request_failed",
  "model_threw",
]);

export type ProductUnderstandingFailureRule = z.infer<
  typeof productUnderstandingFailureRuleSchema
>;

export const productUnderstandingFailureDiagnosticSchema = z.strictObject({
  failureCode: z.enum(["invalid_model_output", "model_failed"]),
  category: z.enum([
    "provider_output_contract",
    "application_scope_contract",
    "provider_response",
    "provider_transport",
  ]),
  rule: productUnderstandingFailureRuleSchema,
  candidateListingId: z.uuid(),
  researchPhase: z.enum(["first_pass", "deepening", "reassessment"]),
  requireCriterionBinding: z.boolean(),
  criterionCount: z.number().int().min(0).max(50),
  sourceCount: z.number().int().min(1).max(20),
  offendingCriterionOrdinal: z.number().int().min(0).max(49).nullable(),
  offendingSourceOrdinal: z.number().int().min(0).max(19).nullable(),
  providerRequestId: z.string().min(1).max(240).nullable(),
});

export type ProductUnderstandingFailureDiagnostic = z.infer<
  typeof productUnderstandingFailureDiagnosticSchema
>;

type ValidationClassification = Readonly<{
  rule: ProductUnderstandingFailureRule;
  offendingCriterionOrdinal: number | null;
  offendingSourceOrdinal: number | null;
}>;

function boundedOrdinal(value: unknown, maximum: number) {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= maximum
    ? value
    : null;
}

function ruleFromIssue(issue: z.core.$ZodIssue) {
  if (issue.code !== "custom") return null;
  const rule = issue.params?.rule;
  const parsed = productUnderstandingFailureRuleSchema.safeParse(rule);
  return parsed.success ? parsed.data : null;
}

export function classifyProductUnderstandingValidationError(
  error: unknown,
): ValidationClassification {
  if (error instanceof SyntaxError) {
    return {
      rule: "provider_output_invalid_json",
      offendingCriterionOrdinal: null,
      offendingSourceOrdinal: null,
    };
  }
  if (!(error instanceof z.ZodError)) {
    return {
      rule: "provider_output_shape_invalid",
      offendingCriterionOrdinal: null,
      offendingSourceOrdinal: null,
    };
  }
  const issue = error.issues[0];
  if (issue === undefined) {
    return {
      rule: "provider_output_shape_invalid",
      offendingCriterionOrdinal: null,
      offendingSourceOrdinal: null,
    };
  }
  const parameterRule = ruleFromIssue(issue);
  const root = issue.path[0];
  const field = issue.path[2] ?? issue.path[1];
  const rule =
    parameterRule ??
    (root === "providerSchemaVersion"
      ? "provider_schema_version_invalid"
      : root === "observations"
        ? field === "sourceOrdinal"
          ? "observation_source_ordinal_out_of_scope"
          : field === "criterionOrdinal"
            ? "observation_criterion_ordinal_out_of_scope"
            : "observation_shape_invalid"
        : root === "assessments"
          ? issue.code === "too_big" || issue.code === "too_small"
            ? "assessment_count_mismatch"
            : field === "criterionOrdinal"
              ? "assessment_criterion_ordinal_out_of_scope"
              : "assessment_shape_invalid"
          : "provider_output_shape_invalid");
  const params = issue.code === "custom" ? issue.params : undefined;
  return {
    rule,
    offendingCriterionOrdinal: boundedOrdinal(params?.criterionOrdinal, 49),
    offendingSourceOrdinal: boundedOrdinal(params?.sourceOrdinal, 19),
  };
}

export function productUnderstandingValidationErrorCode(error: unknown) {
  return `product_understanding_${classifyProductUnderstandingValidationError(error).rule}`;
}

function ruleFromProviderError(errorCode: string) {
  const prefixed = errorCode.startsWith("product_understanding_")
    ? errorCode.slice("product_understanding_".length)
    : errorCode;
  const parsed = productUnderstandingFailureRuleSchema.safeParse(prefixed);
  if (parsed.success) return parsed.data;
  if (errorCode === "provider_refusal") return "provider_refusal" as const;
  if (errorCode === "provider_response_incomplete")
    return "provider_response_incomplete" as const;
  if (errorCode === "provider_timeout") return "provider_timeout" as const;
  if (errorCode === "provider_request_failed")
    return "provider_request_failed" as const;
  return "provider_response_malformed" as const;
}

export function diagnoseProductUnderstandingFailure(options: {
  result: ModelCallResult<ProductUnderstandingProviderWireV1> | null;
  scopedValidationError?: unknown;
  input: ProductUnderstandingInputV1;
  policy: ProductUnderstandingCallPolicy;
  candidateListingId: string;
  researchPhase: "first_pass" | "deepening" | "reassessment";
}): ProductUnderstandingFailureDiagnostic {
  const scoped =
    options.scopedValidationError === undefined
      ? null
      : classifyProductUnderstandingValidationError(
          options.scopedValidationError,
        );
  const rule =
    options.result === null
      ? ("model_threw" as const)
      : (scoped?.rule ??
        (options.result.status === "completed"
          ? ("provider_response_malformed" as const)
          : ruleFromProviderError(options.result.errorCode)));
  const invalidOutput =
    scoped !== null ||
    options.result?.status === "malformed" ||
    (options.result?.status === "completed" &&
      options.scopedValidationError !== undefined);
  const category =
    scoped !== null
      ? ("application_scope_contract" as const)
      : invalidOutput
        ? ("provider_output_contract" as const)
        : options.result?.status === "refused" ||
            options.result?.status === "incomplete"
          ? ("provider_response" as const)
          : ("provider_transport" as const);

  return productUnderstandingFailureDiagnosticSchema.parse({
    failureCode: invalidOutput ? "invalid_model_output" : "model_failed",
    category,
    rule,
    candidateListingId: options.candidateListingId,
    researchPhase: options.researchPhase,
    requireCriterionBinding: options.policy.requireCriterionBinding,
    criterionCount: options.input.criteria.length,
    sourceCount: options.input.sources.length,
    offendingCriterionOrdinal: scoped?.offendingCriterionOrdinal ?? null,
    offendingSourceOrdinal: scoped?.offendingSourceOrdinal ?? null,
    providerRequestId: options.result?.metadata.providerRequestId ?? null,
  });
}
