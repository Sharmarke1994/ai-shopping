import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { candidateListingIdSchema } from "@/domain/shopping-state/ids";
import {
  liveSessionIdSchema,
  liveShoppingViewSchema,
  type LiveShoppingView,
} from "./contracts";
import { LiveShopping } from "./live-shopping";

const sessionId = liveSessionIdSchema.parse(
  "4318c9d8-2460-4cc2-9861-91dcf681a23e",
);
const candidateListingId = candidateListingIdSchema.parse(
  "8a0e451f-0471-4693-81d2-761c19a6ea7d",
);
const secondCandidateListingId = candidateListingIdSchema.parse(
  "5c6f055c-01e4-4dfa-b065-306f656be061",
);
const criterionId = "70b74650-a485-4aeb-a507-0ca9b448f64f";
const secondCriterionId = "b7d6b761-c9c5-4c62-96fb-90900a57b48d";

const listing: LiveShoppingView["savedListings"][number] = {
  candidateListingId,
  displayId: "candidate-display",
  title: "Evidence-ready product",
  merchant: "Example Retailer",
  priceText: "£40",
  imageUrl: null,
  destinationUrl: "https://example.test/product",
  destinationLabel: "View at Example Retailer",
  purchaseState: "direct" as const,
  sourceUrl: null,
  sourceLabel: null,
  deliveryText: "Delivery available",
  availabilityText: null,
  foundAcrossQueries: 2,
  evidence: {
    sourceFacts: ["Observed price £40"],
    directlyEvidenced: ["Within the £50 maximum"],
    contradictions: [],
    unverifiedLabels: [],
    additionalUnverifiedCount: 0,
  },
  saved: false,
  rejected: false,
};

