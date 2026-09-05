import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  shoppingBriefV1Schema,
  type ShoppingBriefV1,
} from "@/domain/shopping-state/brief";
import {
  shoppingTaskIdSchema,
  type CandidateListingId,
} from "@/domain/shopping-state/ids";
import { persistedCandidateListingSchema } from "@/features/retrieval-spike/persistence/contracts";
import {
  criterionAssessmentV1Schema,
  type CriterionAssessmentV1,
} from "./contracts";
import {
  buildDecisionSupport,
  synthesizeCurrentDecision,
} from "./decision-support";
import type { CurrentDecisionSupport } from "./persistence";
import {
  V0_09_PRODUCT_ENGINE_CASES,
  type ProductEngineFixture,
} from "../../../scripts/support/v0-09-product-engine-cases";

type CriterionSeed = Readonly<{
  label: string;
  strength: "hard" | "strong_preference" | "preference";
}>;

function briefFromSeeds(
  criteria: readonly CriterionSeed[],
  options?: { taskId?: string; revision?: bigint },
) {
  return shoppingBriefV1Schema.parse({
    schemaVersion: 1,
    taskId: options?.taskId ?? randomUUID(),
    revision: options?.revision ?? 1n,
    market: { country: "GB", language: "en-GB", currency: "GBP" },
    items: criteria.map((criterion) => ({
      criterionId: randomUUID(),
      lineageId: randomUUID(),
      conceptId: randomUUID(),
      conceptLabel: criterion.label,
      conceptDefinition: `${criterion.label} for this purchase`,
      strength: criterion.strength,
      targetSemantics: "qualitative" as const,
      semanticValue: {
        schemaVersion: 1,
        kind: "qualitative" as const,
        mode: "text" as const,
        text: `good ${criterion.label.toLocaleLowerCase("en-GB")}`,
      },
    })),
  });
}

function briefFromFounderFixture(options: {
  fixture: ProductEngineFixture;
  taskId?: string;
  revision?: bigint;
  applyMouseRefinement?: boolean;
}) {
  const criteria = options.fixture.criteria.map((criterion) =>
    options.applyMouseRefinement &&
    criterion.localRef === options.fixture.refinement?.replaceLocalRef
      ? {
          ...criterion,
          strength: options.fixture.refinement.replacement.strength,
          targetSemantics:
            options.fixture.refinement.replacement.targetSemantics,
          semanticValue: options.fixture.refinement.replacement.semanticValue,
        }
      : criterion,
  );
  if (
    options.applyMouseRefinement &&
    options.fixture.refinement !== undefined
  ) {
    criteria.push(options.fixture.refinement.add);
  }
  return shoppingBriefV1Schema.parse({
    schemaVersion: 1,
    taskId: options.taskId ?? randomUUID(),
    revision: options.revision ?? 1n,
    market: { country: "GB", language: "en-GB", currency: "GBP" },
    items: criteria.map((criterion) => ({
      criterionId: randomUUID(),
      lineageId: randomUUID(),
      conceptId: randomUUID(),
      conceptLabel: criterion.label,
      conceptDefinition: criterion.definition,
      strength: criterion.strength,
      targetSemantics: criterion.targetSemantics,
      semanticValue: criterion.semanticValue,
    })),
  });
}

function listing(brief: ShoppingBriefV1, title: string, rank = 1) {
  return persistedCandidateListingSchema.parse({
    id: randomUUID(),
    taskId: brief.taskId,
    runId: randomUUID(),
    queryId: randomUUID(),
    queryExecutionId: randomUUID(),
    provider: "fixture",
    providerResultId: randomUUID(),
    sourceRank: rank,
    surface: "shopping",
    title,
    url: `https://shopping.example/${encodeURIComponent(title)}`,
    canonicalUrl: `https://shopping.example/${encodeURIComponent(title)}`,
    merchantDestinationUrl: null,
    merchantDestinationSource: null,
    merchant: "Fixture retailer",
    price: { amountMinor: 4_000 + rank, currency: "GBP" },
    priceText: `£${40 + rank}`,
    imageUrl: null,
    deliveryText: null,
    availabilityText: null,
    reviewEvidence: null,
    retrievedAt: new Date("2026-09-01T10:00:00.000Z"),
  });
}

