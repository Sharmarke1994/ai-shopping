import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { shoppingBriefV1Schema } from "@/domain/shopping-state/brief";
import { persistedCandidateListingSchema } from "@/features/retrieval-spike/persistence/contracts";
import {
  criterionAssessmentV1Schema,
  evidenceSourceV1Schema,
  productObservationV1Schema,
} from "./contracts";
import {
  guardCriterionAssessment,
  orderCandidatesByAssessments,
} from "./assessment-policy";

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
  role?:
    | "listing"
    | "visual"
    | "independent_review"
    | "retailer_review_aggregate"
    | "manufacturer"
    | "other";
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
        : options.role === "independent_review" ||
            options.role === "manufacturer" ||
            options.role === "other"
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

    const aboveStretch = guardCriterionAssessment({
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
      listing: persistedCandidateListingSchema.parse({
        ...listing,
        price: { amountMinor: 8_000, currency: "GBP" },
        priceText: "£80",
      }),
      observations: [],
      proposal: null,
    });
    expect(aboveStretch).toMatchObject({
      status: "conflicts",
      relation: "above_stretch_ceiling",
    });
  });

  it("accepts conditional stretch only when cited evidence addresses the condition", () => {
    const longSessionEvidence = evidence({
      propertyLabel: "Long-session support",
      claim: "The independent review reports good support over long sessions.",
      value: {
        schemaVersion: 1,
        kind: "text",
        text: "good support over long sessions",
      },
      role: "independent_review",
    });
    const assessment = guardCriterionAssessment({
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
      observations: [longSessionEvidence],
      proposal: {
        status: "meets",
        relation: "condition_supported",
        explanation: "The review directly addresses long-session support.",
        observations: [longSessionEvidence],
      },
    });
    expect(assessment).toMatchObject({
      status: "meets",
      relation: "conditional_stretch_supported",
      method: "guarded_model",
    });
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

  it("preserves review rating and volume instead of sorting on stars alone", () => {
    const aggregate = evidence({
      propertyLabel: "Retailer review aggregate",
      claim: "Amazon reports 4.3/5 from 52,629 reviews.",
      value: {
        schemaVersion: 1,
        kind: "rating_aggregate",
        ratingHundredths: 430,
        scaleHundredths: 500,
        reviewCount: 52_629,
      },
      role: "retailer_review_aggregate",
    });
    const assessment = guardCriterionAssessment({
      item: item({
        label: "Customer reviews",
        strength: "strong_preference",
        targetSemantics: "qualitative",
        semanticValue: {
          schemaVersion: 1,
          kind: "qualitative",
          mode: "text",
          text: "strong customer evidence",
        },
      }),
      listing,
      observations: [aggregate],
      proposal: {
        status: "meets",
        relation: "established_customer_evidence",
        explanation: aggregate.observation.claim,
        observations: [aggregate],
      },
    });
    expect(assessment.status).toBe("meets");
    expect(assessment.explanation).toContain("4.3/5 from 52,629 reviews");
  });

  it("keeps long-workday comfort uncertain even with a useful independent report", () => {
    const support = evidence({
      propertyLabel: "Palm support",
      claim: "The independent review reports strong palm support.",
      value: {
        schemaVersion: 1,
        kind: "text",
        text: "strong palm support",
      },
      role: "independent_review",
    });
    const assessment = guardCriterionAssessment({
      item: item({
        label: "Comfort for long workdays",
        strength: "strong_preference",
        targetSemantics: "qualitative",
        semanticValue: {
          schemaVersion: 1,
          kind: "qualitative",
          mode: "text",
          text: "comfortable for long workdays",
        },
      }),
      listing,
      observations: [support],
      proposal: {
        status: "meets",
        relation: "review_support",
        explanation: support.observation.claim,
        observations: [support],
      },
    });
    expect(assessment).toMatchObject({
      status: "uncertain",
      relation: "personal_fit_unresolved",
    });
    expect(assessment.explanation).toContain("strong palm support");
  });

  it("does not use unsourced brand familiarity as reputation evidence", () => {
    const nameOnly = evidence({
      propertyLabel: "Brand name",
      claim: "The listing names ExampleCo.",
      value: {
        schemaVersion: 1,
        kind: "text",
        text: "ExampleCo",
      },
      role: "listing",
    });
    const assessment = guardCriterionAssessment({
      item: item({
        label: "Brand reputation",
        strength: "strong_preference",
        targetSemantics: "qualitative",
        semanticValue: {
          schemaVersion: 1,
          kind: "qualitative",
          mode: "text",
          text: "good brand reputation",
        },
      }),
      listing,
      observations: [nameOnly],
      proposal: {
        status: "meets",
        relation: "known_brand",
        explanation: "ExampleCo is a good brand.",
        observations: [nameOnly],
      },
    });
    expect(assessment).toMatchObject({
      status: "uncertain",
      relation: "insufficient_relevant_evidence",
    });
  });

  it("ranks a clean unknown ahead of an explicit preference conflict", () => {
    const preference = item({
      label: "Overall size",
      strength: "preference",
      targetSemantics: "qualitative",
      semanticValue: {
        schemaVersion: 1,
        kind: "qualitative",
        mode: "text",
        text: "not huge",
      },
    });
    const brief = shoppingBriefV1Schema.parse({
      schemaVersion: 1,
      taskId: ids.task,
      revision: 1n,
      market: { country: "GB", language: "en-GB", currency: "GBP" },
      items: [preference],
    });
    const conflicted = persistedCandidateListingSchema.parse({
      ...listing,
      id: randomUUID(),
      providerResultId: "big-and-tall",
      title: "Big and tall office chair",
    });
    const unresolved = persistedCandidateListingSchema.parse({
      ...listing,
      id: randomUUID(),
      providerResultId: "size-unresolved",
      title: "Office chair",
    });
    const assessment = (
      candidate: typeof conflicted,
      status: "conflicts" | "uncertain",
    ) =>
      criterionAssessmentV1Schema.parse({
        schemaVersion: 1,
        id: randomUUID(),
        researchRunId: ids.research,
        taskId: ids.task,
        taskRevision: 1n,
        candidateRunId: candidate.runId,
        candidateListingId: candidate.id,
        criterionId: preference.criterionId,
        status,
        relation: status === "conflicts" ? "explicit_size_conflict" : "unknown",
        explanation:
          status === "conflicts"
            ? "The title explicitly says big and tall."
            : "Overall dimensions are unknown.",
        method: "deterministic",
        model: null,
        promptVersion: null,
        observationIds: [],
        createdAt: new Date("2026-01-01T00:00:00Z"),
      });
    const ordered = orderCandidatesByAssessments({
      brief,
      candidates: [conflicted, unresolved],
      assessments: [
        assessment(conflicted, "conflicts"),
        assessment(unresolved, "uncertain"),
      ],
    });
    expect(ordered.map(({ id }) => id)).toEqual([unresolved.id, conflicted.id]);
  });
});
