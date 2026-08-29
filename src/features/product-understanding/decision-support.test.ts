import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { shoppingBriefV1Schema } from "@/domain/shopping-state/brief";
import { shoppingTaskIdSchema } from "@/domain/shopping-state/ids";
import { searchRunIdSchema } from "@/features/retrieval-spike/contracts";
import { persistedCandidateListingSchema } from "@/features/retrieval-spike/persistence/contracts";
import {
  criterionAssessmentV1Schema,
  evidenceResearchRunIdSchema,
  evidenceSourceV1Schema,
  productObservationV1Schema,
} from "./contracts";
import { buildDecisionSupport } from "./decision-support";

describe("assessment-driven decision support", () => {
  it("keeps hard unknowns distinct from conflicts and ahead of soft wins", () => {
    const taskId = randomUUID();
    const runId = randomUUID();
    const hardCriterionId = randomUUID();
    const preferenceCriterionId = randomUUID();
    const brief = shoppingBriefV1Schema.parse({
      schemaVersion: 1,
      taskId,
      revision: 3n,
      market: { country: "GB", language: "en-GB", currency: "GBP" },
      items: [
        {
          criterionId: hardCriterionId,
          lineageId: randomUUID(),
          conceptId: randomUUID(),
          conceptLabel: "Battery life",
          conceptDefinition: "Battery life must be verified",
          strength: "hard",
          targetSemantics: "qualitative",
          semanticValue: {
            schemaVersion: 1,
            kind: "qualitative",
            mode: "text",
            text: "very good battery life",
          },
        },
        {
          criterionId: preferenceCriterionId,
          lineageId: randomUUID(),
          conceptId: randomUUID(),
          conceptLabel: "Colour",
          conceptDefinition: "A preferred colour",
          strength: "preference",
          targetSemantics: "qualitative",
          semanticValue: {
            schemaVersion: 1,
            kind: "qualitative",
            mode: "text",
            text: "dark grey",
          },
        },
      ],
    });
    const candidate = (title: string) =>
      persistedCandidateListingSchema.parse({
        id: randomUUID(),
        taskId,
        runId,
        queryId: randomUUID(),
        queryExecutionId: randomUUID(),
        provider: "fixture",
        providerResultId: randomUUID(),
        sourceRank: 1,
        surface: "shopping",
        title,
        url: `https://example.test/${encodeURIComponent(title)}`,
        canonicalUrl: `https://example.test/${encodeURIComponent(title)}`,
        merchantDestinationUrl: null,
        merchantDestinationSource: null,
        merchant: "Example",
        price: { amountMinor: 4_000, currency: "GBP" },
        priceText: "£40",
        imageUrl: null,
        deliveryText: null,
        availabilityText: null,
        reviewEvidence: null,
        retrievedAt: new Date("2026-01-01T00:00:00Z"),
      });
    const verified = candidate("Verified mouse");
    const generic = candidate("Generic mouse");
    const assessment = (options: {
      listingId: string;
      criterionId: string;
      status: "meets" | "conflicts" | "uncertain";
      explanation: string;
    }) =>
      criterionAssessmentV1Schema.parse({
        schemaVersion: 1,
        id: randomUUID(),
        researchRunId: randomUUID(),
        taskId,
        taskRevision: 3n,
        candidateRunId: runId,
        candidateListingId: options.listingId,
        criterionId: options.criterionId,
        status: options.status,
        relation:
          options.status === "meets"
            ? "source_support"
            : options.status === "conflicts"
              ? "source_conflict"
              : "insufficient_evidence",
        explanation: options.explanation,
        method: "deterministic",
        model: null,
        promptVersion: null,
        observationIds: [],
        createdAt: new Date("2026-01-01T00:00:01Z"),
      });
    const verifiedAssessments = [
      assessment({
        listingId: verified.id,
        criterionId: hardCriterionId,
        status: "meets",
        explanation: "Battery life is supported by current evidence.",
      }),
      assessment({
        listingId: verified.id,
        criterionId: preferenceCriterionId,
        status: "uncertain",
        explanation: "Colour has not been verified.",
      }),
    ];
    const genericAssessments = [
      assessment({
        listingId: generic.id,
        criterionId: hardCriterionId,
        status: "uncertain",
        explanation: "Battery life remains unknown.",
      }),
      assessment({
        listingId: generic.id,
        criterionId: preferenceCriterionId,
        status: "meets",
        explanation: "The preferred colour is supported.",
      }),
    ];
    const support = {
      brief,
      researchRuns: [],
      deepResearchCoverage: [],
      candidates: [generic, verified],
      sources: [],
      observations: [],
      assessments: [...genericAssessments, ...verifiedAssessments],
    };
    const result = buildDecisionSupport({
      support,
      savedListingIds: new Set(),
    });
    expect(result.topOptions.map(({ listing }) => listing.id)).toEqual([
      verified.id,
      generic.id,
    ]);
    expect(result.topOptions[0]).toMatchObject({
      readiness: "qualified",
      strongestSupported: true,
      supportedMustHaveCount: 1,
      mustHaveCount: 1,
      unknowns: [
        expect.objectContaining({
          criterionId: preferenceCriterionId,
          label: "Colour",
          reason: "not_checked",
          explanation: "Colour has not been verified.",
        }),
      ],
    });
    expect(result.topOptions[1]).toMatchObject({
      readiness: "needs_verification",
      strongestSupported: false,
      unresolvedMustHaves: [expect.objectContaining({ label: "Battery life" })],
    });
    expect(genericAssessments[0]!.status).toBe("uncertain");

    const compared = buildDecisionSupport({
      support,
      savedListingIds: new Set([verified.id, generic.id]),
    });
    expect(compared.comparison?.purchaseSummaries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ candidateListingId: verified.id }),
        expect.objectContaining({ candidateListingId: generic.id }),
      ]),
    );
    expect(compared.comparison?.researchStates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          candidateListingId: verified.id,
          state: "available",
        }),
        expect.objectContaining({
          candidateListingId: generic.id,
          state: "available",
        }),
      ]),
    );
    expect(compared.comparison?.decisionGaps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Battery life", strength: "hard" }),
      ]),
    );
    expect(compared.comparison?.judgement).toContain(
      "Verified mouse has stronger support on Battery life",
    );
    expect(compared.comparison?.judgement).toContain(
      "Generic mouse has stronger support on Colour",
    );

    const allUnknown = buildDecisionSupport({
      support: {
        ...support,
        candidates: [generic],
        assessments: genericAssessments,
      },
      savedListingIds: new Set(),
    });
    expect(allUnknown.sectionMode).toBe("verification_needed");
    expect(allUnknown.topOptions[0]).toMatchObject({
      readiness: "needs_verification",
      strongestSupported: false,
    });
    expect(allUnknown.decisionGaps[0]).toMatchObject({
      label: "Battery life",
      strength: "hard",
    });
    expect(JSON.stringify(allUnknown)).not.toMatch(/\d+(?:\.\d+)?%|\/10/);

    const checkedButStillUnknown = buildDecisionSupport({
      support: {
        ...support,
        candidates: [verified],
        assessments: verifiedAssessments,
        deepResearchCoverage: [
          {
            researchRunId: evidenceResearchRunIdSchema.parse(randomUUID()),
            candidateListingId: verified.id,
            runStatus: "succeeded",
            status: "succeeded",
            criterionIds: [brief.items[1]!.criterionId],
            checkedSourcesByCriterion: [
              {
                criterionId: brief.items[1]!.criterionId,
                sourceIds: [],
              },
            ],
          },
        ],
      },
      savedListingIds: new Set(),
    });
    expect(checkedButStillUnknown.topOptions[0]?.researchState).toBe(
      "complete",
    );
    expect(checkedButStillUnknown.topOptions[0]?.unknowns).toEqual([
      expect.objectContaining({
        criterionId: preferenceCriterionId,
        reason: "not_checked",
      }),
    ]);

    const checkedRunId = evidenceResearchRunIdSchema.parse(randomUUID());
    const checkedSource = evidenceSourceV1Schema.parse({
      schemaVersion: 1,
      id: randomUUID(),
      researchRunId: checkedRunId,
      taskId,
      candidateRunId: runId,
      candidateListingId: verified.id,
      acquisitionAttemptId: randomUUID(),
      sourceRole: "manufacturer",
      sourceKind: "fetched_page",
      sourceUrl: "https://example.test/verified-mouse",
      sourceTitle: "Verified mouse product page",
      excerpt: "The exact page did not state a colour.",
      provider: "page_fetch",
      providerResultId: "verified-mouse",
      observedAt: new Date("2026-01-01T00:00:00Z"),
      fingerprint: "a".repeat(64),
    });
    const checkedSoftUnknown = buildDecisionSupport({
      support: {
        ...support,
        candidates: [verified],
        assessments: verifiedAssessments,
        sources: [checkedSource],
        deepResearchCoverage: [
          {
            researchRunId: checkedRunId,
            candidateListingId: verified.id,
            runStatus: "succeeded",
            status: "succeeded",
            criterionIds: [brief.items[1]!.criterionId],
            checkedSourcesByCriterion: [
              {
                criterionId: brief.items[1]!.criterionId,
                sourceIds: [checkedSource.id],
              },
            ],
          },
        ],
      },
      savedListingIds: new Set(),
    });
    expect(checkedSoftUnknown.topOptions[0]).toMatchObject({
      unknowns: [
        expect.objectContaining({
          criterionId: preferenceCriterionId,
          reason: "checked_no_answer",
        }),
      ],
      evidenceSources: [
        expect.objectContaining({
          url: checkedSource.sourceUrl,
          depth: "fetched_page",
        }),
      ],
    });

    const additionalPreferenceIds = [randomUUID(), randomUUID()];
    const manyUnknownsBrief = shoppingBriefV1Schema.parse({
      ...brief,
      items: [
        ...brief.items,
        ...additionalPreferenceIds.map((criterionId, index) => ({
          criterionId,
          lineageId: randomUUID(),
          conceptId: randomUUID(),
          conceptLabel: `Preference ${index + 2}`,
          conceptDefinition: "A preference that exact sources may not answer",
          strength: "preference" as const,
          targetSemantics: "qualitative" as const,
          semanticValue: {
            schemaVersion: 1 as const,
            kind: "qualitative" as const,
            mode: "text" as const,
            text: `preference ${index + 2}`,
          },
        })),
      ],
    });
    const citedRunId = evidenceResearchRunIdSchema.parse(randomUUID());
    const citedSources = Array.from({ length: 5 }, (_, index) =>
      evidenceSourceV1Schema.parse({
        schemaVersion: 1,
        id: randomUUID(),
        researchRunId: citedRunId,
        taskId,
        candidateRunId: runId,
        candidateListingId: verified.id,
        acquisitionAttemptId: randomUUID(),
        sourceRole: "manufacturer",
        sourceKind: "fetched_page",
        sourceUrl: `https://example.test/cited-${index}`,
        sourceTitle: `Earlier cited page ${index}`,
        excerpt: `Earlier cited fact ${index}`,
        provider: "page_fetch",
        providerResultId: `cited-${index}`,
        observedAt: new Date("2026-01-01T00:00:00Z"),
        fingerprint: (index + 1).toString(16).repeat(64),
      }),
    );
    const citedObservations = citedSources.map((source, index) =>
      productObservationV1Schema.parse({
        schemaVersion: 1,
        id: randomUUID(),
        researchRunId: citedRunId,
        taskId,
        candidateRunId: runId,
        candidateListingId: verified.id,
        evidenceSourceId: source.id,
        conceptId: manyUnknownsBrief.items[0]!.conceptId,
        support: "supported",
        observationKind: "source_assertion",
        propertyLabel: `Earlier fact ${index}`,
        claim: `Earlier fact ${index} is supported`,
        value: {
          schemaVersion: 1,
          kind: "text",
          text: `Earlier fact ${index}`,
        },
        derivation: "model_text",
        model: "fixture",
        promptVersion: "fixture-v1",
        observedAt: new Date("2026-01-01T00:00:00Z"),
        fingerprint: (index + 6).toString(16).repeat(64),
      }),
    );
    const hardAssessmentWithCitations = criterionAssessmentV1Schema.parse({
      ...verifiedAssessments[0]!,
      id: randomUUID(),
      researchRunId: citedRunId,
      observationIds: citedObservations.map(({ id }) => id),
    });
    const unknownCriterionIds = manyUnknownsBrief.items
      .slice(1)
      .map(({ criterionId }) => criterionId);
    const checkedRunWithManySources =
      evidenceResearchRunIdSchema.parse(randomUUID());
    const representativeSources = unknownCriterionIds.map(
      (criterionId, index) =>
        evidenceSourceV1Schema.parse({
          schemaVersion: 1,
          id: randomUUID(),
          researchRunId: checkedRunWithManySources,
          taskId,
          candidateRunId: runId,
          candidateListingId: verified.id,
          acquisitionAttemptId: randomUUID(),
          sourceRole: "retailer",
          sourceKind: "fetched_page",
          sourceUrl: `https://example.test/checked-${index}`,
          sourceTitle: `Checked page for ${criterionId}`,
          excerpt: "The exact page did not answer this preference.",
          provider: "page_fetch",
          providerResultId: `checked-${index}`,
          observedAt: new Date("2026-01-01T00:01:00Z"),
          fingerprint: ["b", "c", "d"][index]!.repeat(64),
        }),
    );
    const prioritizedCheckedSources = buildDecisionSupport({
      support: {
        brief: manyUnknownsBrief,
        researchRuns: [],
        candidates: [verified],
        sources: [...citedSources, ...representativeSources],
        observations: citedObservations,
        assessments: [
          hardAssessmentWithCitations,
          verifiedAssessments[1]!,
          ...additionalPreferenceIds.map((criterionId, index) =>
            assessment({
              listingId: verified.id,
              criterionId,
              status: "uncertain",
              explanation: `Preference ${index + 2} remains unknown.`,
            }),
          ),
        ],
        deepResearchCoverage: [
          {
            researchRunId: checkedRunWithManySources,
            candidateListingId: verified.id,
            runStatus: "succeeded",
            status: "succeeded",
            criterionIds: unknownCriterionIds,
            checkedSourcesByCriterion: unknownCriterionIds.map(
              (criterionId, index) => ({
                criterionId,
                sourceIds: [representativeSources[index]!.id],
              }),
            ),
          },
        ],
      },
      savedListingIds: new Set(),
    });
    const visibleSourceUrls = new Set(
      prioritizedCheckedSources.topOptions[0]?.evidenceSources.map(
        ({ url }) => url,
      ),
    );
    for (const source of representativeSources) {
      expect(visibleSourceUrls).toContain(source.sourceUrl);
    }

    const failedSoftCheck = buildDecisionSupport({
      support: {
        ...support,
        candidates: [verified],
        assessments: verifiedAssessments,
        deepResearchCoverage: [
          {
            researchRunId: evidenceResearchRunIdSchema.parse(randomUUID()),
            candidateListingId: verified.id,
            runStatus: "failed",
            status: "failed",
            criterionIds: [brief.items[1]!.criterionId],
            checkedSourcesByCriterion: [
              {
                criterionId: brief.items[1]!.criterionId,
                sourceIds: [],
              },
            ],
          },
        ],
      },
      savedListingIds: new Set(),
    });
    expect(failedSoftCheck.topOptions[0]?.unknowns).toEqual([
      expect.objectContaining({
        criterionId: preferenceCriterionId,
        reason: "check_failed",
      }),
    ]);
  });

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
            phase: "first_pass",
            status: "succeeded",
            selectedCandidateCount: 1,
            plannedSearchCount: 2,
            startedAt: new Date("2026-01-01T00:00:00Z"),
            finishedAt: new Date("2026-01-01T00:00:01Z"),
          },
        ],
        deepResearchCoverage: [],
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
        deepResearchCoverage: [],
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
          deepResearchCoverage: [],
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
        deepResearchCoverage: [],
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
        deepResearchCoverage: [],
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
        deepResearchCoverage: [],
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
        deepResearchCoverage: [],
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

  it("uses only the purchase-price criterion in saved purchase summaries", () => {
    const taskId = shoppingTaskIdSchema.parse(randomUUID());
    const runId = searchRunIdSchema.parse(randomUUID());
    const deliveryCriterionId = randomUUID();
    const runningCostCriterionId = randomUUID();
    const budgetCriterionId = randomUUID();
    const candidates = ["Chair one", "Chair two"].map((title, index) =>
      persistedCandidateListingSchema.parse({
        id: randomUUID(),
        taskId,
        runId,
        queryId: randomUUID(),
        queryExecutionId: randomUUID(),
        provider: "fixture",
        providerResultId: `chair-${index}`,
        sourceRank: index + 1,
        surface: "shopping",
        title,
        url: `https://example.test/chair-${index}`,
        canonicalUrl: `https://example.test/chair-${index}`,
        merchantDestinationUrl: null,
        merchantDestinationSource: null,
        merchant: "Example",
        price: { amountMinor: 24_000 + index * 1_000, currency: "GBP" },
        priceText: `£${240 + index * 10}`,
        imageUrl: null,
        deliveryText: "£5 delivery",
        availabilityText: null,
        reviewEvidence: null,
        retrievedAt: new Date("2026-01-01T00:00:00Z"),
      }),
    );
    const moneyItem = (
      criterionId: string,
      label: string,
      amountMinor: number,
    ) => ({
      criterionId,
      lineageId: randomUUID(),
      conceptId: randomUUID(),
      conceptLabel: label,
      conceptDefinition: label,
      strength: "preference" as const,
      targetSemantics: "exact" as const,
      semanticValue: {
        schemaVersion: 1 as const,
        kind: "money" as const,
        mode: "ceiling" as const,
        amountMinor,
        currency: "GBP" as const,
      },
    });
    const deliveryItem = moneyItem(deliveryCriterionId, "Delivery cost", 2_000);
    const runningCostItem = moneyItem(
      runningCostCriterionId,
      "Annual running cost",
      5_000,
    );
    const budgetItem = moneyItem(budgetCriterionId, "Purchase budget", 25_000);
    const brief = shoppingBriefV1Schema.parse({
      schemaVersion: 1,
      taskId,
      revision: 1n,
      market: { country: "GB", language: "en-GB", currency: "GBP" },
      items: [deliveryItem, budgetItem],
    });
    const assessment = (
      candidateListingId: string,
      criterionId: string,
      explanation: string,
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
        status: "meets",
        relation: "within_ceiling",
        explanation,
        method: "deterministic",
        model: null,
        promptVersion: null,
        observationIds: [],
        createdAt: new Date("2026-01-01T00:00:01Z"),
      });
    const assessments = candidates.flatMap((candidate, index) => [
      assessment(candidate.id, deliveryCriterionId, "Delivery costs £5."),
      assessment(
        candidate.id,
        budgetCriterionId,
        `£${240 + index * 10} is within the £250 purchase budget.`,
      ),
    ]);
    const support = {
      brief,
      researchRuns: [],
      deepResearchCoverage: [],
      candidates,
      sources: [],
      observations: [],
      assessments,
    };
    const compared = buildDecisionSupport({
      support,
      savedListingIds: new Set(candidates.map(({ id }) => id)),
    });
    expect(
      compared.comparison?.purchaseSummaries.map(
        ({ priceRelationship }) => priceRelationship,
      ),
    ).toEqual(
      expect.arrayContaining([
        "£240 is within the £250 purchase budget.",
        "£250 is within the £250 purchase budget.",
      ]),
    );

    const deliveryOnly = buildDecisionSupport({
      support: {
        ...support,
        brief: shoppingBriefV1Schema.parse({
          ...brief,
          items: [deliveryItem, runningCostItem],
        }),
        assessments: assessments.filter(
          ({ criterionId }) => criterionId === deliveryCriterionId,
        ),
      },
      savedListingIds: new Set(candidates.map(({ id }) => id)),
    });
    expect(
      deliveryOnly.comparison?.purchaseSummaries.map(
        ({ priceRelationship }) => priceRelationship,
      ),
    ).toEqual([
      "No purchase-price target is stated in the current brief.",
      "No purchase-price target is stated in the current brief.",
    ]);

    const purchaseTargetWithoutAssessment = buildDecisionSupport({
      support: {
        ...support,
        assessments: assessments.filter(
          ({ criterionId }) => criterionId === deliveryCriterionId,
        ),
      },
      savedListingIds: new Set(candidates.map(({ id }) => id)),
    });
    expect(
      purchaseTargetWithoutAssessment.comparison?.purchaseSummaries.map(
        ({ priceRelationship }) => priceRelationship,
      ),
    ).toEqual([
      "Its observed purchase price has not been related to the stated purchase-price target.",
      "Its observed purchase price has not been related to the stated purchase-price target.",
    ]);

    const ambiguousPurchaseTargets = buildDecisionSupport({
      support: {
        ...support,
        brief: shoppingBriefV1Schema.parse({
          ...brief,
          items: [
            budgetItem,
            moneyItem(randomUUID(), "Maximum purchase price", 30_000),
          ],
        }),
      },
      savedListingIds: new Set(candidates.map(({ id }) => id)),
    });
    expect(
      ambiguousPurchaseTargets.comparison?.purchaseSummaries.map(
        ({ priceRelationship }) => priceRelationship,
      ),
    ).toEqual([
      "Multiple purchase-price targets are stated, so no single purchase summary is assumed.",
      "Multiple purchase-price targets are stated, so no single purchase summary is assumed.",
    ]);
  });

  it("projects running, partial and failed research without discarding useful work", () => {
    const taskId = shoppingTaskIdSchema.parse(randomUUID());
    const runId = searchRunIdSchema.parse(randomUUID());
    const criterionId = randomUUID();
    const candidate = persistedCandidateListingSchema.parse({
      id: randomUUID(),
      taskId,
      runId,
      queryId: randomUUID(),
      queryExecutionId: randomUUID(),
      provider: "fixture",
      providerResultId: "candidate",
      sourceRank: 1,
      surface: "shopping",
      title: "Candidate",
      url: "https://example.test/candidate",
      canonicalUrl: "https://example.test/candidate",
      merchantDestinationUrl: null,
      merchantDestinationSource: null,
      merchant: "Example",
      price: null,
      priceText: null,
      imageUrl: null,
      deliveryText: null,
      availabilityText: null,
      reviewEvidence: null,
      retrievedAt: new Date("2026-01-01T00:00:00Z"),
    });
    const brief = shoppingBriefV1Schema.parse({
      schemaVersion: 1,
      taskId,
      revision: 1n,
      market: { country: "GB", language: "en-GB", currency: "GBP" },
      items: [
        {
          criterionId,
          lineageId: randomUUID(),
          conceptId: randomUUID(),
          conceptLabel: "Battery life",
          conceptDefinition: "Battery life",
          strength: "hard",
          targetSemantics: "qualitative",
          semanticValue: {
            schemaVersion: 1,
            kind: "qualitative",
            mode: "text",
            text: "long battery life",
          },
        },
      ],
    });
    const currentAssessment = criterionAssessmentV1Schema.parse({
      schemaVersion: 1,
      id: randomUUID(),
      researchRunId: randomUUID(),
      taskId,
      taskRevision: 1n,
      candidateRunId: runId,
      candidateListingId: candidate.id,
      criterionId,
      status: "uncertain",
      relation: "insufficient_evidence",
      explanation: "Battery life remains unknown.",
      method: "deterministic",
      model: null,
      promptVersion: null,
      observationIds: [],
      createdAt: new Date("2026-01-01T00:00:01Z"),
    });
    const run = (
      phase: "first_pass" | "deepening",
      status: "running" | "succeeded" | "partial" | "failed",
    ) => ({
      id: evidenceResearchRunIdSchema.parse(randomUUID()),
      taskId,
      searchRunId: runId,
      taskRevision: 1n,
      policyVersion: `evidence-${phase}-${randomUUID()}`,
      phase,
      status,
      selectedCandidateCount: 1,
      plannedSearchCount: 1,
      startedAt: new Date("2026-01-01T00:00:00Z"),
      finishedAt:
        status === "running" ? null : new Date("2026-01-01T00:00:02Z"),
    });
    const decide = (
      researchRuns: ReturnType<typeof run>[],
      assessments = [currentAssessment],
    ) =>
      buildDecisionSupport({
        support: {
          brief,
          researchRuns,
          deepResearchCoverage: [],
          candidates: [candidate],
          sources: [],
          observations: [],
          assessments,
        },
        savedListingIds: new Set(),
      });

    expect(decide([run("first_pass", "running")]).researchStatus).toBe(
      "researching",
    );
    expect(decide([run("first_pass", "running")], []).researchStatus).toBe(
      "researching",
    );
    expect(decide([run("first_pass", "partial")]).researchStatus).toBe(
      "partial",
    );
    expect(
      decide([run("first_pass", "succeeded"), run("first_pass", "failed")], [])
        .researchStatus,
    ).toBe("partial");
    expect(decide([run("first_pass", "failed")], []).researchStatus).toBe(
      "failed",
    );
    const failedFirstPassWithDirectEvidence = run("first_pass", "failed");
    expect(
      decide(
        [failedFirstPassWithDirectEvidence],
        [
          criterionAssessmentV1Schema.parse({
            ...currentAssessment,
            id: randomUUID(),
            researchRunId: failedFirstPassWithDirectEvidence.id,
          }),
        ],
      ).researchStatus,
    ).toBe("failed");
    expect(
      decide(
        [failedFirstPassWithDirectEvidence],
        [
          criterionAssessmentV1Schema.parse({
            ...currentAssessment,
            id: randomUUID(),
            researchRunId: failedFirstPassWithDirectEvidence.id,
            observationIds: [randomUUID()],
          }),
        ],
      ).researchStatus,
    ).toBe("partial");
    expect(
      decide([run("first_pass", "succeeded"), run("deepening", "partial")])
        .deepResearchStatus,
    ).toBe("partial");
    expect(
      decide([
        run("first_pass", "succeeded"),
        run("deepening", "succeeded"),
        run("deepening", "partial"),
      ]).deepResearchStatus,
    ).toBe("partial");
    expect(
      decide([run("first_pass", "succeeded"), run("deepening", "failed")])
        .deepResearchStatus,
    ).toBe("failed");
    const failedDeepWithDirectEvidence = run("deepening", "failed");
    expect(
      decide(
        [run("first_pass", "succeeded"), failedDeepWithDirectEvidence],
        [
          criterionAssessmentV1Schema.parse({
            ...currentAssessment,
            id: randomUUID(),
            researchRunId: failedDeepWithDirectEvidence.id,
            observationIds: [randomUUID()],
          }),
        ],
      ).deepResearchStatus,
    ).toBe("partial");
    expect(
      decide([run("first_pass", "succeeded"), run("deepening", "running")])
        .deepResearchStatus,
    ).toBe("researching");
    const resolvedAssessment = criterionAssessmentV1Schema.parse({
      ...currentAssessment,
      id: randomUUID(),
      status: "meets",
      relation: "direct_match",
      explanation: "Battery life is supported.",
    });
    expect(
      decide(
        [run("first_pass", "succeeded"), run("deepening", "running")],
        [resolvedAssessment],
      ).deepResearchStatus,
    ).toBe("researching");
  });
});