function assessment(options: {
  brief: ShoppingBriefV1;
  listingId: CandidateListingId;
  label: string;
  status: CriterionAssessmentV1["status"];
  revision?: bigint;
  relation?: string;
}) {
  const item = options.brief.items.find(
    ({ conceptLabel }) => conceptLabel === options.label,
  );
  if (item === undefined) throw new Error(`Unknown criterion ${options.label}`);
  return criterionAssessmentV1Schema.parse({
    schemaVersion: 1,
    id: randomUUID(),
    researchRunId: randomUUID(),
    taskId: options.brief.taskId,
    taskRevision: options.revision ?? options.brief.revision,
    candidateRunId: randomUUID(),
    candidateListingId: options.listingId,
    criterionId: item.criterionId,
    status: options.status,
    relation:
      options.relation ??
      (options.status === "meets"
        ? "source_support"
        : options.status === "conflicts"
          ? "source_conflict"
          : "insufficient_evidence"),
    explanation: `${options.label} is ${
      options.status === "meets"
        ? "supported"
        : options.status === "conflicts"
          ? "in conflict"
          : "still unknown"
    } for this exact product.`,
    method: "deterministic",
    model: null,
    promptVersion: null,
    observationIds: [],
    createdAt: new Date("2026-09-01T10:00:01.000Z"),
  });
}

function profile(options: {
  brief: ShoppingBriefV1;
  listingId: CandidateListingId;
  statuses: Readonly<
    Record<
      string,
      | CriterionAssessmentV1["status"]
      | Readonly<{
          status: CriterionAssessmentV1["status"];
          relation: string;
        }>
    >
  >;
  defaultStatus?: CriterionAssessmentV1["status"];
  revision?: bigint;
}) {
  return options.brief.items.map((item) => {
    const configured = options.statuses[item.conceptLabel];
    return assessment({
      brief: options.brief,
      listingId: options.listingId,
      label: item.conceptLabel,
      status:
        typeof configured === "string"
          ? configured
          : (configured?.status ?? options.defaultStatus ?? "uncertain"),
      ...(typeof configured !== "string" && configured?.relation !== undefined
        ? { relation: configured.relation }
        : {}),
      ...(options.revision === undefined ? {} : { revision: options.revision }),
    });
  });
}

function project(options: {
  brief: ShoppingBriefV1;
  candidates: readonly ReturnType<typeof listing>[];
  assessments: readonly CriterionAssessmentV1[];
  rejectedIds?: readonly CandidateListingId[];
}) {
  const support = {
    brief: options.brief,
    researchRuns: [],
    deepResearchCoverage: [],
    candidates: options.candidates,
    sources: [],
    observations: [],
    assessments: options.assessments,
  } satisfies CurrentDecisionSupport;
  return buildDecisionSupport({
    support,
    savedListingIds: new Set(),
    rejectedListingIds: new Set(options.rejectedIds ?? []),
  });
}

