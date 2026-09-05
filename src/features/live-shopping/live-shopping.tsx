"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  liveShoppingErrorSchema,
  liveShoppingViewSchema,
  type LiveShoppingView,
} from "./contracts";
import styles from "./live-shopping.module.css";

const sessionStorageKey = "consider-live-session-v1";
const pendingMutationStorageKey = "consider-live-pending-mutation-v1";
const lastInitialRequestStorageKey = "consider-live-last-initial-request-v1";

type StartOperation = Readonly<{
  operation: "start";
  sessionId: string;
  turnId: string;
  message: string;
}>;

function pendingMutationForSession(raw: string | null, sessionId: string) {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "sessionId" in parsed &&
      parsed.sessionId === sessionId
    ) {
      return parsed;
    }
  } catch {
    return null;
  }
  return null;
}

class ShoppingApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ShoppingApiError";
  }
}

async function readResponse(response: Response) {
  const payload: unknown = await response.json();
  if (!response.ok) {
    const parsed = liveShoppingErrorSchema.safeParse(payload);
    throw new ShoppingApiError(
      parsed.success ? parsed.data.error.code : "service_unavailable",
      response.status,
      parsed.success
        ? parsed.data.error.message
        : "Shopping is temporarily unavailable.",
    );
  }
  return liveShoppingViewSchema.parse(payload);
}

async function loadSession(sessionId: string) {
  return readResponse(
    await fetch(`/api/live-shopping?session=${encodeURIComponent(sessionId)}`, {
      cache: "no-store",
    }),
  );
}

