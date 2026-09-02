import { execFile } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import {
  createOpenAIProductUnderstandingModel,
  V0_07_OPENAI_DEFAULT_CONFIG,
} from "../src/features/product-understanding/openai-adapter";
import {
  classifyProductUnderstandingValidationError,
  productUnderstandingFailureRuleSchema,
} from "../src/features/product-understanding/failure-taxonomy";
import {
  productUnderstandingInputV1Schema,
  productUnderstandingProviderWireV1SchemaForInput,
} from "../src/features/product-understanding/provider-wire";

const executeFile = promisify(execFile);
const outputDirectory = new URL("../docs/evals/", import.meta.url);
const markerUrl = new URL(
  "v0-09-recovery-rc2-understanding-diagnostic-attempt.json",
  outputDirectory,
);
const successUrl = new URL(
  "v0-09-recovery-rc2-understanding-diagnostic.json",
  outputDirectory,
);
const failureUrl = new URL(
  "v0-09-recovery-rc2-understanding-diagnostic-failure.json",
  outputDirectory,
);
const model = "gpt-5.6-terra" as const;

async function exists(url: URL) {
  try {
    await access(url);
    return true;
  } catch {
    return false;
  }
}

async function readOpenAIKey() {
  const { stdout } = await executeFile("security", [
    "find-generic-password",
    "-s",
    "ai-shopping-openai",
    "-w",
  ]);
  const value = stdout.trim();
  if (value.length < 20)
    throw new Error("OpenAI Keychain credential is absent");
  return value;
}

const criteria = [
  ["Long-session comfort", "comfortable for a full working day"],
  ["Strong review evidence", "well supported by independent reviews"],
  ["Wireless", "wireless connection"],
  ["Very good battery life", "very good battery endurance"],
  ["Sculpted shape", "chunky sculpted side profile and thumb rest"],
  ["Brand reputation", "reputable established manufacturer"],
  ["Under £50", "observed purchase price under £50"],
  ["Not Amazon Basics", "exclude Amazon Basics"],
] as const;

const input = productUnderstandingInputV1Schema.parse({
  schemaVersion: 1,
  market: { country: "GB", language: "en-GB", currency: "GBP" },
  candidate: {
    title: "Example Vertical Wireless Ergonomic Mouse",
    merchant: "Example UK retailer",
    observedPriceText: "£39.99",
  },
  criteria: criteria.map(([label, text], ordinal) => ({
    ordinal,
    label,
    definition: `Authoritative shopper criterion: ${text}`,
    strength: ordinal === 6 || ordinal === 7 ? "hard" : "preference",
    targetSemantics: ordinal === 6 ? "range" : "qualitative",
    value: {
      schemaVersion: 1,
      kind: "qualitative",
      mode: "text",
      text,
    },
  })),
  sources: [
    {
      ordinal: 0,
      role: "retailer",
      kind: "listing_field",
      title: "Retailer listing",
      url: "https://retailer.example.test/example-mouse",
      excerpt:
        "The listing calls this a wireless vertical ergonomic mouse, prices it at £39.99, and identifies Example as the brand.",
    },
    {
      ordinal: 1,
      role: "manufacturer",
      kind: "fetched_page",
      title: "Manufacturer specification page",
      url: "https://manufacturer.example.test/example-mouse",
      excerpt:
        "The manufacturer describes a sculpted thumb rest, 2.4 GHz wireless connection, and up to 18 months of battery life.",
    },
    {
      ordinal: 2,
      role: "independent_review",
      kind: "fetched_page",
      title: "Independent hands-on review",
      url: "https://review.example.test/example-mouse",
      excerpt:
        "The reviewer found the tall sculpted shell supportive during long office sessions but notes that comfort depends on hand size.",
    },
    {
      ordinal: 3,
      role: "retailer_review_aggregate",
      kind: "organic_result",
      title: "Retailer review aggregate",
      url: "https://reviews.example.test/example-mouse",
      excerpt: "The result reports a 4.4 out of 5 aggregate from 780 ratings.",
    },
  ],
});