describe("deterministic Current Decision synthesis", () => {
  it("keeps an evidenced lead provisional while research is still running", () => {
    const brief = briefFromSeeds([
      { label: "Comfort", strength: "strong_preference" },
    ]);
    const leader = listing(brief, "Early evidence leader");
    const challenger = listing(brief, "Still researching", 2);
    const assessments = [
      ...profile({
        brief,
        listingId: leader.id,
        statuses: { Comfort: "meets" },
      }),
      ...profile({
        brief,
        listingId: challenger.id,
        statuses: { Comfort: "uncertain" },
      }),
    ];
    const base = project({
      brief,
      candidates: [leader, challenger],
      assessments,
    });
    const decision = base.currentDecision;
    const researching = synthesizeCurrentDecision({
      items: brief.items,
      candidates: base.topOptions,
      assessments,
      decisionGaps: base.decisionGaps,
      researchStatus: "researching",
      assessedCandidateCount: 2,
      eligibleCandidateCount: 2,
    });
    expect(decision.state).toBe("ready_to_choose");
    expect(researching).toMatchObject({
      state: "researching",
      recommendationLevel: "provisional",
      leadingCandidateListingId: leader.id,
    });
  });

  it("recommends one qualified leader only when an important criterion separates it", () => {
    const brief = briefFromSeeds([{ label: "Comfort", strength: "hard" }]);
    const leader = listing(brief, "Comfort leader");
    const challenger = listing(brief, "Unverified challenger", 2);
    const result = project({
      brief,
      candidates: [challenger, leader],
      assessments: [
        ...profile({
          brief,
          listingId: leader.id,
          statuses: { Comfort: "meets" },
        }),
        ...profile({
          brief,
          listingId: challenger.id,
          statuses: { Comfort: "uncertain" },
        }),
      ],
    });

    expect(result.currentDecision).toMatchObject({
      state: "ready_to_choose",
      recommendationLevel: "ready",
      leadingCandidateListingId: leader.id,
      recommendationBasis: "meaningful_criterion_separation",
    });
  });

  it("keeps a leader provisional while a must-have is unresolved", () => {
    const brief = briefFromSeeds([
      { label: "Battery life", strength: "hard" },
      { label: "Comfort", strength: "strong_preference" },
    ]);
    const leader = listing(brief, "Provisional leader");
    const challenger = listing(brief, "Less-supported option", 2);
    const result = project({
      brief,
      candidates: [challenger, leader],
      assessments: [
        ...profile({
          brief,
          listingId: leader.id,
          statuses: { "Battery life": "uncertain", Comfort: "meets" },
        }),
        ...profile({
          brief,
          listingId: challenger.id,
          statuses: {
            "Battery life": "uncertain",
            Comfort: "uncertain",
          },
        }),
      ],
    });

    expect(result.currentDecision).toMatchObject({
      state: "leader_needs_verification",
      recommendationLevel: "provisional",
      leadingCandidateListingId: leader.id,
      blockingGap: expect.objectContaining({ label: "Battery life" }),
    });
  });

  it("states a softer evidenced compromise without turning it into ineligibility", () => {
    const brief = briefFromSeeds([
      { label: "Maximum price", strength: "hard" },
      { label: "Low weight", strength: "preference" },
    ]);
    const leader = listing(brief, "Heavier clear leader");
    const challenger = listing(brief, "Unverified challenger", 2);
    const result = project({
      brief,
      candidates: [challenger, leader],
      assessments: [
        ...profile({
          brief,
          listingId: leader.id,
          statuses: { "Maximum price": "meets", "Low weight": "conflicts" },
        }),
        ...profile({
          brief,
          listingId: challenger.id,
          statuses: {
            "Maximum price": "uncertain",
            "Low weight": "meets",
          },
        }),
      ],
    });

    expect(result.currentDecision).toMatchObject({
      state: "leader_with_tradeoff",
      recommendationLevel: "ready",
      keyTradeoff: expect.objectContaining({ label: "Low weight" }),
    });
  });

  it("does not invent a winner for equivalent evidence profiles", () => {
    const brief = briefFromSeeds([{ label: "Comfort", strength: "hard" }]);
    const first = listing(brief, "First provider row");
    const second = listing(brief, "Second provider row", 2);
    const result = project({
      brief,
      candidates: [first, second],
      assessments: [
        ...profile({
          brief,
          listingId: first.id,
          statuses: { Comfort: "meets" },
        }),
        ...profile({
          brief,
          listingId: second.id,
          statuses: { Comfort: "meets" },
        }),
      ],
    });

    expect(result.currentDecision).toMatchObject({
      state: "no_clear_winner",
      recommendationLevel: "none",
      leadingCandidateListingId: null,
      recommendationBasis: "equivalent_evidence",
    });
  });

  it("reports insufficient evidence when no current candidate has an assessment", () => {
    const brief = briefFromSeeds([{ label: "Comfort", strength: "hard" }]);
    const result = project({ brief, candidates: [], assessments: [] });
    expect(result.currentDecision).toMatchObject({
      state: "insufficient_evidence",
      recommendationLevel: "none",
      leadingCandidateListingId: null,
    });
  });

  it("reports no eligible option when every assessed candidate conflicts with a hard boundary", () => {
    const brief = briefFromSeeds([
      { label: "Maximum width", strength: "hard" },
    ]);
    const tooWide = listing(brief, "Too-wide machine");
    const result = project({
      brief,
      candidates: [tooWide],
      assessments: profile({
        brief,
        listingId: tooWide.id,
        statuses: { "Maximum width": "conflicts" },
      }),
    });
    expect(result.currentDecision).toMatchObject({
      state: "no_eligible_option",
      recommendationLevel: "none",
      leadingCandidateListingId: null,
    });
  });

  it("lets a strong preference outrank an ordinary preference without a scalar score", () => {
    const brief = briefFromSeeds([
      { label: "Long-session comfort", strength: "strong_preference" },
      { label: "Low weight", strength: "preference" },
    ]);
    const strong = listing(brief, "Strong-preference leader", 2);
    const weak = listing(brief, "Weak-preference leader", 1);
    const result = project({
      brief,
      candidates: [weak, strong],
      assessments: [
        ...profile({
          brief,
          listingId: strong.id,
          statuses: {
            "Long-session comfort": "meets",
            "Low weight": "uncertain",
          },
        }),
        ...profile({
          brief,
          listingId: weak.id,
          statuses: {
            "Long-session comfort": "uncertain",
            "Low weight": "meets",
          },
        }),
      ],
    });
    expect(result.currentDecision.leadingCandidateListingId).toBe(strong.id);
    expect(result.currentDecision.keyReasons[0]?.label).toBe(
      "Long-session comfort",
    );
  });

  it("does not let several weak wins become a majority vote over one strong win", () => {
    const brief = briefFromSeeds([
      { label: "Long-session comfort", strength: "strong_preference" },
      { label: "Colour", strength: "preference" },
      { label: "Packaging", strength: "preference" },
      { label: "Small accessory", strength: "preference" },
    ]);
    const strong = listing(brief, "Strong criterion product", 2);
    const manyWeak = listing(brief, "Three weak wins", 1);
    const result = project({
      brief,
      candidates: [manyWeak, strong],
      assessments: [
        ...profile({
          brief,
          listingId: strong.id,
          statuses: {
            "Long-session comfort": "meets",
            Colour: "uncertain",
            Packaging: "uncertain",
            "Small accessory": "uncertain",
          },
        }),
        ...profile({
          brief,
          listingId: manyWeak.id,
          statuses: {
            "Long-session comfort": "uncertain",
            Colour: "meets",
            Packaging: "meets",
            "Small accessory": "meets",
          },
        }),
      ],
    });
    expect(result.currentDecision.leadingCandidateListingId).toBe(strong.id);
  });

  it("never converts provider rank or input order into a recommendation", () => {
    const brief = briefFromSeeds([
      { label: "Comfort", strength: "preference" },
    ]);
    const rankedFirst = listing(brief, "Provider rank one", 1);
    const rankedSecond = listing(brief, "Provider rank two", 2);
    const result = project({
      brief,
      candidates: [rankedFirst, rankedSecond],
      assessments: [
        ...profile({
          brief,
          listingId: rankedFirst.id,
          statuses: { Comfort: "meets" },
        }),
        ...profile({
          brief,
          listingId: rankedSecond.id,
          statuses: { Comfort: "meets" },
        }),
      ],
    });
    expect(result.currentDecision.state).toBe("no_clear_winner");
    expect(result.currentDecision.leadingCandidateListingId).toBeNull();
  });

  it("does not recommend a sole candidate when its only support is review popularity", () => {
    const brief = briefFromSeeds([
      { label: "Customer reviews", strength: "strong_preference" },
    ]);
    const popular = listing(brief, "Popular but otherwise unproven");
    const result = project({
      brief,
      candidates: [popular],
      assessments: profile({
        brief,
        listingId: popular.id,
        statuses: { "Customer reviews": "meets" },
      }),
    });
    expect(result.currentDecision).toMatchObject({
      state: "no_clear_winner",
      recommendationLevel: "none",
      leadingCandidateListingId: null,
    });
  });

  it("never emits ready_to_choose while the leader has a hard unknown", () => {
    const brief = briefFromSeeds([
      { label: "Quiet operation", strength: "hard" },
      { label: "Runtime", strength: "preference" },
    ]);
    const leader = listing(brief, "Quietness unknown");
    const result = project({
      brief,
      candidates: [leader],
      assessments: profile({
        brief,
        listingId: leader.id,
        statuses: { "Quiet operation": "uncertain", Runtime: "meets" },
      }),
    });
    expect(result.currentDecision.state).toBe("leader_needs_verification");
    expect(result.currentDecision.recommendationLevel).not.toBe("ready");
  });

  it("can move from verify-first to ready when deeper evidence resolves the hard gap", () => {
    const brief = briefFromSeeds([
      { label: "Quiet operation", strength: "hard" },
      { label: "Runtime", strength: "strong_preference" },
    ]);
    const leader = listing(brief, "Deepened evidence leader");
    const challenger = listing(brief, "Less-supported challenger", 2);
    const unresolved = project({
      brief,
      candidates: [leader, challenger],
      assessments: [
        ...profile({
          brief,
          listingId: leader.id,
          statuses: { "Quiet operation": "uncertain", Runtime: "meets" },
        }),
        ...profile({
          brief,
          listingId: challenger.id,
          statuses: {
            "Quiet operation": "uncertain",
            Runtime: "uncertain",
          },
        }),
      ],
    });
    const resolved = project({
      brief,
      candidates: [leader, challenger],
      assessments: [
        ...profile({
          brief,
          listingId: leader.id,
          statuses: { "Quiet operation": "meets", Runtime: "meets" },
        }),
        ...profile({
          brief,
          listingId: challenger.id,
          statuses: {
            "Quiet operation": "uncertain",
            Runtime: "uncertain",
          },
        }),
      ],
    });
    expect(unresolved.currentDecision.state).toBe("leader_needs_verification");
    expect(resolved.currentDecision).toMatchObject({
      state: "ready_to_choose",
      recommendationLevel: "ready",
      leadingCandidateListingId: leader.id,
    });
  });

  it("grounds the best alternative in a criterion the alternative actually meets", () => {
    const brief = briefFromSeeds([
      { label: "Comfort", strength: "strong_preference" },
      { label: "Low weight", strength: "preference" },
    ]);
    const leader = listing(brief, "Comfort leader");
    const alternative = listing(brief, "Lighter alternative", 2);
    const result = project({
      brief,
      candidates: [leader, alternative],
      assessments: [
        ...profile({
          brief,
          listingId: leader.id,
          statuses: { Comfort: "meets", "Low weight": "uncertain" },
        }),
        ...profile({
          brief,
          listingId: alternative.id,
          statuses: { Comfort: "uncertain", "Low weight": "meets" },
        }),
      ],
    });
    expect(result.currentDecision).toMatchObject({
      alternativeCandidateListingId: alternative.id,
      alternativeReason: expect.stringContaining("low weight matters more"),
    });
  });

  it("surfaces the current decision-changing gap rather than manufacturing certainty", () => {
    const brief = briefFromSeeds([
      { label: "Battery life", strength: "hard" },
      { label: "Comfort", strength: "strong_preference" },
    ]);
    const leader = listing(brief, "Evidence leader");
    const result = project({
      brief,
      candidates: [leader],
      assessments: profile({
        brief,
        listingId: leader.id,
        statuses: { "Battery life": "uncertain", Comfort: "meets" },
      }),
    });
    expect(result.currentDecision.blockingGap).toMatchObject({
      label: "Battery life",
      candidateListingIds: [leader.id],
    });
    expect(result.currentDecision.whatCouldChangeDecision?.criterionId).toBe(
      result.currentDecision.blockingGap?.criterionId,
    );
  });

  it("cannot recommend an explicitly rejected option", () => {
    const brief = briefFromSeeds([{ label: "Comfort", strength: "hard" }]);
    const rejected = listing(brief, "Rejected evidence leader");
    const remaining = listing(brief, "Remaining unknown", 2);
    const result = project({
      brief,
      candidates: [rejected, remaining],
      assessments: [
        ...profile({
          brief,
          listingId: rejected.id,
          statuses: { Comfort: "meets" },
        }),
        ...profile({
          brief,
          listingId: remaining.id,
          statuses: { Comfort: "uncertain" },
        }),
      ],
      rejectedIds: [rejected.id],
    });
    expect(result.currentDecision.leadingCandidateListingId).not.toBe(
      rejected.id,
    );
    expect(result.topOptions.map(({ listing }) => listing.id)).not.toContain(
      rejected.id,
    );
  });

  it("ignores stale-revision assessments in the current recommendation and rationale", () => {
    const taskId = shoppingTaskIdSchema.parse(randomUUID());
    const brief = briefFromSeeds(
      [{ label: "Current comfort", strength: "strong_preference" }],
      { taskId, revision: 2n },
    );
    const stale = listing(brief, "Old revision leader");
    const current = listing(brief, "Current revision leader", 2);
    const result = project({
      brief,
      candidates: [stale, current],
      assessments: [
        ...profile({
          brief,
          listingId: stale.id,
          statuses: { "Current comfort": "meets" },
          revision: 1n,
        }),
        ...profile({
          brief,
          listingId: current.id,
          statuses: { "Current comfort": "meets" },
        }),
      ],
    });
    expect(result.currentDecision.leadingCandidateListingId).toBe(current.id);
    expect(result.topOptions.map(({ listing }) => listing.id)).toEqual([
      current.id,
    ]);
  });
});