async function mutate(body: unknown) {
  return readResponse(
    await fetch("/api/live-shopping", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

function rememberSession(sessionId: string) {
  localStorage.setItem(sessionStorageKey, sessionId);
  const url = new URL(window.location.href);
  url.searchParams.set("session", sessionId);
  window.history.replaceState(null, "", url);
}

function forgetSession() {
  localStorage.removeItem(sessionStorageKey);
  localStorage.removeItem(pendingMutationStorageKey);
  const url = new URL(window.location.href);
  url.searchParams.delete("session");
  window.history.replaceState(null, "", url);
}

function initialSessionId() {
  const fromUrl = new URL(window.location.href).searchParams.get("session");
  return fromUrl ?? localStorage.getItem(sessionStorageKey);
}

function LoadingStory({ searchExpected }: { searchExpected: boolean }) {
  const [beat, setBeat] = useState(0);
  const messages = searchExpected
    ? [
        "Checking the saved search…",
        "Looking across UK shopping results…",
        "Saving product listings as they arrive…",
      ]
    : [
        "Reading the request as a shopping brief…",
        "Separating what you said from what we might search…",
        "Deciding whether one useful question would help…",
      ];
  useEffect(() => {
    const timer = window.setInterval(
      () => setBeat((current) => (current + 1) % messages.length),
      2_600,
    );
    return () => window.clearInterval(timer);
  }, [messages.length]);
  return (
    <div className={styles.loadingStory} role="status" aria-live="polite">
      <span className={styles.spinner} aria-hidden="true" />
      <span>{messages[beat]}</span>
    </div>
  );
}

function Brief({ view }: { view: LiveShoppingView }) {
  return (
    <aside className={styles.brief} aria-label="What matters for this search">
      <div className={styles.briefHeading}>
        <span>Your brief</span>
      </div>
      {view.brief.length === 0 ? (
        <p className={styles.briefEmpty}>
          No extra requirements added. Unknowns stay unknown.
        </p>
      ) : (
        <ul>
          {view.brief.map((item) => (
            <li key={`${item.label}:${item.value}`}>
              <span className={styles.briefLabel}>{item.label}</span>
              <span>{item.value}</span>
              <span className={styles[item.emphasis]}>
                {item.emphasis === "must"
                  ? "Must have"
                  : item.emphasis === "strong"
                    ? "Strong preference"
                    : "Preference"}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className={styles.briefTrust}>
        Only your request and explicit answers become shopping criteria.
      </p>
    </aside>
  );
}

type LiveListing = LiveShoppingView["savedListings"][number];
type DecisionSupport = NonNullable<LiveShoppingView["decisionSupport"]>;
type DecisionOption = DecisionSupport["topOptions"][number];
type CurrentDecision = DecisionSupport["currentDecision"];

function unknownReasonLabel(
  reason: DecisionOption["unknowns"][number]["reason"],
) {
  return reason === "not_checked"
    ? "Not checked yet"
    : reason === "checked_no_answer"
      ? "Checked · source did not answer"
      : reason === "source_disagreement"
        ? "Checked · sources disagree"
        : reason === "check_failed"
          ? "Check could not complete"
          : "Personal fit remains yours to judge";
}

function evidenceSourceLabel(
  source: DecisionOption["evidenceSources"][number],
) {
  const role =
    source.role === "manufacturer"
      ? "Manufacturer"
      : source.role === "independent_review"
        ? "Independent review"
        : source.role === "retailer_review_aggregate"
          ? "Retailer reviews"
          : source.role === "retailer"
            ? "Retailer"
            : source.role === "listing"
              ? "Shopping listing"
              : source.role === "visual"
                ? "Listing image"
                : "Other source";
  const depth =
    source.depth === "fetched_page"
      ? "checked product page"
      : source.depth === "organic_result"
        ? "search snippet"
        : source.depth === "listing_field"
          ? "listing fact"
          : "image";
  return `${role} · ${depth}`;
}

function decisionStateLabel(state: CurrentDecision["state"]) {
  if (state === "ready_to_choose") return "Ready to choose";
  if (state === "leader_with_tradeoff") return "Choice with a trade-off";
  if (state === "leader_needs_verification")
    return "Provisional · verify first";
  if (state === "researching") return "Decision still developing";
  if (state === "no_clear_winner") return "No clear winner";
  if (state === "no_eligible_option") return "No eligible option";
  return "Not enough evidence";
}

function CurrentDecisionSummary({
  support,
  busy,
  onResearchCandidate,
}: {
  support: DecisionSupport;
  busy: boolean;
  onResearchCandidate: (listing: LiveListing, criterionId?: string) => void;
}) {
  const decision = support.currentDecision;
  const leader = support.topOptions.find(
    ({ listing }) =>
      listing.candidateListingId === decision.leadingCandidateListingId,
  );
  const alternative = support.topOptions.find(
    ({ listing }) =>
      listing.candidateListingId === decision.alternativeCandidateListingId,
  );
  const nextGap = decision.whatCouldChangeDecision;
  const gapOptions =
    nextGap === null
      ? []
      : nextGap.candidateListingIds
          .map((candidateListingId) =>
            support.topOptions.find(
              ({ listing }) =>
                listing.candidateListingId === candidateListingId,
            ),
          )
          .filter((option) => option !== undefined);
  const gapOption =
    gapOptions.find(({ researchState }) => researchState === "available") ??
    gapOptions.find(({ researchState }) => researchState === "researching") ??
    gapOptions.find(({ researchState }) => researchState === "failed") ??
    gapOptions[0];
  const watch = decision.keyTradeoff;
  const stateClass =
    decision.recommendationLevel === "ready"
      ? styles.decisionReady
      : decision.recommendationLevel === "provisional"
        ? styles.decisionProvisional
        : styles.decisionUnresolved;

  return (
    <section
      className={[styles.currentDecision, stateClass].join(" ")}
      aria-labelledby="current-decision-heading"
      aria-live={decision.state === "researching" ? "polite" : undefined}
    >
      <div className={styles.currentDecisionHeader}>
        <div>
          <p className={styles.eyebrow}>Current decision</p>
          <span className={styles.decisionStateBadge}>
            {decisionStateLabel(decision.state)}
          </span>
        </div>
        {leader !== undefined ? (
          <div className={styles.decisionLeaderMeta}>
            <span>{leader.listing.merchant ?? "Retailer not confirmed"}</span>
            {leader.listing.priceText !== null ? (
              <strong>{leader.listing.priceText}</strong>
            ) : null}
          </div>
        ) : null}
      </div>
      <h2 id="current-decision-heading">{decision.headline}</h2>
      <p className={styles.currentDecisionExplanation}>
        {decision.explanation}
      </p>

      {leader !== undefined || watch !== null ? (
        <div className={styles.decisionSummaryGrid}>
          {leader !== undefined ? (
            <div className={styles.decisionReasons}>
              <div className={styles.decisionSummaryLabel}>
                <span>Why this choice</span>
                {leader.mustHaveCount > 0 ? (
                  <strong>
                    {leader.supportedMustHaveCount}/{leader.mustHaveCount}{" "}
                    must-haves verified
                  </strong>
                ) : null}
              </div>
              {decision.keyReasons.length > 0 ? (
                <ul>
                  {decision.keyReasons.map((reason) => (
                    <li key={reason.criterionId}>
                      <span>{reason.label}</span>
                      <p>{reason.explanation}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={styles.decisionQuietCopy}>
                  Current evidence does not yet establish a shopper-relevant
                  advantage.
                </p>
              )}
            </div>
          ) : null}
          {watch !== null ? (
            <div className={styles.decisionWatch}>
              <span>The trade-off</span>
              <strong>{watch.label}</strong>
              <p>{watch.explanation}</p>
            </div>
          ) : null}
        </div>
      ) : null}

      {alternative !== undefined && decision.alternativeReason !== null ? (
        <div className={styles.decisionAlternative}>
          <span>Best alternative</span>
          <strong>{alternative.listing.title}</strong>
          <p>{decision.alternativeReason}</p>
        </div>
      ) : null}

      {nextGap !== null ? (
        <div className={styles.decisionNextCheck}>
          <div>
            <span>
              {decision.blockingGap?.criterionId === nextGap.criterionId
                ? "Verify before choosing"
                : "What could change this decision"}
            </span>
            <strong>{nextGap.label}</strong>
            <p>{nextGap.explanation}</p>
          </div>
          {gapOption?.researchState === "available" ? (
            <button
              className={styles.decisionInvestigateButton}
              disabled={busy}
              onClick={() =>
                onResearchCandidate(gapOption.listing, nextGap.criterionId)
              }
            >
              Investigate {nextGap.label.toLocaleLowerCase("en-GB")}
              <span aria-hidden="true">→</span>
            </button>
          ) : gapOption?.researchState === "researching" ? (
            <span className={styles.decisionCheckState}>Checking now…</span>
          ) : gapOption?.researchState === "failed" ? (
            <span className={styles.decisionCheckState}>
              Check paused · current evidence preserved
            </span>
          ) : gapOption === undefined ? null : (
            <span className={styles.decisionCheckState}>
              Checked · still unresolved
            </span>
          )}
        </div>
      ) : null}

      {decision.purchase !== null ? (
        <div className={styles.decisionPurchase}>
          <a
            href={decision.purchase.destinationUrl}
            target="_blank"
            rel="noreferrer"
            className={
              decision.purchase.state === "direct"
                ? styles.decisionBuyButton
                : styles.decisionOffersButton
            }
          >
            <span>
              {decision.purchase.label}
              {decision.purchase.priceText !== null
                ? " · " + decision.purchase.priceText
                : ""}
            </span>
            <span aria-hidden="true">↗</span>
          </a>
          {decision.purchase.state === "direct" ? (
            <p>Verified same-merchant product destination.</p>
          ) : decision.purchase.state === "checking" ? (
            <p>
              Checking for the exact retailer page. Google Shopping remains
              available.
            </p>
          ) : (
            <p>Fallback shopping result · verify the seller and offer.</p>
          )}
        </div>
      ) : null}
    </section>
  );
}

function ProductCard({
  listing,
  busy,
  onToggleSaved,
  onToggleRejected,
  onResearchCandidate,
  decision,
}: {
  listing: LiveListing;
  busy: boolean;
  onToggleSaved: (listing: LiveListing) => void;
  onToggleRejected: (listing: LiveListing) => void;
  onResearchCandidate?: (listing: LiveListing, criterionId?: string) => void;
  decision?: DecisionOption;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  return (
    <article className={styles.productCard} aria-label={listing.title}>
      <div className={styles.productImage}>
        {listing.imageUrl !== null && !imageFailed ? (
          // Provider images have arbitrary remote hosts; the ordinary img element
          // keeps this factual evidence visible without expanding Next image policy.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={listing.imageUrl}
            alt=""
            loading="lazy"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <span aria-hidden="true">Image unavailable</span>
        )}
      </div>
      <div className={styles.productBody}>
        <div className={styles.merchantLine}>
          <span>{listing.merchant ?? "Merchant not supplied"}</span>
          {listing.foundAcrossQueries > 1 ? (
            <span>Seen in {listing.foundAcrossQueries} searches</span>
          ) : null}
        </div>
        <h3>{listing.title}</h3>
        {decision !== undefined ? (
          <div
            className={`${styles.readinessBadge} ${styles[decision.readiness]}`}
          >
            {decision.readiness === "qualified"
              ? "Ready to consider"
              : decision.readiness === "needs_verification"
                ? "Needs verification"
                : decision.readiness === "trade_off"
                  ? "Trade-off"
                  : "Doesn’t fit your must-haves"}
          </div>
        ) : null}
        {decision?.strongestSupported ? (
          <div className={styles.strongestBadge}>
            Strongest-supported option
          </div>
        ) : null}
        <div className={styles.productFacts}>
          <strong>{listing.priceText ?? "Price not supplied"}</strong>
          {listing.deliveryText ? <span>{listing.deliveryText}</span> : null}
          {listing.availabilityText ? (
            <span>{listing.availabilityText}</span>
          ) : null}
        </div>
        <div className={styles.evidenceSummary}>
          {decision !== undefined ? (
            <div className={styles.decisionSummary}>
              {decision.mustHaveCount > 0 ? (
                <p className={styles.mustHaveProgress}>
                  <strong>
                    {decision.supportedMustHaveCount}/{decision.mustHaveCount}
                  </strong>{" "}
                  must-haves supported
                </p>
              ) : null}
              {decision.unresolvedMustHaves.length > 0 ? (
                <div className={styles.mustHaveUnknowns}>
                  <strong>Must-haves to verify</strong>
                  <ul>
                    {decision.unresolvedMustHaves.map((entry) => (
                      <li key={entry.criterionId}>{entry.label}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {decision.whyItFits.length > 0 ? (
                <div>
                  <strong>Why it fits</strong>
                  <ul>
                    {decision.whyItFits.map((entry) => (
                      <li key={entry}>{entry}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {decision.watchouts.length > 0 ? (
                <div className={styles.decisionWatchout}>
                  <strong>Watchouts</strong>
                  <ul>
                    {decision.watchouts.map((entry) => (
                      <li key={entry}>{entry}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {decision.unknowns.length > 0 ? (
                <div className={styles.decisionUnknown}>
                  <strong>Still unknown</strong>
                  <ul>
                    {decision.unknowns.map((entry) => (
                      <li key={entry.criterionId}>
                        <span>
                          {entry.label} · {unknownReasonLabel(entry.reason)}
                        </span>
                        <small>{entry.explanation}</small>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {decision.evidenceSources.length > 0 ? (
                <details className={styles.evidenceSources}>
                  <summary>
                    {decision.evidenceSources.length} attributable{" "}
                    {decision.evidenceSources.length === 1
                      ? "source"
                      : "sources"}
                  </summary>
                  <ul>
                    {decision.evidenceSources.map((source) => (
                      <li key={source.url}>
                        <a href={source.url} target="_blank" rel="noreferrer">
                          {source.title}
                        </a>
                        <span>{evidenceSourceLabel(source)}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </div>
          ) : null}
          {decision === undefined && listing.evidence.sourceFacts.length > 0 ? (
            <p>
              <strong>Retailer evidence</strong>
              {listing.evidence.sourceFacts.join(" · ")}
            </p>
          ) : null}
          {decision === undefined &&
          listing.evidence.contradictions.length > 0 ? (
            <p className={styles.evidenceConflict}>
              <strong>Conflicts with current brief</strong>
              {listing.evidence.contradictions.join(" · ")}
            </p>
          ) : null}
          {decision === undefined &&
          listing.evidence.directlyEvidenced.length > 0 ? (
            <p>
              <strong>Listing evidence</strong>
              {listing.evidence.directlyEvidenced.join(" · ")}
            </p>
          ) : null}
          {decision === undefined &&
          listing.evidence.unverifiedLabels.length > 0 ? (
            <p>
              <strong>Still unverified</strong>
              {listing.evidence.unverifiedLabels.join(", ")}
              {listing.evidence.additionalUnverifiedCount > 0
                ? ` +${listing.evidence.additionalUnverifiedCount}`
                : ""}
            </p>
          ) : null}
        </div>
        <div className={styles.purchaseRow}>
          <a
            href={listing.destinationUrl}
            target="_blank"
            rel="noreferrer"
            className={styles.productLink}
          >
            {listing.destinationLabel}
            <span aria-hidden="true">↗</span>
          </a>
        </div>
        {listing.purchaseState === "checking" ? (
          <p className={styles.purchaseStatus}>
            Checking for the exact retailer page. Google Shopping remains
            available.
          </p>
        ) : null}
        {listing.sourceUrl !== null ? (
          <a
            href={listing.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className={styles.sourceLink}
          >
            {listing.sourceLabel}
          </a>
        ) : null}
        <div className={styles.cardActions}>
          {!listing.rejected ? (
            <button
              className={listing.saved ? styles.savedButton : styles.saveButton}
              onClick={() => onToggleSaved(listing)}
              disabled={busy}
            >
              {listing.saved ? "Saved ✓" : "Save"}
            </button>
          ) : null}
          {!listing.rejected &&
          onResearchCandidate !== undefined &&
          decision !== undefined &&
          decision.researchState === "available" &&
          (decision.unresolvedMustHaves.length > 0 ||
            decision.unknowns.length > 0) ? (
            <button
              className={styles.researchMoreButton}
              onClick={() => onResearchCandidate(listing)}
              disabled={busy}
            >
              Research this more
            </button>
          ) : null}
          {!listing.rejected && decision?.researchState === "researching" ? (
            <span className={styles.researchCompletion}>
              Researching this option…
            </span>
          ) : null}
          {!listing.rejected &&
          decision?.researchState === "complete" &&
          (decision.unresolvedMustHaves.length > 0 ||
            decision.unknowns.length > 0) ? (
            <span className={styles.researchCompletion}>
              Focused check complete · remaining gaps are still unknown
            </span>
          ) : null}
          {!listing.rejected && decision?.researchState === "failed" ? (
            <span className={styles.researchCompletion}>
              Focused check paused · current evidence is preserved
            </span>
          ) : null}
          <button
            className={styles.rejectButton}
            onClick={() => onToggleRejected(listing)}
            disabled={busy}
          >
            {listing.rejected ? "Undo rejection" : "Not for me"}
          </button>
        </div>
      </div>
    </article>
  );
}

function SearchResults({
  view,
  busy,
  onResume,
  onNewSearch,
  onToggleSaved,
  onToggleRejected,
}: {
  view: LiveShoppingView;
  busy: boolean;
  onResume: () => void;
  onNewSearch: () => void;
  onToggleSaved: (listing: LiveListing) => void;
  onToggleRejected: (listing: LiveListing) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  if (view.action.kind !== "search") return null;
  const search = view.action.search;
  if (search === null || search.status === "running") {
    return (
      <section className={styles.resultState} aria-busy={busy}>
        <p className={styles.eyebrow}>Live UK product search</p>
        <h2>Looking for products that match the brief</h2>
        {busy ? <LoadingStory searchExpected /> : null}
        <p>
          The task and any completed query results are already saved. Refreshing
          this page will not start a second shopping task.
        </p>
        {!busy ? (
          <button className={styles.primaryButton} onClick={onResume}>
            Continue saved search
          </button>
        ) : null}
      </section>
    );
  }
  if (search.status === "failed") {
    return (
      <section className={styles.resultState}>
        <p className={styles.eyebrow}>Search saved honestly</p>
        <h2>We couldn’t retrieve usable products this time</h2>
        <p>
          The provider attempts are recorded, but we won’t turn a failed lookup
          into made-up recommendations.
        </p>
        <button className={styles.secondaryButton} onClick={onNewSearch}>
          Start a fresh shopping task
        </button>
      </section>
    );
  }
  const visibleListings = showAll
    ? search.listings
    : search.listings.slice(0, 12);
  const results = (
    <section className={styles.results}>
      <div className={styles.resultsIntro}>
        <div>
          <p className={styles.eyebrow}>
            {search.status === "partial"
              ? "Partial live results"
              : "Live results"}
          </p>
          <h2>Products found for your brief</h2>
          <p>
            Factual Google Shopping listings from {search.completedQueryCount}{" "}
            of {search.queryCount} focused searches. Directly evidenced
            must-haves appear first; unsupported suitability stays unverified.
          </p>
        </div>
      </div>
      {view.action.notice ? (
        <div className={styles.notice}>{view.action.notice}</div>
      ) : null}
      {search.withheldConflictCount > 0 ? (
        <div className={styles.constraintNotice}>
          {search.withheldConflictCount}{" "}
          {search.withheldConflictCount === 1 ? "listing was" : "listings were"}{" "}
          withheld because an observed price or explicit title conflicted with a
          must-have.
        </div>
      ) : null}
      {search.listings.length === 0 ? (
        <div className={styles.noListings}>
          No usable product rows were returned. We have not filled the gap with
          guesses.
        </div>
      ) : (
        <div className={styles.productGrid}>
          {visibleListings.map((listing) => (
            <ProductCard
              key={listing.displayId}
              listing={listing}
              busy={busy}
              onToggleSaved={onToggleSaved}
              onToggleRejected={onToggleRejected}
            />
          ))}
        </div>
      )}
      {!showAll && search.listings.length > visibleListings.length ? (
        <div className={styles.showMore}>
          <button
            className={styles.secondaryButton}
            onClick={() => setShowAll(true)}
          >
            Show {search.listings.length - visibleListings.length} more listings
          </button>
        </div>
      ) : null}
    </section>
  );
  const researched =
    view.decisionSupport !== null &&
    ["researching", "ready", "partial"].includes(
      view.decisionSupport.researchStatus,
    ) &&
    view.decisionSupport.topOptions.length > 0;
  if (!researched) return results;
  return (
    <details className={styles.rawResultsDisclosure}>
      <summary>
        <span>Browse all factual listings</span>
        <small>
          {search.listings.length} unranked product rows ·{" "}
          {search.completedQueryCount} of {search.queryCount} searches complete
        </small>
      </summary>
      {results}
    </details>
  );
}

function EvidenceDecisionSupport({
  view,
  busy,
  onResearch,
  onDeepen,
  onToggleSaved,
  onToggleRejected,
  onResearchCandidate,
}: {
  view: LiveShoppingView;
  busy: boolean;
  onResearch: () => void;
  onDeepen: () => void;
  onToggleSaved: (listing: LiveListing) => void;
  onToggleRejected: (listing: LiveListing) => void;
  onResearchCandidate: (listing: LiveListing, criterionId?: string) => void;
}) {
  if (view.action.kind !== "search" || view.decisionSupport === null)
    return null;
  const support = view.decisionSupport;
  if (support.researchStatus === "not_started") {
    return (
      <section className={styles.researchInvitation} aria-busy={busy}>
        <div>
          <p className={styles.eyebrow}>Go beyond the listing</p>
          <h2>Checking the strongest options against your brief</h2>
          <p>
            Products stay visible while Consider checks a small promising set,
            preserves exact sources, and leaves unsupported claims unknown.
          </p>
        </div>
        {busy ? (
          <div className={styles.researchProgress}>
            <LoadingStory searchExpected />
            <p>
              Checking focused specifications, independent evidence and useful
              product images. This may take a moment.
            </p>
          </div>
        ) : (
          <button className={styles.researchButton} onClick={onResearch}>
            Start evidence check
            <span aria-hidden="true">→</span>
          </button>
        )}
      </section>
    );
  }
  if (
    support.researchStatus === "researching" &&
    support.topOptions.length === 0
  ) {
    return (
      <section className={styles.researchInvitation} aria-busy="true">
        <p className={styles.eyebrow}>Research is safely resumable</p>
        <h2>Checking the strongest options against your brief…</h2>
        <LoadingStory searchExpected />
        {!busy ? (
          <button className={styles.researchButton} onClick={onResearch}>
            Continue the saved evidence check
            <span aria-hidden="true">→</span>
          </button>
        ) : null}
      </section>
    );
  }
  if (support.topOptions.length === 0) {
    return (
      <section className={styles.decisionSection}>
        <CurrentDecisionSummary
          support={support}
          busy={busy}
          onResearchCandidate={onResearchCandidate}
        />
      </section>
    );
  }
  return (
    <section
      className={styles.decisionSection}
      aria-labelledby="decision-support-heading"
    >
      <CurrentDecisionSummary
        support={support}
        busy={busy}
        onResearchCandidate={onResearchCandidate}
      />
      {support.researchStatus === "researching" ? (
        <div className={styles.progressiveResearch} aria-live="polite">
          <span className={styles.spinner} aria-hidden="true" />
          <div>
            <strong>
              Early evidence is available; research is still running
            </strong>
            <p>
              These cards will update as the remaining saved work completes.
            </p>
          </div>
        </div>
      ) : null}
      <div className={styles.decisionIntro}>
        <div>
          <p className={styles.eyebrow}>
            {support.researchStatus === "researching"
              ? "Early option evidence"
              : support.sectionMode === "qualified_options"
                ? "Best-supported options"
                : "Verification needed"}
          </p>
          <h2 id="decision-support-heading">
            Why these options earned a closer look
          </h2>
          <p>
            Each card explains the product-level evidence, uncertainty and
            provenance behind the current decision.
          </p>
          {support.excludedCandidateCount > 0 ? (
            <p className={styles.excludedNote}>
              {support.excludedCandidateCount}{" "}
              {support.excludedCandidateCount === 1
                ? "option is"
                : "options are"}{" "}
              outside an evidenced purchase boundary and cannot be recommended.
            </p>
          ) : null}
        </div>
      </div>
      {support.deepResearchStatus === "researching" ||
      (busy && support.deepResearchStatus === "available") ? (
        <div className={styles.progressiveResearch} aria-live="polite">
          <span className={styles.spinner} aria-hidden="true" />
          <div>
            <strong>Checking the gaps that could change the decision</strong>
            <p>The current evidence stays visible while this finishes.</p>
          </div>
        </div>
      ) : null}
      <div className={styles.topOptionGrid}>
        {support.topOptions.map((option) => (
          <ProductCard
            key={"decision:" + option.listing.candidateListingId}
            listing={option.listing}
            decision={option}
            busy={busy}
            onToggleSaved={onToggleSaved}
            onToggleRejected={onToggleRejected}
            onResearchCandidate={onResearchCandidate}
          />
        ))}
      </div>
      {support.decisionGaps.length > 0 ? (
        <div className={styles.decisionGaps}>
          <div>
            <p className={styles.eyebrow}>Still worth checking</p>
            <h3>What could change the decision?</h3>
          </div>
          <ul>
            {support.decisionGaps.map((gap) => {
              const gapOptions = gap.candidateListingIds
                .map((candidateListingId) =>
                  support.topOptions.find(
                    ({ listing }) =>
                      listing.candidateListingId === candidateListingId,
                  ),
                )
                .filter((option) => option !== undefined);
              const option =
                gapOptions.find(
                  ({ researchState }) => researchState === "available",
                ) ??
                gapOptions.find(
                  ({ researchState }) => researchState === "researching",
                ) ??
                gapOptions[0];
              return (
                <li key={gap.criterionId}>
                  <div>
                    <strong>{gap.label}</strong>
                    <span>{gap.explanation}</span>
                  </div>
                  {option?.researchState === "available" ? (
                    <button
                      className={styles.researchMoreButton}
                      disabled={busy}
                      onClick={() =>
                        onResearchCandidate(option.listing, gap.criterionId)
                      }
                    >
                      Investigate
                    </button>
                  ) : option?.researchState === "researching" ? (
                    <span className={styles.researchCompletion}>
                      Checking now…
                    </span>
                  ) : option?.researchState === "failed" ? (
                    <span className={styles.researchCompletion}>
                      Research paused
                    </span>
                  ) : option === undefined ? null : (
                    <span className={styles.researchCompletion}>
                      Checked · still unknown
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          {support.deepResearchStatus === "available" && !busy ? (
            <button className={styles.researchButton} onClick={onDeepen}>
              Check the most important gaps
              <span aria-hidden="true">→</span>
            </button>
          ) : null}
          {support.deepResearchStatus === "failed" ? (
            <p className={styles.researchFailure}>
              Deeper research paused. Existing evidence and decisions are still
              intact.
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function assessmentStatusLabel(
  status: "meets" | "conflicts" | "uncertain" | "not_applicable",
) {
  if (status === "meets") return "Supported";
  if (status === "conflicts") return "Conflict";
  if (status === "not_applicable") return "Not applicable";
  return "Unknown";
}

function SavedComparison({
  view,
  busy,
  onResearchCandidate,
  onToggleSaved,
}: {
  view: LiveShoppingView;
  busy: boolean;
  onResearchCandidate: (listing: LiveListing, criterionId?: string) => void;
  onToggleSaved: (listing: LiveListing) => void;
}) {
  const comparison = view.decisionSupport?.comparison;
  if (comparison === null || comparison === undefined) return null;
  const mustHaves = comparison.rows.filter(
    ({ strength }) => strength === "hard",
  );
  const keyDifferences = comparison.rows.filter((row) => {
    if (row.strength === "hard") return false;
    return new Set(row.cells.map(({ status }) => status)).size > 1;
  });
  return (
    <section
      className={styles.comparisonSection}
      aria-labelledby="saved-comparison-heading"
    >
      <div className={styles.comparisonIntro}>
        <p className={styles.eyebrow}>Your saved comparison</p>
        <h2 id="saved-comparison-heading">What separates your saved options</h2>
        <p>{comparison.judgement}</p>
      </div>
      <div className={styles.comparisonOverview}>
        <section>
          <span>Must-haves</span>
          <strong>
            {mustHaves.length === 0
              ? "No explicit must-haves"
              : `${mustHaves.length} checked across every saved option`}
          </strong>
          <ul>
            {mustHaves.slice(0, 4).map((row) => (
              <li key={row.criterionId}>
                <strong>{row.label}</strong>
                <span>
                  {row.cells
                    .map((cell) => {
                      const candidate = comparison.candidates.find(
                        ({ candidateListingId }) =>
                          candidateListingId === cell.candidateListingId,
                      );
                      return `${candidate?.title ?? "Saved option"}: ${assessmentStatusLabel(cell.status)}`;
                    })
                    .join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <span>Key differences</span>
          <strong>
            {keyDifferences.length === 0
              ? "No evidenced preference difference yet"
              : `${keyDifferences.length} useful ${keyDifferences.length === 1 ? "difference" : "differences"}`}
          </strong>
          <ul>
            {keyDifferences.slice(0, 4).map((row) => (
              <li key={row.criterionId}>
                <strong>{row.label}</strong>
                <span>
                  {row.cells
                    .map((cell) => {
                      const candidate = comparison.candidates.find(
                        ({ candidateListingId }) =>
                          candidateListingId === cell.candidateListingId,
                      );
                      return `${candidate?.title ?? "Saved option"}: ${assessmentStatusLabel(cell.status)}`;
                    })
                    .join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <span>Important unknowns</span>
          <strong>
            {comparison.decisionGaps.length === 0
              ? "No decision-critical gaps"
              : `${comparison.decisionGaps.length} ${comparison.decisionGaps.length === 1 ? "gap" : "gaps"} could change the choice`}
          </strong>
          <ul>
            {comparison.decisionGaps.map((gap) => {
              const gapCandidates = gap.candidateListingIds
                .map((candidateListingId) => {
                  const candidate = comparison.candidates.find(
                    (entry) => entry.candidateListingId === candidateListingId,
                  );
                  const researchState = comparison.researchStates.find(
                    (entry) => entry.candidateListingId === candidateListingId,
                  )?.state;
                  return candidate === undefined || researchState === undefined
                    ? undefined
                    : { candidate, researchState };
                })
                .filter((entry) => entry !== undefined);
              const selected =
                gapCandidates.find(
                  ({ researchState }) => researchState === "available",
                ) ??
                gapCandidates.find(
                  ({ researchState }) => researchState === "researching",
                ) ??
                gapCandidates[0];
              const candidate = selected?.candidate;
              const researchState = selected?.researchState;
              return (
                <li key={gap.criterionId}>
                  <span>{gap.label}</span>
                  {candidate !== undefined && researchState === "available" ? (
                    <button
                      disabled={busy}
                      onClick={() =>
                        onResearchCandidate(candidate, gap.criterionId)
                      }
                    >
                      Investigate
                    </button>
                  ) : researchState === "researching" ? (
                    <small>Checking now…</small>
                  ) : researchState === "failed" ? (
                    <small>Research paused</small>
                  ) : candidate === undefined ? null : (
                    <small>Checked · still unknown</small>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
        <section>
          <span>Price / purchase</span>
          <strong>
            {comparison.candidates.length} observed retailer{" "}
            {comparison.candidates.length === 1 ? "option" : "options"}
          </strong>
          <ul>
            {comparison.candidates.map((candidate) => {
              const relationship = comparison.purchaseSummaries.find(
                ({ candidateListingId }) =>
                  candidateListingId === candidate.candidateListingId,
              );
              return (
                <li key={candidate.candidateListingId}>
                  <a
                    href={candidate.destinationUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <strong>{candidate.priceText ?? "Price unknown"}</strong>
                    <span>{candidate.destinationLabel} ↗</span>
                  </a>
                  <small>{relationship?.priceRelationship}</small>
                  <button
                    className={styles.textButton}
                    disabled={busy}
                    onClick={() => onToggleSaved(candidate)}
                  >
                    Remove from saved
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
      <details className={styles.comparisonDetails}>
        <summary>See the full criterion-by-criterion evidence</summary>
        <div className={styles.comparisonScroller}>
          <table>
            <thead>
              <tr>
                <th scope="col">What matters</th>
                {comparison.candidates.map((candidate) => (
                  <th scope="col" key={candidate.candidateListingId}>
                    <span>{candidate.title}</span>
                    <strong>{candidate.priceText ?? "Price unknown"}</strong>
                    <a
                      href={candidate.destinationUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {candidate.destinationLabel}
                    </a>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {comparison.rows.map((row) => (
                <tr key={row.criterionId}>
                  <th scope="row">{row.label}</th>
                  {row.cells.map((cell) => (
                    <td key={cell.candidateListingId}>
                      <span className={styles[cell.status]}>
                        {assessmentStatusLabel(cell.status)}
                      </span>
                      <p>{cell.explanation}</p>
                      {cell.sources.length > 0 ? (
                        <details>
                          <summary>
                            {cell.sources.length}{" "}
                            {cell.sources.length === 1 ? "source" : "sources"}
                          </summary>
                          {cell.sources.map((source) => (
                            <span
                              className={styles.comparisonSource}
                              key={source.url}
                            >
                              <a
                                href={source.url}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {source.title}
                              </a>
                              <small>{evidenceSourceLabel(source)}</small>
                            </span>
                          ))}
                        </details>
                      ) : null}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

function SavedProducts({
  view,
  busy,
  onToggleSaved,
  onToggleRejected,
}: {
  view: LiveShoppingView;
  busy: boolean;
  onToggleSaved: (listing: LiveListing) => void;
  onToggleRejected: (listing: LiveListing) => void;
}) {
  if (
    view.savedListings.length === 0 ||
    view.decisionSupport?.comparison !== null
  )
    return null;
  return (
    <section className={styles.savedSection}>
      <div>
        <p className={styles.eyebrow}>Saved for this purchase</p>
        <h2>Keep interesting options while you refine</h2>
      </div>
      <div className={styles.savedGrid}>
        {view.savedListings.map((listing) => (
          <ProductCard
            key={"saved:" + listing.candidateListingId}
            listing={listing}
            busy={busy}
            onToggleSaved={onToggleSaved}
            onToggleRejected={onToggleRejected}
          />
        ))}
      </div>
    </section>
  );
}

function RejectedProducts({
  view,
  busy,
  onUndo,
}: {
  view: LiveShoppingView;
  busy: boolean;
  onUndo: (listing: LiveListing) => void;
}) {
  if (view.rejectedListings.length === 0) return null;
  return (
    <details className={styles.rejectedDisclosure}>
      <summary>
        <span>Rejected</span>
        <small>
          {view.rejectedListings.length}{" "}
          {view.rejectedListings.length === 1 ? "product" : "products"} hidden
          from this purchase
        </small>
      </summary>
      <div className={styles.rejectedList}>
        {view.rejectedListings.map((listing) => (
          <article key={listing.candidateListingId}>
            <div>
              <strong>{listing.title}</strong>
              <span>
                {listing.merchant ?? "Merchant unavailable"}
                {listing.priceText ? ` · ${listing.priceText}` : ""}
              </span>
            </div>
            <button disabled={busy} onClick={() => onUndo(listing)}>
              Undo
            </button>
          </article>
        ))}
      </div>
      <p>
        “Not for me” hides only this exact listing. It does not teach Consider a
        new preference.
      </p>
    </details>
  );
}

export function LiveShopping() {
  const [view, setView] = useState<LiveShoppingView | null>(null);
  const [request, setRequest] = useState("");
  const [openAnswer, setOpenAnswer] = useState("");
  const [refinement, setRefinement] = useState("");
  const [restoring, setRestoring] = useState(true);
  const [busy, setBusy] = useState(false);
  const [backgroundBusy, setBackgroundBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingOperation, setPendingOperation] = useState<unknown>(null);
  const autoResumeKey = useRef<string | null>(null);
  const autoResearchKey = useRef<string | null>(null);
  const autoDestinationKey = useRef<string | null>(null);
  const autoDestinationRetryAt = useRef(0);
  const autoDeepenKey = useRef<string | null>(null);
  const backgroundBusyRef = useRef(false);
  const foregroundMutationVersionRef = useRef(0);
  const currentViewRef = useRef<LiveShoppingView | null>(null);

  useEffect(() => {
    currentViewRef.current = view;
  }, [view]);

  const acceptView = useCallback((next: LiveShoppingView) => {
    currentViewRef.current = next;
    setView(next);
    setError(null);
    setPendingOperation(null);
    localStorage.removeItem(pendingMutationStorageKey);
  }, []);

  const runMutation = useCallback(
    async (operation: unknown) => {
      foregroundMutationVersionRef.current += 1;
      setBusy(true);
      setError(null);
      setPendingOperation(operation);
      localStorage.setItem(
        pendingMutationStorageKey,
        JSON.stringify(operation),
      );
      try {
        acceptView(await mutate(operation));
      } catch (cause) {
        if (
          cause instanceof ShoppingApiError &&
          [
            "stale_authority",
            "retry_conflict",
            "operation_unavailable",
          ].includes(cause.code)
        ) {
          setPendingOperation(null);
          localStorage.removeItem(pendingMutationStorageKey);
        }
        setError(
          cause instanceof Error
            ? cause.message
            : "Shopping is temporarily unavailable.",
        );
      } finally {
        setBusy(false);
      }
    },
    [acceptView],
  );

  const runBackgroundMutation = useCallback(async (operation: unknown) => {
    if (backgroundBusyRef.current) return;
    const startingForegroundVersion = foregroundMutationVersionRef.current;
    const startingView = currentViewRef.current;
    backgroundBusyRef.current = true;
    setBackgroundBusy(true);
    setError(null);
    try {
      const next = await mutate(operation);
      const current = currentViewRef.current;
      if (
        foregroundMutationVersionRef.current === startingForegroundVersion &&
        (startingView === null ||
          (current?.sessionId === startingView.sessionId &&
            next.sessionId === startingView.sessionId))
      ) {
        currentViewRef.current = next;
        setView(next);
      } else if (current !== null) {
        const refreshed = await loadSession(current.sessionId);
        if (
          foregroundMutationVersionRef.current === startingForegroundVersion
        ) {
          currentViewRef.current = refreshed;
          setView(refreshed);
        }
      }
    } catch (cause) {
      if (foregroundMutationVersionRef.current !== startingForegroundVersion) {
        return;
      }
      // A shopper refinement may intentionally stale background work. Reload
      // the current task instead of surfacing that expected race as data loss.
      if (
        cause instanceof ShoppingApiError &&
        cause.code === "stale_authority" &&
        currentViewRef.current !== null
      ) {
        try {
          const next = await loadSession(currentViewRef.current.sessionId);
          currentViewRef.current = next;
          setView(next);
        } catch {
          // The normal retry notice below remains the truthful fallback.
          setError(cause.message);
        }
      } else {
        setError(
          cause instanceof Error
            ? cause.message
            : "Background shopping research is temporarily unavailable.",
        );
      }
    } finally {
      backgroundBusyRef.current = false;
      setBackgroundBusy(false);
    }
  }, []);

  const visibleSessionId = view?.sessionId ?? null;
  const hasCheckingPurchase =
    view?.decisionSupport !== null && view?.decisionSupport !== undefined
      ? [
          ...view.decisionSupport.topOptions.map(({ listing }) => listing),
          ...(view.decisionSupport.comparison?.candidates ?? []),
          ...view.savedListings,
        ].some(({ purchaseState }) => purchaseState === "checking")
      : (view?.savedListings.some(
          ({ purchaseState }) => purchaseState === "checking",
        ) ?? false);
  useEffect(() => {
    if (
      (!backgroundBusy && !hasCheckingPurchase) ||
      visibleSessionId === null
    ) {
      return;
    }
    let cancelled = false;
    const poll = async () => {
      if (busy || cancelled) return;
      const startingForegroundVersion = foregroundMutationVersionRef.current;
      try {
        const next = await loadSession(visibleSessionId);
        if (
          cancelled ||
          foregroundMutationVersionRef.current !== startingForegroundVersion
        ) {
          return;
        }
        currentViewRef.current = next;
        setView(next);
      } catch {
        // The owning mutation reports terminal errors. A transient projection
        // poll must not replace that result or manufacture a failure state.
      }
    };
    const interval = window.setInterval(() => void poll(), 1_200);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [backgroundBusy, busy, hasCheckingPurchase, visibleSessionId]);

  useEffect(() => {
    void Promise.resolve().then(async () => {
      const sessionId = initialSessionId();
      if (sessionId === null) {
        setRestoring(false);
        return;
      }
      rememberSession(sessionId);
      setBusy(true);
      const pending = pendingMutationForSession(
        localStorage.getItem(pendingMutationStorageKey),
        sessionId,
      );
      try {
        const loaded = await loadSession(sessionId);
        if (pending === null) {
          acceptView(loaded);
        } else {
          setView(loaded);
          setPendingOperation(pending);
          acceptView(await mutate(pending));
        }
      } catch (cause: unknown) {
        if (
          cause instanceof ShoppingApiError &&
          cause.status === 404 &&
          pending !== null &&
          "operation" in pending &&
          pending.operation === "start"
        ) {
          try {
            setPendingOperation(pending);
            acceptView(await mutate(pending));
            return;
          } catch {
            localStorage.removeItem(pendingMutationStorageKey);
          }
        }
        if (cause instanceof ShoppingApiError && cause.status === 404) {
          forgetSession();
          setError(
            "That saved local task is no longer available. You can start a fresh one below.",
          );
          return;
        }
        setError(
          cause instanceof Error ? cause.message : "Could not load this task.",
        );
      } finally {
        setBusy(false);
        setRestoring(false);
      }
    });
  }, [acceptView]);

  useEffect(() => {
    if (
      view?.action.kind !== "search" ||
      (view.action.search !== null &&
        view.action.search.status !== "running") ||
      busy ||
      backgroundBusy
    ) {
      return;
    }
    const key = `${view.sessionId}:${view.action.search?.completedQueryCount ?? 0}`;
    if (autoResumeKey.current === key) return;
    autoResumeKey.current = key;
    void runBackgroundMutation({
      operation: "resume_search",
      sessionId: view.sessionId,
    });
  }, [backgroundBusy, busy, runBackgroundMutation, view]);

  useEffect(() => {
    if (
      view?.action.kind !== "search" ||
      view.action.search === null ||
      !["succeeded", "partial"].includes(view.action.search.status) ||
      !["not_started", "researching"].includes(
        view.decisionSupport?.researchStatus ?? "ready",
      ) ||
      busy ||
      backgroundBusy
    ) {
      return;
    }
    const key = `${view.sessionId}:${view.viewEpoch}:first-pass`;
    if (autoResearchKey.current === key) return;
    autoResearchKey.current = key;
    void runBackgroundMutation({
      operation: "research",
      sessionId: view.sessionId,
    });
  }, [backgroundBusy, busy, runBackgroundMutation, view]);

  useEffect(() => {
    if (
      view?.action.kind !== "search" ||
      !["ready", "partial"].includes(
        view.decisionSupport?.researchStatus ?? "not_started",
      ) ||
      ["available", "researching"].includes(
        view.decisionSupport?.deepResearchStatus ?? "not_needed",
      ) ||
      busy ||
      backgroundBusy
    ) {
      return;
    }
    const candidates = [
      ...(view.decisionSupport?.topOptions.map(({ listing }) => listing) ?? []),
      ...(view.decisionSupport?.comparison?.candidates ?? []),
    ];
    const unresolved = [
      ...new Map(
        candidates
          .filter(({ purchaseState }) => purchaseState !== "direct")
          .map((listing) => [listing.candidateListingId, listing]),
      ).values(),
    ];
    if (unresolved.length === 0) return;
    const key = `${view.sessionId}:${unresolved
      .map(
        ({ candidateListingId, purchaseState }) =>
          `${candidateListingId}:${purchaseState}`,
      )
      .sort()
      .join("|")}`;
    const now = Date.now();
    if (
      autoDestinationKey.current === key &&
      now < autoDestinationRetryAt.current
    ) {
      return;
    }
    autoDestinationKey.current = key;
    autoDestinationRetryAt.current = now + 15_000;
    void runBackgroundMutation({
      operation: "resolve_destinations",
      sessionId: view.sessionId,
    });
  }, [backgroundBusy, busy, runBackgroundMutation, view]);

  useEffect(() => {
    if (
      view?.action.kind !== "search" ||
      !["ready", "partial"].includes(
        view.decisionSupport?.researchStatus ?? "not_started",
      ) ||
      !["available", "researching"].includes(
        view.decisionSupport?.deepResearchStatus ?? "not_needed",
      ) ||
      busy ||
      backgroundBusy
    ) {
      return;
    }
    const key = `${view.sessionId}:${view.viewEpoch}:deepening`;
    if (autoDeepenKey.current === key) return;
    autoDeepenKey.current = key;
    void runBackgroundMutation({
      operation: "deepen_research",
      sessionId: view.sessionId,
    });
  }, [backgroundBusy, busy, runBackgroundMutation, view]);

  const start = (event: FormEvent) => {
    event.preventDefault();
    if (request.trim().length === 0 || busy) return;
    const operation: StartOperation = {
      operation: "start",
      sessionId: crypto.randomUUID(),
      turnId: crypto.randomUUID(),
      message: request,
    };
    rememberSession(operation.sessionId);
    localStorage.setItem(lastInitialRequestStorageKey, request);
    void runMutation(operation);
  };

  const answerOption = (optionOrdinal: number) => {
    if (view === null || busy) return;
    void runMutation({
      operation: "answer",
      sessionId: view.sessionId,
      turnId: crypto.randomUUID(),
      answer: { mode: "single_select", optionOrdinal },
    });
  };

  const answerText = (event: FormEvent) => {
    event.preventDefault();
    if (view === null || openAnswer.trim().length === 0 || busy) return;
    void runMutation({
      operation: "answer",
      sessionId: view.sessionId,
      turnId: crypto.randomUUID(),
      answer: { mode: "open_text", text: openAnswer },
    });
  };

  const newSearch = () => {
    forgetSession();
    foregroundMutationVersionRef.current += 1;
    currentViewRef.current = null;
    autoResumeKey.current = null;
    autoResearchKey.current = null;
    autoDeepenKey.current = null;
    setView(null);
    setRequest(localStorage.getItem(lastInitialRequestStorageKey) ?? "");
    setOpenAnswer("");
    setRefinement("");
    setError(null);
    setPendingOperation(null);
  };

  const refine = (event: FormEvent) => {
    event.preventDefault();
    if (view === null || refinement.trim().length === 0 || busy) return;
    void runMutation({
      operation: "refine",
      sessionId: view.sessionId,
      turnId: crypto.randomUUID(),
      message: refinement,
    });
    setRefinement("");
  };

  const toggleSaved = (listing: LiveListing) => {
    if (view === null || busy) return;
    void runMutation({
      operation: listing.saved ? "unsave_listing" : "save_listing",
      sessionId: view.sessionId,
      candidateListingId: listing.candidateListingId,
    });
  };

  const toggleRejected = (listing: LiveListing) => {
    if (view === null || busy) return;
    void runMutation({
      operation: listing.rejected ? "undo_reject_listing" : "reject_listing",
      sessionId: view.sessionId,
      candidateListingId: listing.candidateListingId,
    });
  };

  const researchCandidate = (listing: LiveListing, criterionId?: string) => {
    if (view === null || busy || listing.rejected) return;
    void runMutation({
      operation: "research_candidate",
      sessionId: view.sessionId,
      candidateListingId: listing.candidateListingId,
      ...(criterionId === undefined ? {} : { criterionId }),
    });
  };

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <a href="/live" className={styles.brand} aria-label="Consider home">
          Consider<span>.</span>
        </a>
        <div className={styles.prototypeLabel}>
          <span aria-hidden="true" /> Private founder preview
        </div>
      </header>

      {restoring ? (
        <section className={styles.restoring} aria-busy="true">
          <LoadingStory searchExpected={false} />
        </section>
      ) : view === null ? (
        <section className={styles.landing}>
          <div className={styles.landingCopy}>
            <p className={styles.eyebrow}>Shopping starts with your life</p>
            <h1>Say what you need. We’ll build the brief.</h1>
            <p>
              Describe the purchase naturally—constraints, compromises, context
              and all. Consider keeps your words separate from its search ideas.
            </p>
          </div>
          <form className={styles.searchBox} onSubmit={start}>
            <label htmlFor="live-request">What are you looking for?</label>
            <textarea
              id="live-request"
              value={request}
              onChange={(event) => setRequest(event.target.value)}
              placeholder="A light breathable cap for running in hot weather…"
              rows={4}
              disabled={busy}
            />
            <div className={styles.searchFooter}>
              <span>UK market · GBP · live product search</span>
              <button className={styles.primaryButton} disabled={busy}>
                {busy ? "Working…" : "Start looking"}
              </button>
            </div>
          </form>
          {busy ? <LoadingStory searchExpected={false} /> : null}
          {error ? (
            <div className={styles.error} role="alert">
              <span>{error}</span>
              {pendingOperation ? (
                <button onClick={() => void runMutation(pendingOperation)}>
                  Retry safely
                </button>
              ) : null}
            </div>
          ) : null}
          <div className={styles.promiseRow} aria-label="Product promises">
            <span>Unknown stays unknown</span>
            <span>Explicit beats inferred</span>
            <span>Search ideas never rewrite your brief</span>
          </div>
        </section>
      ) : (
        <div className={styles.workspace}>
          <div className={styles.workspaceMain}>
            <div className={styles.subjectBar}>
              <div>
                <span>Your request</span>
                <p
                  className={
                    view.subject.length > 220 ? styles.subjectLong : undefined
                  }
                >
                  {view.subject}
                </p>
                {view.subject.length > 220 ? (
                  <details className={styles.subjectDetails}>
                    <summary>Read the full request</summary>
                    <p>{view.subject}</p>
                  </details>
                ) : null}
              </div>
              <button className={styles.textButton} onClick={newSearch}>
                Start a different purchase
              </button>
            </div>

            {error ? (
              <div className={styles.error} role="alert">
                <span>{error}</span>
                {pendingOperation ? (
                  <button onClick={() => void runMutation(pendingOperation)}>
                    Retry safely
                  </button>
                ) : null}
              </div>
            ) : null}

            {view.action.kind === "understanding" ||
            view.action.kind === "understanding_failed" ? (
              <section className={styles.resultState} aria-busy={busy}>
                <p className={styles.eyebrow}>Your task is saved</p>
                <h2>
                  {view.action.kind === "understanding_failed"
                    ? "We paused before changing anything else"
                    : "Understanding this shopping turn"}
                </h2>
                <p>{view.action.notice}</p>
                {busy ? <LoadingStory searchExpected={false} /> : null}
                {view.action.kind === "understanding_failed" && !busy ? (
                  <button
                    className={styles.primaryButton}
                    onClick={() =>
                      void runMutation({
                        operation: "retry_context",
                        sessionId: view.sessionId,
                      })
                    }
                  >
                    Retry understanding
                  </button>
                ) : null}
              </section>
            ) : null}

            {view.action.kind === "ask" ? (
              <section className={styles.questionPanel} aria-busy={busy}>
                <p className={styles.eyebrow}>One useful question</p>
                <h2>{view.action.prompt}</h2>
                <p>{view.action.whyNow}</p>
                {view.action.responseMode === "single_select" ? (
                  <div className={styles.answerOptions}>
                    {view.action.options.map((option) => (
                      <button
                        key={option.ordinal}
                        onClick={() => answerOption(option.ordinal)}
                        disabled={busy}
                      >
                        {option.label}
                        <span aria-hidden="true">→</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <form className={styles.answerForm} onSubmit={answerText}>
                    <label htmlFor="open-answer">Your answer</label>
                    <div>
                      <input
                        id="open-answer"
                        value={openAnswer}
                        onChange={(event) => setOpenAnswer(event.target.value)}
                        disabled={busy}
                      />
                      <button className={styles.primaryButton} disabled={busy}>
                        Use this answer
                      </button>
                    </div>
                  </form>
                )}
                {busy ? <LoadingStory searchExpected={false} /> : null}
              </section>
            ) : null}

            {view.action.kind === "show_refine" ? (
              <section className={styles.resultState}>
                <p className={styles.eyebrow}>More context needed</p>
                <h2>A useful product search needs a little more detail</h2>
                <p>{view.action.notice}</p>
                <button className={styles.secondaryButton} onClick={newSearch}>
                  Rephrase the request
                </button>
              </section>
            ) : null}

            <EvidenceDecisionSupport
              view={view}
              busy={busy}
              onResearch={() =>
                void runMutation({
                  operation: "research",
                  sessionId: view.sessionId,
                })
              }
              onDeepen={() =>
                void runMutation({
                  operation: "deepen_research",
                  sessionId: view.sessionId,
                })
              }
              onToggleSaved={toggleSaved}
              onToggleRejected={toggleRejected}
              onResearchCandidate={researchCandidate}
            />
            <SavedProducts
              view={view}
              busy={busy}
              onToggleSaved={toggleSaved}
              onToggleRejected={toggleRejected}
            />
            <SavedComparison
              view={view}
              busy={busy}
              onResearchCandidate={researchCandidate}
              onToggleSaved={toggleSaved}
            />
            <SearchResults
              view={view}
              busy={busy}
              onResume={() =>
                void runMutation({
                  operation: "resume_search",
                  sessionId: view.sessionId,
                })
              }
              onNewSearch={newSearch}
              onToggleSaved={toggleSaved}
              onToggleRejected={toggleRejected}
            />
            {view.action.kind === "search" &&
            view.action.search !== null &&
            view.action.search.status !== "running" ? (
              <form className={styles.refineComposer} onSubmit={refine}>
                <label htmlFor="refine-request">
                  Refine what you’re looking for
                </label>
                <div>
                  <textarea
                    id="refine-request"
                    value={refinement}
                    onChange={(event) => setRefinement(event.target.value)}
                    placeholder="These brands are too obscure. Keep everything else, but favour chunkier wireless options…"
                    rows={3}
                    disabled={busy}
                  />
                  <button className={styles.primaryButton} disabled={busy}>
                    Update my priorities
                  </button>
                </div>
                <p>
                  Your original request stays intact. Only this new turn can
                  update the current brief.
                </p>
              </form>
            ) : null}
            <RejectedProducts view={view} busy={busy} onUndo={toggleRejected} />
          </div>
          <Brief view={view} />
        </div>
      )}
      <footer className={styles.footer}>
        <span>Consider is a working prototype.</span>
        <span>
          Direct retailer links appear when supplied; otherwise we preserve the
          Google Shopping source.
        </span>
      </footer>
    </main>
  );
}
