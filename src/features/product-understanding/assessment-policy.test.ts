import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { shoppingBriefV1Schema } from "@/domain/shopping-state/brief";
import { persistedCandidateListingSchema } from "@/features/retrieval-spike/persistence/contracts";
import {
  evidenceSourceV1Schema,
  productObservationV1Schema,
} from "./contracts";
import { guardCriterionAssessment } from "./assessment-policy";

const ids = {
  task: randomUUID(),
  run: randomUUID(),
  query: randomUUID(),
  execution: randomUUID(),
  listing: randomUUID(),
  research: randomUUID(),
  attempt: randomUUID(),
  source: randomUUID(),
  observation: randomUUID(),
};

const listing = persistedCandidateListingSchema.parse({
  id: ids.listing,
  queryExecutionId: ids.execution,
  taskId: ids.task,
  runId: ids.run,
  queryId: ids.query,
  provider: "fixture",
  providerResultId: "mouse",
  sourceRank: 1,
  surface: "shopping",
  title: "Wireless ergonomic mouse",
  url: "https://example.test/mouse",
  canonicalUrl: "https://example.test/mouse",
  merchantDestinationUrl: null,
  merchantDestinationSource: null,
  merchant: "Example",
  price: { amountMinor: 6_500, currency: "GBP" },
  priceText: "£65",
  imageUrl: "https://example.test/mouse.jpg",
  deliveryText: null,
  availabilityText: null,
  reviewEvidence: null,
  retrievedAt: new Date("2026-01-01T00:00:00Z"),
});

function item(options: {
  label: string;
  strength?: "hard" | "strong_preference" | "preference";
  semanticValue: unknown;
  targetSemantics: string;
}) {
  return shoppingBriefV1Schema.parse({
    schemaVersion: 1,
    taskId: ids.task,
    revision: 1n,
    market: { country: "GB", language: "en-GB", currency: "GBP" },
    items: [
      {
        criterionId: randomUUID(),
        lineageId: randomUUID(),
        conceptId: randomUUID(),
        conceptLabel: options.label,
        conceptDefinition: options.label,
        strength: options.strength ?? "hard",
        targetSemantics: options.targetSemantics,
        semanticValue: options.semanticValue,
      },
    ],
  }).items[0]!;
}

function evidence(options: {
  propertyLabel: string;
  claim: string;
  value: unknown;
  role?: "listing" | "visual" | "independent_review";
}) {
  const source = evidenceSourceV1Schema.parse({
    schemaVersion: 1,
    id: ids.source,
    researchRunId: ids.research,
    taskId: ids.task,
    candidateRunId: ids.run,
    candidateListingId: ids.listing,
    acquisitionAttemptId: ids.attempt,
    sourceRole: options.role ?? "listing",
    sourceKind:
      options.role === "visual"
        ? "listing_image"
        : options.role === "independent_review"
          ? "organic_result"
          : "listing_field",
    sourceUrl: "https://example.test/evidence",
    sourceTitle: "Evidence",
    excerpt: options.claim,
    provider: "fixture",
    providerResultId: "evidence",
    observedAt: new Date("2026-01-01T00:00:00Z"),
    fingerprint: "a".repeat(64),
  });
  const observation = productObservationV1Schema.parse({
    schemaVersion: 1,
    id: ids.observation,
    researchRunId: ids.research,
    taskId: ids.task,
    candidateRunId: ids.run,
    candidateListingId: ids.listing,
    evidenceSourceId: ids.source,
    conceptId: null,
    support: "supported",
    observationKind:
      options.role === "visual" ? "visual_inference" : "source_assertion",
    propertyLabel: options.propertyLabel,
    claim: options.claim,
    value: options.value,
    derivation: options.role === "visual" ? "model_visual" : "model_text",
    model: "fixture",
    promptVersion: "fixture-v1",
    observedAt: new Date("2026-01-01T00:00:00Z"),
    fingerprint: "b".repeat(64),
  });
  return { source, observation };
}

describe("criterion assessment guard", () => {
  it("treats a direct ceiling breach as a conflict", () => {
    const assessment = guardCriterionAssessment({
      item: item({
        label: "Maximum price",
        targetSemantics: "exact",
        semanticValue: {
          schemaVersion: 1,
          kind: "money",
          mode: "ceiling",
          amountMinor: 5_000,
          currency: "GBP",
        },
      }),
      listing,
      observations: [],
      proposal: null,
    });
    expect(assessment.status).toBe("conflicts");
    expect(assessment.explanation).toContain("£15");
  });

  it("does not invent a target tolerance or accept conditional stretch", () => {
    const target = guardCriterionAssessment({
      item: item({
        label: "Budget",
        strength: "preference",
        targetSemantics: "around",
        semanticValue: {
          schemaVersion: 1,
          kind: "money",
          mode: "target",
          amountMinor: 5_000,
          currency: "GBP",
        },
      }),
      listing,
      observations: [],
      proposal: null,
    });
    expect(target.status).toBe("uncertain");
    expect(target.relation).toBe("target_distance_minor:1500");

    const stretch = guardCriterionAssessment({
      item: item({
        label: "Budget",
        strength: "preference",
        targetSemantics: "stretch",
        semanticValue: {
          schemaVersion: 1,
          kind: "money_stretch",
          targetMinor: 5_000,
          stretchCeilingMinor: 7_000,
          currency: "GBP",
          condition: "genuinely better for long sessions",
        },
      }),
      listing,
      observations: [],
      proposal: null,
    });
    expect(stretch.status).toBe("uncertain");
    expect(stretch.relation).toBe("inside_conditional_stretch");
  });

  it("does not let wireless evidence establish battery", () => {
    const wireless = evidence({
      propertyLabel: "Wireless connectivity",
      claim: "The listing says wireless",
      value: { schemaVersion: 1, kind: "boolean", value: true },
    });
    const assessment = guardCriterionAssessment({
      item: item({
        label: "Excellent battery life",
        strength: "strong_preference",
        targetSemantics: "qualitative",
        semanticValue: {
          schemaVersion: 1,
          kind: "qualitative",
          mode: "text",
          text: "excellent battery life",
        },
      }),
      listing,
      observations: [wireless],
      proposal: {
        status: "meets",
        relation: "supports",
        explanation: "Wireless",
        observations: [wireless],
      },
    });
    expect(assessment.status).toBe("uncertain");
  });

  it("does not let visual evidence hard-exclude a candidate", () => {
    const visual = evidence({
      propertyLabel: "Profile",
      claim: "The image appears flat",
      value: { schemaVersion: 1, kind: "text", text: "flat profile" },
      role: "visual",
    });
    const assessment = guardCriterionAssessment({
      item: item({
        label: "Sculpted profile",
        targetSemantics: "qualitative",
        semanticValue: {
          schemaVersion: 1,
          kind: "qualitative",
          mode: "text",
          text: "chunky and sculpted",
        },
      }),
      listing,
      observations: [visual],
      proposal: {
        status: "conflicts",
        relation: "visual_mismatch",
        explanation: "Looks flat",
        observations: [visual],
      },
    });
    expect(assessment.status).toBe("uncertain");
    expect(assessment.relation).toBe("conflict_not_directly_admissible");
  });
});
