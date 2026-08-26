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

function ProductCard({
  listing,
  busy,
  onToggleSaved,
}: {
  listing: LiveListing;
  busy: boolean;
  onToggleSaved: (listing: LiveListing) => void;
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
        <div className={styles.productFacts}>
          <strong>{listing.priceText ?? "Price not supplied"}</strong>
          {listing.deliveryText ? <span>{listing.deliveryText}</span> : null}
          {listing.availabilityText ? (
            <span>{listing.availabilityText}</span>
          ) : null}
        </div>
        <a
          href={listing.destinationUrl}
          target="_blank"
          rel="noreferrer"
          className={styles.productLink}
        >
          {listing.destinationLabel}
          <span aria-hidden="true">↗</span>
        </a>
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
        <button
          className={listing.saved ? styles.savedButton : styles.saveButton}
          onClick={() => onToggleSaved(listing)}
          disabled={busy}
        >
          {listing.saved ? "Saved ✓" : "Save"}
        </button>
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
}: {
  view: LiveShoppingView;
  busy: boolean;
  onResume: () => void;
  onNewSearch: () => void;
  onToggleSaved: (listing: LiveListing) => void;
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
  return (
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
            of {search.queryCount} focused searches. No suitability ranking yet.
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
}

function SavedProducts({
  view,
  busy,
  onToggleSaved,
}: {
  view: LiveShoppingView;
  busy: boolean;
  onToggleSaved: (listing: LiveListing) => void;
}) {
  if (view.savedListings.length === 0) return null;
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
          />
        ))}
      </div>
    </section>
  );
}

export function LiveShopping() {
  const [view, setView] = useState<LiveShoppingView | null>(null);
  const [request, setRequest] = useState("");
  const [openAnswer, setOpenAnswer] = useState("");
  const [refinement, setRefinement] = useState("");
  const [restoring, setRestoring] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingOperation, setPendingOperation] = useState<unknown>(null);
  const autoResumeKey = useRef<string | null>(null);

  const acceptView = useCallback((next: LiveShoppingView) => {
    setView(next);
    setError(null);
    setPendingOperation(null);
    localStorage.removeItem(pendingMutationStorageKey);
  }, []);

  const runMutation = useCallback(
    async (operation: unknown) => {
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
      busy
    ) {
      return;
    }
    const key = `${view.sessionId}:${view.action.search?.completedQueryCount ?? 0}`;
    if (autoResumeKey.current === key) return;
    autoResumeKey.current = key;
    void runMutation({ operation: "resume_search", sessionId: view.sessionId });
  }, [busy, runMutation, view]);

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
    autoResumeKey.current = null;
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
                    Update and search again
                  </button>
                </div>
                <p>
                  Your original request stays intact. Only this new turn can
                  update the current brief.
                </p>
              </form>
            ) : null}
            <SavedProducts
              view={view}
              busy={busy}
              onToggleSaved={toggleSaved}
            />
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
