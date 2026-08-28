import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { shoppingBriefV1Schema } from "@/domain/shopping-state/brief";
import { shoppingTaskIdSchema } from "@/domain/shopping-state/ids";
import { searchRunIdSchema } from "@/features/retrieval-spike/contracts";
import { persistedCandidateListingSchema } from "@/features/retrieval-spike/persistence/contracts";
import {
  criterionAssessmentV1Schema,
  evidenceResearchRunIdSchema,
} from "./contracts";
import { buildDecisionSupport } from "./decision-support";

describe("assessment-driven decision support", () => {
  it("surfaces assessment content without manufacturing percentages", () => {
    const candidate = persistedCandidateListingSchema.parse({
      id: "11111111-1111-4111-8111-111111111111",
      taskId: "22222222-2222-4222-8222-222222222222",
      runId: "33333333-3333-4333-8333-333333333333",
      queryId: "44444444-4444-4444-8444-444444444444",
      queryExecutionId: "55555555-5555-4555-8555-555555555555",
      provider: "fixture" as const,
      providerResultId: "candidate",
      sourceRank: 1,
      surface: "shopping" as const,
      title: "Evidence-backed mouse",
      url: "https://example.test/mouse",
      canonicalUrl: "https://example.test/mouse",
      merchantDestinationUrl: "https://example.test/mouse",
      merchantDestinationSource: "shopping_result" as const,
      merchant: "Example",
      price: { amountMinor: 3499, currency: "GBP" as const },
      priceText: "£34.99",
      imageUrl: null,
      deliveryText: null,
      availabilityText: null,
      reviewEvidence: null,
      retrievedAt: new Date("2026-01-01T00:00:00Z"),
    });
    const criterionId = "66666666-6666-4666-8666-666666666666";
    const assessment = criterionAssessmentV1Schema.parse({
      schemaVersion: 1 as const,
      id: "77777777-7777-4777-8777-777777777777",
      researchRunId: "88888888-8888-4888-8888-888888888888",
      taskId: candidate.taskId,
      taskRevision: 1n,
      candidateRunId: candidate.runId,
      candidateListingId: candidate.id,
      criterionId,
      status: "meets" as const,
      relation: "within_ceiling",
      explanation: "£34.99 is within the £50 maximum.",
      method: "deterministic" as const,
      model: null,
      promptVersion: null,
      observationIds: [],
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });
    const brief = shoppingBriefV1Schema.parse({
      schemaVersion: 1,
      taskId: candidate.taskId,
      revision: 1n,
      market: { country: "GB", language: "en-GB", currency: "GBP" },
      items: [
        {
          criterionId,
          lineageId: "99999999-9999-4999-8999-999999999999",
          conceptId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          conceptLabel: "Maximum price",
          conceptDefinition: "Maximum observed price",
          strength: "hard",
          targetSemantics: "exact",
          semanticValue: {
            schemaVersion: 1,
            kind: "money",
            mode: "ceiling",
            amountMinor: 5000,
            currency: "GBP",
          },
        },
      ],
    });
    const result = buildDecisionSupport({
      support: {
        brief,
        researchRuns: [
          {
            id: evidenceResearchRunIdSchema.parse(assessment.researchRunId),
            taskId: shoppingTaskIdSchema.parse(candidate.taskId),
            searchRunId: searchRunIdSchema.parse(candidate.runId),
            taskRevision: 1n,
            policyVersion: "evidence-selective-v1",
            status: "succeeded",
            selectedCandidateCount: 1,
            plannedSearchCount: 2,
            startedAt: new Date("2026-01-01T00:00:00Z"),
            finishedAt: new Date("2026-01-01T00:00:01Z"),
          },
        ],
        candidates: [candidate],
        sources: [],
        observations: [],
        assessments: [assessment],
      },
      savedListingIds: new Set(),
    });
    expect(result.topOptions[0]).toMatchObject({
      strongestSupported: true,
      whyItFits: ["£34.99 is within the £50 maximum."],
    });
    expect(JSON.stringify(result)).not.toContain("%");

    const duplicate = persistedCandidateListingSchema.parse({
      ...candidate,
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      queryId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      queryExecutionId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      providerResultId: "candidate-duplicate-query",
    });
    const duplicateAssessment = criterionAssessmentV1Schema.parse({
      ...assessment,
      id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      candidateListingId: duplicate.id,
    });
    const grouped = buildDecisionSupport({
      support: {
        brief,
        researchRuns: [],
        candidates: [candidate, duplicate],
        sources: [],
        observations: [],
        assessments: [assessment, duplicateAssessment],
      },
      savedListingIds: new Set(),
    });
    expect(grouped.topOptions).toHaveLength(1);

    const indirectCandidate = persistedCandidateListingSchema.parse({
      ...candidate,
      id: "12121212-1212-4121-8121-121212121212",
      queryId: "13131313-1313-4131-8131-131313131313",
      queryExecutionId: "14141414-1414-4141-8141-141414141414",
      providerResultId: "indirect",
      merchantDestinationUrl: null,
      merchantDestinationSource: null,
    });
    const indirectDuplicate = persistedCandidateListingSchema.parse({
      ...indirectCandidate,
      id: "15151515-1515-4151-8151-151515151515",
      queryId: "16161616-1616-4161-8161-161616161616",
      queryExecutionId: "17171717-1717-4171-8171-171717171717",
      providerResultId: "indirect-duplicate",
    });
    const indirectAssessments = [indirectCandidate, indirectDuplicate].map(
      (listing, index) =>
        criterionAssessmentV1Schema.parse({
          ...assessment,
          id:
            index === 0
              ? "18181818-1818-4181-8181-181818181818"
              : "19191919-1919-4191-8191-191919191919",
          candidateListingId: listing.id,
        }),
    );
    expect(
      buildDecisionSupport({
        support: {
          brief,
          researchRuns: [],
          candidates: [indirectCandidate, indirectDuplicate],
          sources: [],
          observations: [],
          assessments: indirectAssessments,
        },
        savedListingIds: new Set(),
      }).topOptions,
    ).toHaveLength(1);

    const cleanRunner = persistedCandidateListingSchema.parse({
      ...candidate,
      id: "20202020-2020-4202-8202-202020202020",
      queryId: "21212121-2121-4212-8212-212121212121",
      queryExecutionId: "22222222-2222-4222-8222-222222222223",
      providerResultId: "clean-runner",
      url: "https://example.test/clean-runner",
      canonicalUrl: "https://example.test/clean-runner",
      merchantDestinationUrl: "https://example.test/clean-runner",
    });
    const conflictingOption = persistedCandidateListingSchema.parse({
      ...candidate,
      id: "23232323-2323-4232-8232-232323232323",
      queryId: "24242424-2424-4242-8242-242424242424",
      queryExecutionId: "25252525-2525-4252-8252-252525252525",
      providerResultId: "conflicting-option",
      url: "https://example.test/conflicting-option",
      canonicalUrl: "https://example.test/conflicting-option",
      merchantDestinationUrl: "https://example.test/conflicting-option",
    });
    const preferenceBrief = shoppingBriefV1Schema.parse({
      ...brief,
      items: [{ ...brief.items[0]!, strength: "preference" as const }],
    });
    const recommendation = buildDecisionSupport({
      support: {
        brief: preferenceBrief,
        researchRuns: [],
        candidates: [candidate, cleanRunner, conflictingOption],
        sources: [],
        observations: [],
        assessments: [
          assessment,
          criterionAssessmentV1Schema.parse({
            ...assessment,
            id: "26262626-2626-4262-8262-262626262626",
            candidateListingId: cleanRunner.id,
          }),
          criterionAssessmentV1Schema.parse({
            ...assessment,
            id: "27272727-2727-4272-8272-272727272727",
            candidateListingId: conflictingOption.id,
            status: "conflicts",
            relation: "preference_mismatch",
            explanation: "This option contradicts the stated preference.",
          }),
        ],
      },
      savedListingIds: new Set(),
    });
    expect(recommendation.topOptions.map(({ listing }) => listing.id)).toEqual([
      candidate.id,
      cleanRunner.id,
      conflictingOption.id,
    ]);
  });

  it("excludes absolute money breaches while retaining eligible uncertainty and trade-offs", () => {
    const taskId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const runId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const briefItem = (options: {
      criterionId: string;
      label: string;
      strength: "preference" | "hard";
      semanticValue: unknown;
      targetSemantics: string;
    }) => ({
      criterionId: options.criterionId,
      lineageId: randomUUID(),
      conceptId: randomUUID(),
      conceptLabel: options.label,
      conceptDefinition: options.label,
      strength: options.strength,
      targetSemantics: options.targetSemantics,
      semanticValue: options.semanticValue,
    });
    const ceilingCriterionId = randomUUID();
    const stretchCriterionId = randomUUID();
    const brief = shoppingBriefV1Schema.parse({
      schemaVersion: 1,
      taskId,
      revision: 1n,
      market: { country: "GB", language: "en-GB", currency: "GBP" },
      items: [
        briefItem({
          criterionId: ceilingCriterionId,
          label: "Maximum price",
          strength: "preference",
          targetSemantics: "exact",
          semanticValue: {
            schemaVersion: 1,
            kind: "money",
            mode: "ceiling",
            amountMinor: 35_000,
            currency: "GBP",
          },
        }),
        briefItem({
          criterionId: stretchCriterionId,
          label: "Budget",
          strength: "preference",
          targetSemantics: "stretch",
          semanticValue: {
            schemaVersion: 1,
            kind: "money_stretch",
            targetMinor: 25_000,
            stretchCeilingMinor: 35_000,
            currency: "GBP",
            condition: "genuinely better for long sessions",
          },
        }),
      ],
    });
    const listing = (amountMinor: number, title: string) =>
      persistedCandidateListingSchema.parse({
        id: randomUUID(),
        taskId,
        runId,
        queryId: randomUUID(),
        queryExecutionId: randomUUID(),
        provider: "fixture",
        providerResultId: title,
        sourceRank: 1,
        surface: "shopping",
        title,
        url: `https://example.test/${title.toLocaleLowerCase("en-GB").replaceAll(" ", "-")}`,
        canonicalUrl: `https://example.test/${title.toLocaleLowerCase("en-GB").replaceAll(" ", "-")}`,
        merchantDestinationUrl: null,
        merchantDestinationSource: null,
        merchant: "Example",
        price: { amountMinor, currency: "GBP" },
        priceText: `£${(amountMinor / 100).toFixed(2)}`,
        imageUrl: null,
        deliveryText: null,
        availabilityText: null,
        reviewEvidence: null,
        retrievedAt: new Date("2026-01-01T00:00:00Z"),
      });
    const assessment = (
      candidateListingId: string,
      criterionId: string,
      status: "meets" | "conflicts" | "uncertain",
      relation: string,
    ) =>
      criterionAssessmentV1Schema.parse({
        schemaVersion: 1,
        id: randomUUID(),
        researchRunId: randomUUID(),
        taskId,
        taskRevision: 1n,
        candidateRunId: runId,
        candidateListingId,
        criterionId,
        status,
        relation,
        explanation: relation,
        method: "deterministic",
        model: null,
        promptVersion: null,
        observationIds: [],
        createdAt: new Date("2026-01-01T00:00:00Z"),
      });
    const aboveCeiling = listing(40_000, "Above ceiling");
    const aboveStretch = listing(36_000, "Above stretch");
    const belowTarget = listing(20_000, "Below target");
    const insideStretch = listing(32_000, "Inside stretch");
    const exactTarget = listing(25_000, "Exact target");
    const decision = buildDecisionSupport({
      support: {
        brief,
        researchRuns: [],
        candidates: [
          aboveCeiling,
          aboveStretch,
          belowTarget,
          insideStretch,
          exactTarget,
        ],
        sources: [],
        observations: [],
        assessments: [
          assessment(
            aboveCeiling.id,
            ceilingCriterionId,
            "conflicts",
            "above_ceiling",
          ),
          assessment(
            aboveStretch.id,
            stretchCriterionId,
            "conflicts",
            "above_stretch_ceiling",
          ),
          assessment(
            belowTarget.id,
            stretchCriterionId,
            "uncertain",
            "target_distance_minor:-5000",
          ),
          assessment(
            insideStretch.id,
            stretchCriterionId,
            "uncertain",
            "inside_conditional_stretch",
          ),
          assessment(
            exactTarget.id,
            stretchCriterionId,
            "meets",
            "target_exact",
          ),
        ],
      },
      savedListingIds: new Set(),
    });
    const shownIds = decision.topOptions.map(({ listing: entry }) => entry.id);
    expect(shownIds).toContain(belowTarget.id);
    expect(shownIds).toContain(insideStretch.id);
    expect(shownIds).toContain(exactTarget.id);
    expect(shownIds).not.toContain(aboveCeiling.id);
    expect(shownIds).not.toContain(aboveStretch.id);

    const ordinaryConflict = listing(24_000, "Ordinary preference conflict");
    const ordinaryBrief = shoppingBriefV1Schema.parse({
      ...brief,
      items: [
        briefItem({
          criterionId: ceilingCriterionId,
          label: "Appearance",
          strength: "preference",
          targetSemantics: "qualitative",
          semanticValue: {
            schemaVersion: 1,
            kind: "qualitative",
            mode: "text",
            text: "restrained",
          },
        }),
      ],
    });
    const ordinaryDecision = buildDecisionSupport({
      support: {
        brief: ordinaryBrief,
        researchRuns: [],
        candidates: [exactTarget, ordinaryConflict],
        sources: [],
        observations: [],
        assessments: [
          assessment(
            exactTarget.id,
            ceilingCriterionId,
            "uncertain",
            "unknown",
          ),
          assessment(
            ordinaryConflict.id,
            ceilingCriterionId,
            "conflicts",
            "preference_mismatch",
          ),
        ],
      },
      savedListingIds: new Set(),
    });
    expect(
      ordinaryDecision.topOptions.map(({ listing: entry }) => entry.id),
    ).toContain(ordinaryConflict.id);
  });

  it("groups exact repeated offers conservatively without collapsing distinct direct destinations", () => {
    const candidate = persistedCandidateListingSchema.parse({
      id: "11111111-1111-4111-8111-111111111111",
      taskId: "22222222-2222-4222-8222-222222222222",
      runId: "33333333-3333-4333-8333-333333333333",
      queryId: "44444444-4444-4444-8444-444444444444",
      queryExecutionId: "55555555-5555-4555-8555-555555555555",
      provider: "fixture",
      providerResultId: "anker-a",
      sourceRank: 1,
      surface: "shopping",
      title: "Anker 2.4G Wireless Vertical Ergonomic Optical Mouse",
      url: "https://www.google.com/search?ibp=oshop&a=1",
      canonicalUrl: "https://www.google.com/search?ibp=oshop&a=1",
      merchantDestinationUrl: null,
      merchantDestinationSource: null,
      merchant: "Amazon.co.uk",
      price: { amountMinor: 1799, currency: "GBP" },
      priceText: "£17.99",
      imageUrl: null,
      deliveryText: null,
      availabilityText: null,
      reviewEvidence: null,
      retrievedAt: new Date("2026-01-01T00:00:00Z"),
    });
    const duplicate = persistedCandidateListingSchema.parse({
      ...candidate,
      id: "66666666-6666-4666-8666-666666666666",
      providerResultId: "anker-b",
      queryId: "77777777-7777-4777-8777-777777777777",
      queryExecutionId: "88888888-8888-4888-8888-888888888888",
      url: "https://www.google.com/search?ibp=oshop&b=2",
      canonicalUrl: "https://www.google.com/search?ibp=oshop&b=2",
    });
    const distinctDirect = persistedCandidateListingSchema.parse({
      ...candidate,
      id: "99999999-9999-4999-8999-999999999999",
      providerResultId: "anker-c",
      queryId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      queryExecutionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      merchantDestinationUrl: "https://www.amazon.co.uk/dp/B00BIFNTMC",
      merchantDestinationSource: "verified_organic",
    });
    const otherDirect = persistedCandidateListingSchema.parse({
      ...distinctDirect,
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      providerResultId: "anker-d",
      queryId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      queryExecutionId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      merchantDestinationUrl: "https://www.amazon.co.uk/dp/OTHER",
    });
    const criterionId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    const brief = shoppingBriefV1Schema.parse({
      schemaVersion: 1,
      taskId: candidate.taskId,
      revision: 1n,
      market: { country: "GB", language: "en-GB", currency: "GBP" },
      items: [
        {
          criterionId,
          lineageId: randomUUID(),
          conceptId: randomUUID(),
          conceptLabel: "Price",
          conceptDefinition: "Price",
          strength: "preference",
          targetSemantics: "exact",
          semanticValue: {
            schemaVersion: 1,
            kind: "money",
            mode: "target",
            amountMinor: 1799,
            currency: "GBP",
          },
        },
      ],
    });
    const assess = (entry: typeof candidate) =>
      criterionAssessmentV1Schema.parse({
        schemaVersion: 1,
        id: randomUUID(),
        researchRunId: randomUUID(),
        taskId: entry.taskId,
        taskRevision: 1n,
        candidateRunId: entry.runId,
        candidateListingId: entry.id,
        criterionId,
        status: "meets",
        relation: "target_exact",
        explanation: "exact",
        method: "deterministic",
        model: null,
        promptVersion: null,
        observationIds: [],
        createdAt: new Date("2026-01-01T00:00:00Z"),
      });
    const grouped = buildDecisionSupport({
      support: {
        brief,
        researchRuns: [],
        candidates: [candidate, duplicate, distinctDirect, otherDirect],
        sources: [],
        observations: [],
        assessments: [candidate, duplicate, distinctDirect, otherDirect].map(
          assess,
        ),
      },
      savedListingIds: new Set(),
    });
    expect(grouped.topOptions.map(({ listing: entry }) => entry.id)).toEqual([
      candidate.id,
      distinctDirect.id,
      otherDirect.id,
    ]);
  });
});