function view(options?: {
  researchStatus?: "not_started" | "researching" | "ready";
  deepResearchStatus?: "available" | "researching" | "complete" | "not_needed";
  includeDecision?: boolean;
  rejected?: boolean;
}): LiveShoppingView {
  const includeDecision = options?.includeDecision ?? false;
  const rejected = options?.rejected ?? false;
  return {
    schemaVersion: 1,
    sessionId,
    viewEpoch: "a".repeat(24),
    subject: "A product with a verified maximum price",
    brief: [{ label: "Maximum price", value: "Maximum £50", emphasis: "must" }],
    savedListings: [],
    rejectedListings: rejected ? [{ ...listing, rejected: true }] : [],
    decisionSupport: {
      researchStatus: options?.researchStatus ?? "ready",
      deepResearchStatus: options?.deepResearchStatus ?? "not_needed",
      researchActivity: {
        firstPassEvidenceCalls: includeDecision ? 1 : 0,
        deepeningEvidenceCalls:
          options?.deepResearchStatus === "complete" ? 1 : 0,
        productUnderstandingCalls: includeDecision ? 1 : 0,
      },
      researchedCandidateCount: includeDecision ? 1 : 0,
      sectionMode: "qualified_options",
      excludedCandidateCount: 0,
      decisionGaps:
        includeDecision && options?.deepResearchStatus !== "not_needed"
          ? [
              {
                criterionId,
                label: "Battery life",
                strength: "strong_preference",
                candidateListingIds: [candidateListingId],
                candidateTitles: [listing.title],
                explanation:
                  "Battery life remains unresolved where it could separate the leading options.",
              },
            ]
          : [],
      topOptions:
        includeDecision && !rejected
          ? [
              {
                listing,
                readiness: "qualified",
                researchState:
                  options?.deepResearchStatus === "complete"
                    ? "complete"
                    : "available",
                strongestSupported: true,
                supportedMustHaveCount: 1,
                mustHaveCount: 1,
                unresolvedMustHaves: [],
                whyItFits: ["The observed price is within the £50 maximum."],
                watchouts: [],
                unknowns:
                  options?.deepResearchStatus === "not_needed"
                    ? []
                    : [
                        {
                          criterionId,
                          label: "Battery life",
                          reason: "checked_no_answer",
                          explanation: "Battery life remains unknown.",
                        },
                      ],
                evidenceSources: [
                  {
                    title: "Exact manufacturer product page",
                    url: "https://example.test/exact-product",
                    role: "manufacturer",
                    depth: "fetched_page",
                  },
                ],
              },
            ]
          : [],
      comparison: null,
    },
    action: {
      kind: "search",
      notice: null,
      search: {
        status: "succeeded",
        queryCount: 2,
        completedQueryCount: 2,
        withheldConflictCount: 0,
        listings: rejected ? [] : [listing],
      },
    },
  };
}

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("founder live shopping decision loop", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    window.history.replaceState({}, "", "/live");
  });

  it("keeps Google Shopping usable while an exact retailer page is checking", async () => {
    localStorage.setItem("consider-live-session-v1", sessionId);
    const base = view({ includeDecision: true });
    if (
      base.action.kind !== "search" ||
      base.action.search === null ||
      base.decisionSupport === null ||
      base.decisionSupport.topOptions[0] === undefined
    ) {
      throw new Error("Expected a decision-support fixture");
    }
    const checkingListing = {
      ...listing,
      destinationUrl: "https://google.example/shopping/product",
      destinationLabel: "View on Google Shopping",
      purchaseState: "checking" as const,
    };
    const checking = liveShoppingViewSchema.parse({
      ...base,
      decisionSupport: {
        ...base.decisionSupport,
        topOptions: [
          {
            ...base.decisionSupport.topOptions[0],
            listing: checkingListing,
          },
        ],
      },
      action: {
        ...base.action,
        search: {
          ...base.action.search,
          listings: [checkingListing],
        },
      },
    });
    const fetchMock = vi.fn(
      (input: RequestInfo | URL, request?: RequestInit) => {
        void input;
        void request;
        return Promise.resolve(jsonResponse(checking));
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<LiveShopping />);

    expect(
      (
        await screen.findAllByRole("link", {
          name: /View on Google Shopping/i,
        })
      )[0],
    ).toHaveAttribute("href", checkingListing.destinationUrl);
    expect(
      screen.getAllByText(/Checking for the exact retailer page/i)[0],
    ).toBeVisible();
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([, request]) =>
          String((request as RequestInit | undefined)?.body).includes(
            '"operation":"resolve_destinations"',
          ),
        ),
      ).toBe(true),
    );
  });

  it("keeps progressive decision cards visible while first-pass research is still running", async () => {
    localStorage.setItem("consider-live-session-v1", sessionId);
    const progressive = view({
      researchStatus: "researching",
      deepResearchStatus: "available",
      includeDecision: true,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(jsonResponse(progressive))),
    );

    render(<LiveShopping />);

    expect(
      await screen.findByText(
        "Early evidence is available; research is still running",
      ),
    ).toBeVisible();
    expect(
      (await screen.findAllByRole("article", { name: listing.title }))[0],
    ).toBeVisible();
    expect(
      screen.queryByText("Supported from partial research"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("Battery life · Checked · source did not answer"),
    ).toBeVisible();
    expect(screen.queryByText("Still unverified")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("1 attributable source"));
    expect(
      screen.getByText("Manufacturer · checked product page"),
    ).toBeVisible();
  });

  it("shows listings immediately and starts each progressive research phase once", async () => {
    localStorage.setItem("consider-live-session-v1", sessionId);
    let resolveFirstPass!: (response: Response) => void;
    const firstPassResponse = new Promise<Response>((resolve) => {
      resolveFirstPass = resolve;
    });
    const operations: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_request: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method !== "POST") {
          return jsonResponse(
            view({
              researchStatus: "not_started",
              deepResearchStatus: "not_needed",
            }),
          );
        }
        const body = JSON.parse(String(init.body)) as { operation: string };
        operations.push(body.operation);
        if (body.operation === "research") return firstPassResponse;
        if (body.operation === "deepen_research") {
          return jsonResponse(
            view({
              researchStatus: "ready",
              deepResearchStatus: "complete",
              includeDecision: true,
            }),
          );
        }
        throw new Error(`Unexpected operation ${body.operation}`);
      }),
    );

    const rendered = render(<LiveShopping />);
    await waitFor(() => expect(operations).toEqual(["research"]));
    expect(
      screen.getByRole("heading", { name: "Products found for your brief" }),
    ).toBeVisible();
    expect(screen.getByRole("article", { name: listing.title })).toBeVisible();
    expect(screen.getByText(/checking the strongest options/i)).toBeVisible();

    await act(async () => {
      resolveFirstPass(
        jsonResponse(
          view({
            researchStatus: "ready",
            deepResearchStatus: "available",
            includeDecision: true,
          }),
        ),
      );
    });
    await waitFor(() =>
      expect(operations).toEqual(["research", "deepen_research"]),
    );
    rendered.rerender(<LiveShopping />);
    await act(async () => Promise.resolve());
    expect(operations).toEqual(["research", "deepen_research"]);
    expect(
      screen.queryByRole("button", { name: "Investigate" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Checked · still unknown")).toBeVisible();
  });

  it("does not let an older background result overwrite a shopper refinement", async () => {
    localStorage.setItem("consider-live-session-v1", sessionId);
    const initial = view({
      researchStatus: "ready",
      deepResearchStatus: "available",
      includeDecision: true,
    });
    const oldBackground = view({
      researchStatus: "ready",
      deepResearchStatus: "complete",
      includeDecision: true,
    });
    const refined = liveShoppingViewSchema.parse({
      ...oldBackground,
      viewEpoch: "b".repeat(24),
      brief: [
        ...oldBackground.brief,
        {
          label: "Water resistance",
          value: "Strong preference: yes",
          emphasis: "strong",
        },
      ],
    });
    let resolveBackground!: (response: Response) => void;
    const delayedBackground = new Promise<Response>((resolve) => {
      resolveBackground = resolve;
    });
    const operations: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_request: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method !== "POST") return jsonResponse(initial);
        const body = JSON.parse(String(init.body)) as { operation: string };
        operations.push(body.operation);
        return body.operation === "deepen_research"
          ? delayedBackground
          : jsonResponse(refined);
      }),
    );

    render(<LiveShopping />);
    await waitFor(() => expect(operations).toEqual(["deepen_research"]));
    fireEvent.change(screen.getByLabelText("Refine what you’re looking for"), {
      target: { value: "Make water resistance important too" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Update my priorities" }),
    );
    await waitFor(() => expect(operations).toContain("refine"));
    expect(
      await screen.findByText("Water resistance", { exact: true }),
    ).toBeVisible();

    await act(async () => {
      resolveBackground(jsonResponse(oldBackground));
    });
    expect(screen.getByText("Water resistance", { exact: true })).toBeVisible();
  });

  it("does not let an older background result resurrect an abandoned purchase", async () => {
    localStorage.setItem("consider-live-session-v1", sessionId);
    const initial = view({
      researchStatus: "ready",
      deepResearchStatus: "available",
      includeDecision: true,
    });
    const completed = view({
      researchStatus: "ready",
      deepResearchStatus: "complete",
      includeDecision: true,
    });
    let resolveBackground!: (response: Response) => void;
    const delayedBackground = new Promise<Response>((resolve) => {
      resolveBackground = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_request: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method !== "POST") return jsonResponse(initial);
        return delayedBackground;
      }),
    );

    render(<LiveShopping />);
    await screen.findByRole("button", { name: "Start a different purchase" });
    fireEvent.click(
      screen.getByRole("button", { name: "Start a different purchase" }),
    );
    expect(screen.getByLabelText("What are you looking for?")).toBeVisible();
    expect(
      screen.queryByRole("article", { name: listing.title }),
    ).not.toBeInTheDocument();

    await act(async () => {
      resolveBackground(jsonResponse(completed));
    });
    expect(screen.getByLabelText("What are you looking for?")).toBeVisible();
    expect(
      screen.queryByRole("article", { name: listing.title }),
    ).not.toBeInTheDocument();
  });

  it("hides one exact rejected listing and makes undo explicit without learning", async () => {
    localStorage.setItem("consider-live-session-v1", sessionId);
    const accepted = view({
      researchStatus: "ready",
      deepResearchStatus: "not_needed",
      includeDecision: true,
    });
    const rejected = view({
      researchStatus: "ready",
      deepResearchStatus: "not_needed",
      includeDecision: true,
      rejected: true,
    });
    const operations: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_request: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method !== "POST") return jsonResponse(accepted);
        const body = JSON.parse(String(init.body)) as { operation: string };
        operations.push(body.operation);
        return jsonResponse(
          body.operation === "reject_listing" ? rejected : accepted,
        );
      }),
    );

    render(<LiveShopping />);
    const [card] = await screen.findAllByRole("article", {
      name: listing.title,
    });
    if (card === undefined) throw new Error("Expected the decision card");
    fireEvent.click(within(card).getByRole("button", { name: "Not for me" }));
    await waitFor(() => expect(operations).toEqual(["reject_listing"]));
    expect(
      screen.queryByRole("article", { name: listing.title }),
    ).not.toBeInTheDocument();
    const disclosure = screen.getByText("Rejected").closest("details");
    if (disclosure === null) throw new Error("Expected rejected disclosure");
    fireEvent.click(within(disclosure).getByText("Rejected"));
    expect(
      within(disclosure).getByText(/does not teach Consider a new preference/i),
    ).toBeVisible();
    fireEvent.click(within(disclosure).getByRole("button", { name: "Undo" }));
    await waitFor(() =>
      expect(operations).toEqual(["reject_listing", "undo_reject_listing"]),
    );
    expect(
      (await screen.findAllByRole("article", { name: listing.title }))[0],
    ).toBeVisible();
  });

  it("offers decision-gap research for an unchecked contender when the leader was already checked", async () => {
    localStorage.setItem("consider-live-session-v1", sessionId);
    const completeLeader = view({
      researchStatus: "ready",
      deepResearchStatus: "complete",
      includeDecision: true,
    });
    const secondListing = {
      ...listing,
      candidateListingId: secondCandidateListingId,
      displayId: "candidate-display-2",
      title: "Still researchable product",
      destinationUrl: "https://example.test/product-2",
    };
    const firstOption = completeLeader.decisionSupport?.topOptions[0];
    if (
      firstOption === undefined ||
      completeLeader.decisionSupport === null ||
      completeLeader.action.kind !== "search" ||
      completeLeader.action.search === null
    ) {
      throw new Error("Expected the complete leader fixture");
    }
    const researchable = liveShoppingViewSchema.parse({
      ...completeLeader,
      decisionSupport: {
        ...completeLeader.decisionSupport,
        decisionGaps: [
          {
            criterionId: secondCriterionId,
            label: "Brand reputation",
            strength: "preference",
            candidateListingIds: [secondCandidateListingId],
            candidateTitles: [secondListing.title],
            explanation: "Brand reputation remains unresolved.",
          },
          {
            criterionId,
            label: "Battery life",
            strength: "strong_preference",
            candidateListingIds: [candidateListingId, secondCandidateListingId],
            candidateTitles: [listing.title, secondListing.title],
            explanation:
              "Battery life remains unresolved where it could separate the leading options.",
          },
        ],
        topOptions: [
          firstOption,
          {
            ...firstOption,
            listing: secondListing,
            researchState: "available",
            strongestSupported: false,
          },
        ],
      },
      action: {
        ...completeLeader.action,
        search: {
          ...completeLeader.action.search,
          listings: [listing, secondListing],
        },
      },
    });
    const operations: {
      operation: string;
      candidateListingId?: string;
      criterionId?: string;
    }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_request: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method !== "POST") return jsonResponse(researchable);
        const body = JSON.parse(String(init.body)) as {
          operation: string;
          candidateListingId?: string;
          criterionId?: string;
        };
        operations.push(body);
        return jsonResponse(researchable);
      }),
    );

    render(<LiveShopping />);
    const batteryGap = (await screen.findByText("Battery life")).closest("li");
    if (batteryGap === null) throw new Error("Expected the battery-life gap");
    fireEvent.click(
      within(batteryGap).getByRole("button", { name: "Investigate" }),
    );
    await waitFor(() =>
      expect(operations).toEqual([
        {
          operation: "research_candidate",
          sessionId,
          candidateListingId: secondCandidateListingId,
          criterionId,
        },
      ]),
    );
  });

  it("keeps card-level candidate research untargeted", async () => {
    localStorage.setItem("consider-live-session-v1", sessionId);
    const complete = view({
      researchStatus: "ready",
      deepResearchStatus: "complete",
      includeDecision: true,
    });
    const option = complete.decisionSupport?.topOptions[0];
    if (complete.decisionSupport === null || option === undefined) {
      throw new Error("Expected the decision option");
    }
    const researchable = liveShoppingViewSchema.parse({
      ...complete,
      decisionSupport: {
        ...complete.decisionSupport,
        topOptions: [{ ...option, researchState: "available" }],
      },
    });
    const operations: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_request: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method !== "POST") return jsonResponse(researchable);
        const body: unknown = JSON.parse(String(init.body));
        operations.push(body);
        return jsonResponse(researchable);
      }),
    );

    render(<LiveShopping />);
    const cards = await screen.findAllByRole("article", {
      name: listing.title,
    });
    const card = cards[0];
    if (card === undefined) throw new Error("Expected the decision card");
    fireEvent.click(
      within(card).getByRole("button", { name: "Research this more" }),
    );
    await waitFor(() =>
      expect(operations).toEqual([
        {
          operation: "research_candidate",
          sessionId,
          candidateListingId,
        },
      ]),
    );
  });

  it("keeps factual listings usable when automatic research is unavailable", async () => {
    localStorage.setItem("consider-live-session-v1", sessionId);
    let postCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_request: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method !== "POST") {
          return jsonResponse(
            view({
              researchStatus: "not_started",
              deepResearchStatus: "not_needed",
            }),
          );
        }
        postCount += 1;
        return new Response(
          JSON.stringify({
            error: {
              code: "operation_unavailable",
              message:
                "Evidence research is unavailable; the retrieved products remain usable.",
            },
          }),
          {
            status: 409,
            headers: { "Content-Type": "application/json" },
          },
        );
      }),
    );

    render(<LiveShopping />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Evidence research is unavailable",
    );
    expect(screen.getByRole("article", { name: listing.title })).toBeVisible();
    expect(postCount).toBe(1);
    expect(
      localStorage.getItem("consider-live-pending-mutation-v1"),
    ).toBeNull();
  });
});