await mkdir(outputDirectory, { recursive: true });
if (
  (await exists(markerUrl)) ||
  (await exists(successUrl)) ||
  (await exists(failureUrl))
) {
  throw new Error(
    "RC2 product-understanding diagnostic already has preserved evidence; refusing another provider call",
  );
}
await writeFile(
  markerUrl,
  `${JSON.stringify(
    {
      schemaVersion: 1,
      diagnostic: "v0_09_recovery_rc2_broad_product_understanding",
      claimedAt: new Date().toISOString(),
      model,
      criterionCount: input.criteria.length,
      sourceCount: input.sources.length,
    },
    null,
    2,
  )}\n`,
  { encoding: "utf8", flag: "wx" },
);

let key = "";
try {
  key = await readOpenAIKey();
  if (V0_07_OPENAI_DEFAULT_CONFIG.model !== model) {
    throw new Error(
      "Product-understanding release model is not pinned to Terra",
    );
  }
  const adapter = createOpenAIProductUnderstandingModel({
    apiKey: key,
    config: { model },
  });
  const startedAt = performance.now();
  const result = await adapter.understand(input, {
    requireCriterionBinding: false,
  });
  const durationMs = Math.max(0, Math.round(performance.now() - startedAt));
  const scoped =
    result.status === "completed"
      ? productUnderstandingProviderWireV1SchemaForInput({
          input,
          requireCriterionBinding: false,
        }).safeParse(result.value)
      : null;
  const malformedRule =
    result.status === "malformed" &&
    result.errorCode.startsWith("product_understanding_")
      ? productUnderstandingFailureRuleSchema.safeParse(
          result.errorCode.slice("product_understanding_".length),
        )
      : null;
  const scopedFailure =
    scoped?.success === false
      ? classifyProductUnderstandingValidationError(scoped.error)
      : null;
  const failureTaxonomy =
    malformedRule?.success === true
      ? {
          failureCode: "invalid_model_output" as const,
          category: "provider_output_contract" as const,
          rule: malformedRule.data,
          offendingCriterionOrdinal: null,
          offendingSourceOrdinal: null,
        }
      : scopedFailure === null
        ? null
        : {
            failureCode: "invalid_model_output" as const,
            category: "application_scope_contract" as const,
            rule: scopedFailure.rule,
            offendingCriterionOrdinal: scopedFailure.offendingCriterionOrdinal,
            offendingSourceOrdinal: scopedFailure.offendingSourceOrdinal,
          };
  const report = {
    schemaVersion: 1,
    diagnostic: "v0_09_recovery_rc2_broad_product_understanding",
    generatedAt: new Date().toISOString(),
    model,
    fixtureOnly: true,
    criterionCount: input.criteria.length,
    sourceCount: input.sources.length,
    status: result.status,
    errorCode: result.status === "completed" ? null : result.errorCode,
    failureTaxonomy,
    providerRequestId: result.metadata.providerRequestId,
    durationMs,
    observationCount:
      result.status === "completed" ? result.value.observations.length : null,
    assessmentCount:
      result.status === "completed" ? result.value.assessments.length : null,
    assessedOrdinals:
      result.status === "completed"
        ? result.value.assessments
            .map(({ criterionOrdinal }) => criterionOrdinal)
            .sort((left, right) => left - right)
        : [],
    applicationScopeValid: scoped?.success ?? false,
    releaseAccepted: false,
    note: "This single provider-contract diagnostic uses synthetic fixture evidence and does not become authoritative shopping truth or V0-09 release evidence.",
  };
  if (result.status !== "completed" || scoped?.success !== true) {
    await writeFile(failureUrl, `${JSON.stringify(report, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    throw new Error(
      `RC2 broad product-understanding diagnostic failed: ${report.errorCode ?? "application_scope_invalid"}`,
    );
  }
  await writeFile(successUrl, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  process.stdout.write(
    `${JSON.stringify({ ...report, providerRequestId: report.providerRequestId !== null ? "present" : null }, null, 2)}\n`,
  );
} catch (error) {
  const message =
    error instanceof Error
      ? error.message.slice(0, 500)
      : "Unknown diagnostic failure";
  if (!(await exists(failureUrl))) {
    await writeFile(
      failureUrl,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          diagnostic: "v0_09_recovery_rc2_broad_product_understanding_failed",
          generatedAt: new Date().toISOString(),
          model,
          criterionCount: input.criteria.length,
          sourceCount: input.sources.length,
          failure: {
            name: error instanceof Error ? error.name : "UnknownError",
            message,
          },
          releaseAccepted: false,
        },
        null,
        2,
      )}\n`,
      { encoding: "utf8", flag: "wx" },
    );
  }
  throw new Error(message);
} finally {
  key = "";
}
