"use client";

import Image from "next/image";
import { FormEvent, useMemo, useState, useSyncExternalStore } from "react";
import {
  exactLookupPrompt,
  fixtureSnapshots,
  landingExamples,
  type FixtureCandidateCard,
  type FixtureQuestion,
  type FixtureViewKey,
} from "./fixtures";
import styles from "./shopping-preview.module.css";

type ShoppingPreviewProps = Readonly<{
  initialView: FixtureViewKey;
}>;

function normalizeRequest(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-GB");
}

const compactBriefQuery = "(max-width: 1180px)";

function subscribeToCompactViewport(onChange: () => void) {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function")
    return () => undefined;
  const mediaQuery = window.matchMedia(compactBriefQuery);
  mediaQuery.addEventListener("change", onChange);
  return () => mediaQuery.removeEventListener("change", onChange);
}

function getCompactViewportSnapshot() {
  return typeof window !== "undefined" &&
    typeof window.matchMedia === "function"
    ? window.matchMedia(compactBriefQuery).matches
    : false;
}

function getCompactViewportServerSnapshot() {
  return false;
}

export function ShoppingPreview({ initialView }: ShoppingPreviewProps) {
  const [viewKey, setViewKey] = useState(initialView);
  const [requestInput, setRequestInput] = useState("");
  const [refinementInput, setRefinementInput] = useState("");
  const [refinementNotice, setRefinementNotice] = useState<string | null>(null);
  const [formNotice, setFormNotice] = useState<string | null>(null);
  const [savedIds, setSavedIds] = useState<ReadonlySet<string>>(new Set());
  const [rejectedIds, setRejectedIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [lastRejected, setLastRejected] = useState<Readonly<{
    candidate: FixtureCandidateCard;
    wasSaved: boolean;
  }> | null>(null);
  const [resolvedQuestionKeys, setResolvedQuestionKeys] = useState<
    ReadonlySet<FixtureViewKey>
  >(new Set());
  const [hiddenBriefIds, setHiddenBriefIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [lastHiddenBrief, setLastHiddenBrief] = useState<Readonly<{
    id: string;
    text: string;
  }> | null>(null);
  const [appliedChange, setAppliedChange] = useState<string | null>(null);
  const [isSnapshotChangeDismissed, setSnapshotChangeDismissed] =
    useState(false);
  const [retailerNotice, setRetailerNotice] = useState<string | null>(null);
  const [briefOpenOverride, setBriefOpenOverride] = useState<boolean | null>(
    null,
  );
  const isCompactViewport = useSyncExternalStore(
    subscribeToCompactViewport,
    getCompactViewportSnapshot,
    getCompactViewportServerSnapshot,
  );
  const isBriefOpen = briefOpenOverride ?? !isCompactViewport;

  const snapshot = viewKey === "landing" ? null : fixtureSnapshots[viewKey];

  const visibleCandidates = useMemo(
    () =>
      snapshot?.candidates.filter(
        (candidate) => !rejectedIds.has(candidate.id),
      ) ?? [],
    [rejectedIds, snapshot],
  );

  function updateUrl(nextView: FixtureViewKey) {
    const url = nextView === "landing" ? "/" : `/?fixture=${nextView}`;
    window.history.replaceState({}, "", url);
  }

  function moveTo(nextView: FixtureViewKey, change: string | null = null) {
    setViewKey(nextView);
    setAppliedChange(change);
    setFormNotice(null);
    setRefinementNotice(null);
    setRetailerNotice(null);
    setSnapshotChangeDismissed(false);
    updateUrl(nextView);
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  function startNewSearch() {
    setViewKey("landing");
    setRequestInput("");
    setRefinementInput("");
    setRefinementNotice(null);
    setFormNotice(null);
    setSavedIds(new Set());
    setRejectedIds(new Set());
    setLastRejected(null);
    setResolvedQuestionKeys(new Set());
    setHiddenBriefIds(new Set());
    setLastHiddenBrief(null);
    setAppliedChange(null);
    setSnapshotChangeDismissed(false);
    setRetailerNotice(null);
    setBriefOpenOverride(null);
    updateUrl("landing");
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  function submitRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = normalizeRequest(requestInput);
    const example = landingExamples.find(
      (item) => normalizeRequest(item.prompt) === normalized,
    );

    if (example) {
      moveTo(example.target);
      return;
    }

    if (normalized === normalizeRequest(exactLookupPrompt)) {
      moveTo("exact-results");
      return;
    }

    setFormNotice(
      "This design prototype uses prepared journeys. Choose one below so every interaction stays honest.",
    );
  }

  function toggleSaved(candidateId: string) {
    setSavedIds((current) => {
      const next = new Set(current);
      if (next.has(candidateId)) next.delete(candidateId);
      else next.add(candidateId);
      return next;
    });
  }

  function rejectCandidate(candidate: FixtureCandidateCard) {
    const wasSaved = savedIds.has(candidate.id);
    setRejectedIds((current) => new Set(current).add(candidate.id));
    setSavedIds((current) => {
      const next = new Set(current);
      next.delete(candidate.id);
      return next;
    });
    setLastRejected({ candidate, wasSaved });
  }

  function undoRejection() {
    if (!lastRejected) return;
    setRejectedIds((current) => {
      const next = new Set(current);
      next.delete(lastRejected.candidate.id);
      return next;
    });
    if (lastRejected.wasSaved) {
      setSavedIds((current) => new Set(current).add(lastRejected.candidate.id));
    }
    setLastRejected(null);
  }

  function resolveQuestion(
    nextView: FixtureViewKey,
    change: string | null = null,
  ) {
    setResolvedQuestionKeys((current) => new Set(current).add(viewKey));
    moveTo(nextView, change);
  }

  function hideBriefLine(id: string, text: string) {
    setHiddenBriefIds((current) => new Set(current).add(id));
    setLastHiddenBrief({ id, text });
  }

  function undoBriefChange() {
    if (!lastHiddenBrief) return;
    setHiddenBriefIds((current) => {
      const next = new Set(current);
      next.delete(lastHiddenBrief.id);
      return next;
    });
    setLastHiddenBrief(null);
  }

  function submitRefinement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!snapshot?.refinement || !refinementInput.trim()) return;
    const normalizedInput = normalizeRequest(refinementInput);
    const isPreparedInput = snapshot.refinement.preparedInputs.some(
      (preparedInput) => normalizeRequest(preparedInput) === normalizedInput,
    );

    if (!isPreparedInput) {
      setRefinementNotice(
        "This prototype can only apply the prepared comfort-with-glasses refinement. Your wording has not changed the shortlist.",
      );
      return;
    }

    setRefinementInput("");
    moveTo(snapshot.refinement.target, snapshot.refinement.appliedChange);
  }

  if (!snapshot) {
    return (
      <div className={styles.shell} data-fixture-view="landing">
        <SiteHeader savedCount={savedIds.size} onNewSearch={startNewSearch} />
        <main className={styles.landingMain}>
          <section className={styles.hero} aria-labelledby="landing-heading">
            <p className={styles.eyebrow}>Shopping, with judgement</p>
            <h1 id="landing-heading">
              Find the thing that fits your life—not just your search.
            </h1>
            <p className={styles.heroCopy}>
              Describe what you need in your own words. We’ll keep what matters
              visible, surface honest trade-offs, and help you narrow with
              confidence.
            </p>

            <form className={styles.requestForm} onSubmit={submitRequest}>
              <label htmlFor="shopping-request">
                What are you looking for?
              </label>
              <div className={styles.requestField}>
                <textarea
                  id="shopping-request"
                  value={requestInput}
                  onChange={(event) => setRequestInput(event.target.value)}
                  placeholder="Tell us what you’re trying to find, and what matters about it…"
                  rows={3}
                />
                <button type="submit">
                  Start looking <span aria-hidden="true">→</span>
                </button>
              </div>
              {formNotice ? (
                <p className={styles.formNotice} role="status">
                  {formNotice}
                </p>
              ) : null}
            </form>
          </section>

          <section
            className={styles.exampleSection}
            aria-labelledby="example-heading"
          >
            <div className={styles.sectionIntro}>
              <p className={styles.eyebrow}>Prepared journeys</p>
              <h2 id="example-heading">See how a real decision starts</h2>
            </div>
            <div className={styles.exampleGrid}>
              {landingExamples.map((example, index) => (
                <button
                  className={styles.exampleCard}
                  key={example.id}
                  type="button"
                  onClick={() => {
                    setRequestInput(example.prompt);
                    moveTo(example.target);
                  }}
                >
                  <span className={styles.exampleNumber}>0{index + 1}</span>
                  <span className={styles.exampleLabel}>{example.label}</span>
                  <span className={styles.examplePrompt}>{example.prompt}</span>
                  <span className={styles.exampleArrow} aria-hidden="true">
                    ↗
                  </span>
                </button>
              ))}
            </div>
            <button
              className={styles.exactLink}
              type="button"
              onClick={() => {
                setRequestInput(exactLookupPrompt);
                moveTo("exact-results");
              }}
            >
              Preview a request that needs no questions{" "}
              <span aria-hidden="true">→</span>
            </button>
          </section>

          <div className={styles.trustStrip}>
            <span aria-hidden="true">✦</span>
            <p>
              Evidence shown. Trade-offs surfaced. Recommendations ordered
              around your brief—not commercial signals.
            </p>
          </div>
        </main>
        <PrototypeFooter />
      </div>
    );
  }

  const currentAppliedChange =
    appliedChange ??
    (isSnapshotChangeDismissed ? null : snapshot.appliedChange);
  const allCandidatesRejected =
    snapshot.candidates.length > 0 &&
    visibleCandidates.length === 0 &&
    snapshot.candidates.every((candidate) => rejectedIds.has(candidate.id));

  return (
    <div className={styles.shell} data-fixture-view={viewKey}>
      <SiteHeader savedCount={savedIds.size} onNewSearch={startNewSearch} />
      <main className={styles.workspaceMain}>
        <header className={styles.taskHeader}>
          <p className={styles.eyebrow}>Your search</p>
          <h1>{snapshot.request}</h1>
        </header>

        <div className={styles.workspaceGrid}>
          <aside className={styles.briefColumn}>
            <details
              className={styles.brief}
              data-auto-compact={briefOpenOverride === null ? "true" : "false"}
              open={isBriefOpen}
              onToggle={(event) => {
                if (event.currentTarget.open !== isBriefOpen) {
                  setBriefOpenOverride(event.currentTarget.open);
                }
              }}
            >
              <summary>
                <span>
                  <span className={styles.eyebrow}>Current understanding</span>
                  <strong>What matters</strong>
                </span>
                <span className={styles.summaryCue} aria-hidden="true">
                  ⌄
                </span>
              </summary>
              <p className={styles.briefIntro}>
                Remove anything that no longer reflects what you want.
              </p>
              <ul>
                {snapshot.brief.map((item) =>
                  hiddenBriefIds.has(item.id) ? null : (
                    <li key={item.id}>
                      <span
                        className={styles.briefMark}
                        data-tone={item.tone}
                        aria-hidden="true"
                      >
                        {item.tone === "neutral" ? "·" : "✓"}
                      </span>
                      <span>{item.text}</span>
                      <button
                        type="button"
                        onClick={() => hideBriefLine(item.id, item.text)}
                        aria-label={`Remove ${item.text} from the preview brief`}
                      >
                        ×
                      </button>
                    </li>
                  ),
                )}
              </ul>
              {lastHiddenBrief ? (
                <button
                  className={styles.briefUndo}
                  type="button"
                  onClick={undoBriefChange}
                >
                  Undo removing “{lastHiddenBrief.text}”
                </button>
              ) : null}
            </details>

            <div className={styles.briefTrust}>
              <span aria-hidden="true">✦</span>
              <p>Your brief guides the order. Commercial signals never do.</p>
            </div>
          </aside>

          <section
            className={styles.resultsColumn}
            aria-labelledby="results-heading"
          >
            {currentAppliedChange ? (
              <div className={styles.changeNotice} role="status">
                <span aria-hidden="true">✓</span>
                <p>{currentAppliedChange}</p>
                <button
                  type="button"
                  onClick={() => {
                    setAppliedChange(null);
                    setSnapshotChangeDismissed(true);
                  }}
                >
                  Dismiss
                </button>
              </div>
            ) : null}

            {snapshot.question && !resolvedQuestionKeys.has(viewKey) ? (
              <QuestionPanel
                question={snapshot.question}
                onChoose={(target, change) => resolveQuestion(target, change)}
                onSkip={() =>
                  resolveQuestion(snapshot.question?.skipTarget ?? viewKey)
                }
              />
            ) : null}

            {snapshot.notice ? (
              <div className={styles.partialNotice} role="status">
                <span aria-hidden="true">!</span>
                <p>{snapshot.notice}</p>
                <button
                  type="button"
                  onClick={() => moveTo("headphones-results")}
                >
                  Retry
                </button>
              </div>
            ) : null}

            <div className={styles.resultsIntro}>
              <p className={styles.eyebrow}>{snapshot.kicker}</p>
              <h2 id="results-heading">{snapshot.heading}</h2>
              <p>{snapshot.intro}</p>
            </div>

            {snapshot.emptyState ? (
              <NoMatches
                emptyState={snapshot.emptyState}
                onRelax={() => moveTo("no-matches-budget-relaxed")}
              />
            ) : (
              <>
                <div className={styles.productGrid}>
                  {visibleCandidates.map((candidate, index) => (
                    <CandidateCard
                      candidate={candidate}
                      index={index}
                      isSaved={savedIds.has(candidate.id)}
                      key={candidate.id}
                      onSave={() => toggleSaved(candidate.id)}
                      onReject={() => rejectCandidate(candidate)}
                      onRetailer={() =>
                        setRetailerNotice(
                          `${candidate.name} uses a safe fixture retailer target in this prototype.`,
                        )
                      }
                    />
                  ))}
                </div>

                {allCandidatesRejected ? (
                  <div className={styles.allRejected}>
                    <p className={styles.eyebrow}>Shortlist cleared</p>
                    <h3>You’ve set every current option aside.</h3>
                    <p>
                      {snapshot.refinement
                        ? "Undo the last rejection or use the refinement below."
                        : "Undo the last rejection or start a new search."}
                    </p>
                  </div>
                ) : null}
              </>
            )}

            {lastRejected ? (
              <div className={styles.undoToast} role="status">
                <p>
                  <strong>{lastRejected.candidate.name}</strong> set aside for
                  this search.
                </p>
                <button type="button" onClick={undoRejection}>
                  Undo
                </button>
              </div>
            ) : null}

            {retailerNotice ? (
              <div className={styles.retailerToast} role="status">
                <p>{retailerNotice}</p>
                <button type="button" onClick={() => setRetailerNotice(null)}>
                  Close
                </button>
              </div>
            ) : null}

            {snapshot.refinement && snapshot.candidates.length > 0 ? (
              <form
                className={styles.refinementForm}
                onSubmit={submitRefinement}
              >
                <label htmlFor="refinement">Refine this shortlist</label>
                <div>
                  <input
                    id="refinement"
                    value={refinementInput}
                    onChange={(event) => {
                      setRefinementInput(event.target.value);
                      setRefinementNotice(null);
                    }}
                    placeholder={snapshot.refinement.placeholder}
                  />
                  <button type="submit">
                    Update <span aria-hidden="true">→</span>
                  </button>
                </div>
                <p>{snapshot.refinement.helper}</p>
                {refinementNotice ? (
                  <p className={styles.formNotice} role="status">
                    {refinementNotice}
                  </p>
                ) : null}
              </form>
            ) : null}
          </section>
        </div>
      </main>
      <PrototypeFooter />
    </div>
  );
}

function SiteHeader({
  savedCount,
  onNewSearch,
}: Readonly<{ savedCount: number; onNewSearch: () => void }>) {
  return (
    <header className={styles.siteHeader}>
      <button
        aria-label="Consider working prototype home"
        className={styles.wordmark}
        type="button"
        onClick={onNewSearch}
      >
        consider<span>.</span>
      </button>
      <nav aria-label="Shopping task">
        <button type="button" onClick={onNewSearch}>
          New search
        </button>
        <span className={styles.savedCount}>Saved {savedCount}</span>
      </nav>
    </header>
  );
}

function QuestionPanel({
  question,
  onChoose,
  onSkip,
}: Readonly<{
  question: FixtureQuestion;
  onChoose: (target: FixtureViewKey, change: string | null) => void;
  onSkip: () => void;
}>) {
  return (
    <section
      className={styles.questionPanel}
      aria-labelledby="question-heading"
    >
      <p className={styles.eyebrow}>{question.eyebrow}</p>
      <h2 id="question-heading">{question.title}</h2>
      <p>{question.detail}</p>
      <div className={styles.questionChoices}>
        {question.choices.map((choice) => (
          <button
            key={choice.label}
            type="button"
            onClick={() => onChoose(choice.target, choice.appliedChange)}
          >
            {choice.label} <span aria-hidden="true">→</span>
          </button>
        ))}
        <button className={styles.skipQuestion} type="button" onClick={onSkip}>
          Show me options now
        </button>
      </div>
    </section>
  );
}

function CandidateCard({
  candidate,
  index,
  isSaved,
  onSave,
  onReject,
  onRetailer,
}: Readonly<{
  candidate: FixtureCandidateCard;
  index: number;
  isSaved: boolean;
  onSave: () => void;
  onReject: () => void;
  onRetailer: () => void;
}>) {
  return (
    <article
      className={styles.productCard}
      aria-labelledby={`${candidate.id}-title`}
    >
      <div className={styles.productImage}>
        {candidate.image ? (
          <Image
            src={candidate.image}
            alt={candidate.imageAlt}
            fill
            loading="eager"
            sizes="(max-width: 720px) 100vw, (max-width: 1180px) 50vw, 33vw"
          />
        ) : (
          <div className={styles.imageFallback}>
            <span aria-hidden="true">◌</span>
            <p>Image unavailable</p>
          </div>
        )}
        <span className={styles.cardNumber}>0{index + 1}</span>
      </div>

      <div className={styles.productIdentity}>
        <p>{candidate.maker}</p>
        <h3 id={`${candidate.id}-title`}>{candidate.name}</h3>
        <div>
          <span>{candidate.merchant}</span>
          <span>Observed {candidate.observedPrice}</span>
        </div>
      </div>

      <dl className={styles.productReasoning}>
        <div>
          <dt>Why it may fit</dt>
          <dd>{candidate.mayFit}</dd>
        </div>
        <div>
          <dt>Worth knowing</dt>
          <dd>{candidate.worthKnowing}</dd>
        </div>
      </dl>

      <div className={styles.productActions}>
        <button
          className={isSaved ? styles.savedButton : styles.saveButton}
          type="button"
          onClick={onSave}
          aria-pressed={isSaved}
        >
          <span aria-hidden="true">{isSaved ? "♥" : "♡"}</span>
          {isSaved ? "Saved" : "Save"}
        </button>
        <button type="button" onClick={onReject}>
          Not for me
        </button>
        <button
          className={styles.retailerButton}
          type="button"
          onClick={onRetailer}
        >
          Preview retailer
        </button>
      </div>
    </article>
  );
}

function NoMatches({
  emptyState,
  onRelax,
}: Readonly<{
  emptyState: NonNullable<
    (typeof fixtureSnapshots)["no-matches"]["emptyState"]
  >;
  onRelax: () => void;
}>) {
  const [showClosestDimensions, setShowClosestDimensions] = useState(false);

  return (
    <section className={styles.noMatches} aria-labelledby="no-matches-heading">
      <div className={styles.noMatchesMark} aria-hidden="true">
        0
      </div>
      <div>
        <p className={styles.eyebrow}>{emptyState.eyebrow}</p>
        <h3 id="no-matches-heading">{emptyState.title}</h3>
        <p>{emptyState.detail}</p>
        <div className={styles.conflictLine}>{emptyState.conflict}</div>
        <div className={styles.noMatchActions}>
          <button type="button" onClick={onRelax}>
            Stretch the budget to £40
          </button>
          <button type="button" onClick={() => setShowClosestDimensions(true)}>
            Show closest dimensions
          </button>
        </div>
        {showClosestDimensions ? (
          <p className={styles.dimensionNote} role="status">
            The closest option under £25 was 54 × 28 cm. The first credible
            options inside 42 × 20 cm start at £36.
          </p>
        ) : null}
      </div>
    </section>
  );
}

function PrototypeFooter() {
  return (
    <footer className={styles.prototypeFooter}>
      <p>
        Working fixture prototype · fictional products and prepared journeys
      </p>
      <p>GB / GBP</p>
    </footer>
  );
}