describe("founder-category Current Decision journeys", () => {
  const founderCase = (name: ProductEngineFixture["name"]) => {
    const fixture = V0_09_PRODUCT_ENGINE_CASES.find(
      (entry) => entry.name === name,
    );
    if (fixture === undefined) throw new Error(`Missing founder case ${name}`);
    return fixture;
  };

  it("changes the mouse rationale from review-only ambiguity to rev2 long-workday comfort", () => {
    const fixture = founderCase("ergonomic-mouse");
    const taskId = shoppingTaskIdSchema.parse(randomUUID());
    const rev1 = briefFromFounderFixture({ fixture, taskId, revision: 1n });
    const rev1Leader = listing(rev1, "Mouse A");
    const rev1Peer = listing(rev1, "Mouse B", 2);
    const sharedRev1 = Object.fromEntries(
      rev1.items.map(({ conceptLabel }) => [conceptLabel, "meets" as const]),
    );
    const firstDecision = project({
      brief: rev1,
      candidates: [rev1Leader, rev1Peer],
      assessments: [
        ...profile({
          brief: rev1,
          listingId: rev1Leader.id,
          statuses: { ...sharedRev1, Reviews: "meets" },
        }),
        ...profile({
          brief: rev1,
          listingId: rev1Peer.id,
          statuses: { ...sharedRev1, Reviews: "uncertain" },
        }),
      ],
    });
    expect(firstDecision.currentDecision.state).toBe("no_clear_winner");

    expect(fixture.refinement?.request).toBe(
      "Reviews matter less now. Comfort for long workdays matters most.",
    );
    const rev2 = briefFromFounderFixture({
      fixture,
      taskId,
      revision: 2n,
      applyMouseRefinement: true,
    });
    const leader = listing(rev2, rev1Leader.title);
    const peer = listing(rev2, rev1Peer.title, 2);
    const sharedRev2 = Object.fromEntries(
      rev2.items.map(({ conceptLabel }) => [conceptLabel, "meets" as const]),
    );
    const secondDecision = project({
      brief: rev2,
      candidates: [peer, leader],
      assessments: [
        ...profile({
          brief: rev2,
          listingId: leader.id,
          statuses: {
            ...sharedRev2,
            Reviews: "uncertain",
            "Comfort for long workdays": "meets",
          },
        }),
        ...profile({
          brief: rev2,
          listingId: peer.id,
          statuses: {
            ...sharedRev2,
            Reviews: "meets",
            "Comfort for long workdays": "uncertain",
          },
        }),
      ],
    });
    expect(secondDecision.currentDecision.state).toBe("ready_to_choose");
    expect(secondDecision.currentDecision.keyReasons[0]?.label).toBe(
      "Comfort for long workdays",
    );
    expect(
      secondDecision.currentDecision.keyReasons.map(({ label }) => label),
    ).not.toContain("Reviews");
  });

  it("marks an office chair in the conditional stretch as an explicit trade-off", () => {
    const brief = briefFromFounderFixture({
      fixture: founderCase("office-chair"),
    });
    const stretch = listing(brief, "£330 long-session chair");
    const cheaper = listing(brief, "£250 chair", 2);
    const stretchStatuses = Object.fromEntries(
      brief.items.map(({ conceptLabel }) => [conceptLabel, "meets" as const]),
    );
    const cheaperStatuses = Object.fromEntries(
      brief.items.map(({ conceptLabel }) => [
        conceptLabel,
        "uncertain" as const,
      ]),
    );
    const result = project({
      brief,
      candidates: [cheaper, stretch],
      assessments: [
        ...profile({
          brief,
          listingId: stretch.id,
          statuses: {
            ...stretchStatuses,
            Price: {
              status: "meets",
              relation: "inside_conditional_stretch",
            },
          },
        }),
        ...profile({
          brief,
          listingId: cheaper.id,
          statuses: cheaperStatuses,
        }),
      ],
    });
    expect(result.currentDecision).toMatchObject({
      state: "leader_with_tradeoff",
      leadingCandidateListingId: stretch.id,
      keyTradeoff: expect.objectContaining({ label: "Price" }),
    });
    expect(
      result.currentDecision.keyReasons.map(({ label }) => label),
    ).toContain("Lower-back support");
  });

  it("keeps a cordless vacuum provisional while the hard noise requirement is unknown", () => {
    const brief = briefFromFounderFixture({
      fixture: founderCase("cordless-vacuum"),
    });
    const leader = listing(brief, "Strong cordless vacuum");
    const statuses = Object.fromEntries(
      brief.items.map(({ conceptLabel }) => [conceptLabel, "meets" as const]),
    );
    const noiseLabel = brief.items.find(({ conceptLabel }) =>
      /loud|noise/i.test(conceptLabel),
    )?.conceptLabel;
    if (noiseLabel === undefined)
      throw new Error("Vacuum noise criterion missing");
    const result = project({
      brief,
      candidates: [leader],
      assessments: profile({
        brief,
        listingId: leader.id,
        statuses: { ...statuses, [noiseLabel]: "uncertain" },
      }),
    });
    expect(result.currentDecision).toMatchObject({
      state: "leader_needs_verification",
      recommendationLevel: "provisional",
      blockingGap: expect.objectContaining({ label: noiseLabel }),
    });
  });

  it("never recommends a coffee machine that conflicts with the hard 25cm width", () => {
    const brief = briefFromFounderFixture({
      fixture: founderCase("compact-coffee-machine"),
    });
    const compact = listing(brief, "24cm compact machine", 2);
    const wide = listing(brief, "29cm wide machine", 1);
    const allMeets = Object.fromEntries(
      brief.items.map(({ conceptLabel }) => [conceptLabel, "meets" as const]),
    );
    const widthLabel = brief.items.find(({ conceptLabel }) =>
      /width/i.test(conceptLabel),
    )?.conceptLabel;
    if (widthLabel === undefined)
      throw new Error("Coffee width criterion missing");
    const result = project({
      brief,
      candidates: [wide, compact],
      assessments: [
        ...profile({
          brief,
          listingId: wide.id,
          statuses: { ...allMeets, [widthLabel]: "conflicts" },
        }),
        ...profile({ brief, listingId: compact.id, statuses: allMeets }),
      ],
    });
    expect(result.currentDecision).toMatchObject({
      state: "ready_to_choose",
      leadingCandidateListingId: compact.id,
    });
    expect(result.currentDecision.leadingCandidateListingId).not.toBe(wide.id);
  });
});
