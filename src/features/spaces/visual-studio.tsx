"use client";
/* eslint-disable @next/next/no-img-element -- Bounded local room/render image routes. */
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { spaceViewSchema, type SpaceView } from "./contracts";
import {
  visualCollectionSchema,
  visualViewSchema,
  type VisualCollection,
} from "./visual-contracts";
import styles from "./visual-studio.module.css";

async function jsonRequest(url: string, body?: unknown) {
  const response = await fetch(
    url,
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : { cache: "no-store" },
  );
  const value = await response.json();
  if (!response.ok)
    throw new Error(
      typeof value?.error?.message === "string"
        ? value.error.message
        : "Unable to load this design. Your saved space is unchanged.",
    );
  return value as unknown;
}
type ProductChoice = { listingId: string; placement: string };
export function VisualStudio({ spaceId }: { spaceId: string }) {
  return <Studio key={spaceId} spaceId={spaceId} />;
}
function Studio({ spaceId }: { spaceId: string }) {
  const [room, setRoom] = useState<SpaceView | null>(null);
  const [collection, setCollection] = useState<VisualCollection | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [original, setOriginal] = useState(false);
  const [name, setName] = useState("");
  const [direction, setDirection] = useState("");
  const [photo, setPhoto] = useState("");
  const [referenceIds, setReferenceIds] = useState<string[]>([]);
  const [products, setProducts] = useState<ProductChoice[]>([]);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const pendingSave = useRef<{ json: string; id: string } | null>(null);
  const readSequence = useRef(0);
  const fetchState = useCallback(async () => {
    const [space, visuals] = await Promise.all([
      jsonRequest(`/api/spaces/${spaceId}`),
      jsonRequest(`/api/spaces/${spaceId}/visuals`),
    ]);
    return {
      room: spaceViewSchema.parse(space),
      collection: visualCollectionSchema.parse(visuals),
    };
  }, [spaceId]);
  const load = useCallback(async () => {
    const sequence = ++readSequence.current;
    const next = await fetchState();
    if (sequence !== readSequence.current) return;
    setRoom(next.room);
    setCollection(next.collection);
  }, [fetchState]);
  useEffect(() => {
    let active = true;
    const sequence = ++readSequence.current;
    void fetchState()
      .then((next) => {
        if (active && sequence === readSequence.current) {
          setRoom(next.room);
          setCollection(next.collection);
        }
      })
      .catch(() => {
        if (active)
          setError("Your space could not be loaded. Reload to try again.");
      });
    return () => {
      active = false;
    };
  }, [fetchState]);
  const running = collection?.designs.some((d) => d.status === "running");
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      void load().catch(() => {});
    }, 5000);
    return () => clearInterval(timer);
  }, [load, running]);
  const design =
    collection?.designs.find((d) => d.id === selected) ??
    collection?.designs[0];
  const basePhoto =
    room?.assets.find((a) => a.id === design?.basis.assetIds[0]) ??
    room?.assets[0];
  async function save() {
    if (!room) return;
    setBusy(true);
    setError("");
    setNotice("");
    const first = photo || room.assets[0]?.id;
    const input = {
      expectedRevision: room.currentRevision,
      name,
      direction,
      assetIds: [first, ...referenceIds.filter((id) => id !== first)].slice(
        0,
        5,
      ),
      products,
    };
    const encoded = JSON.stringify(input);
    if (pendingSave.current?.json !== encoded)
      pendingSave.current = { json: encoded, id: crypto.randomUUID() };
    try {
      const saved = visualViewSchema.parse(
        await jsonRequest(`/api/spaces/${spaceId}/visuals`, {
          ...input,
          actionId: pendingSave.current.id,
        }),
      );
      setSelected(saved.id);
      setOriginal(false);
      setConsent(false);
      await load();
      setNotice(
        "Design saved with this space version and selected products. No image has been generated yet.",
      );
      pendingSave.current = null;
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Unable to save. Your draft is kept here.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function render() {
    if (!design || !consent) return;
    setBusy(true);
    setError("");
    setNotice(
      "Generating one concept image. This can take a few minutes; your saved design is safe.",
    );
    try {
      const pending = jsonRequest(
        `/api/spaces/${spaceId}/visuals/${design.id}`,
        { consentToImageProvider: true },
      );
      // The server durably claims the operation; status refresh never resubmits it.
      const result = visualViewSchema.parse(await pending);
      await load();
      setOriginal(false);
      setNotice(
        result.status === "completed"
          ? "Concept saved. Compare it with your actual space before trusting the design."
          : (result.failure ??
              "Generation is in progress. Refresh status to check it."),
      );
    } catch {
      setError(
        "Could not confirm the result. Refresh status before doing anything else; do not assume the provider request failed.",
      );
    } finally {
      setBusy(false);
      setConsent(false);
    }
  }
  return (
    <main className={styles.shell}>
      <nav className={styles.nav}>
        <Link href={`/spaces/${spaceId}`}>← {room?.name ?? "Your space"}</Link>
        <Link href="/live">consider / shopping ↗</Link>
      </nav>
      <header className={styles.header}>
        <p>SPACES / VISUAL DESIGNS</p>
        <h1>
          See what works
          <br />
          <em>in your space.</em>
        </h1>
        <p>
          Keep the space you know. Explore what a few considered changes could
          do.
        </p>
      </header>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <p role="status">{notice}</p>
      {!room || !collection ? (
        <p>Loading saved space…</p>
      ) : (
        <>
          <div className={styles.layout}>
            <section className={styles.stage} aria-label="Space design preview">
              <div className={styles.stageHeader}>
                <h2>{design?.basis.name ?? room.name}</h2>
                {design?.imageUrl && (
                  <div
                    className={styles.toggle}
                    aria-label="Compare original and concept"
                  >
                    <button
                      type="button"
                      aria-pressed={original}
                      onClick={() => setOriginal(true)}
                    >
                      Original
                    </button>
                    <button
                      type="button"
                      aria-pressed={!original}
                      onClick={() => setOriginal(false)}
                    >
                      Concept
                    </button>
                  </div>
                )}
              </div>
              {design?.imageUrl && !original ? (
                <img
                  className={styles.hero}
                  src={design.imageUrl}
                  alt={`Generated concept for ${design.basis.name}; approximate appearance, not verified fit`}
                />
              ) : basePhoto ? (
                <img
                  className={styles.hero}
                  src={basePhoto.url}
                  alt={`Original uploaded view of ${room.name}`}
                />
              ) : (
                <div className={styles.empty}>
                  <h3>Start with your actual space.</h3>
                  <p>
                    Add a few photos from different corners. We won’t substitute
                    a generic space.
                  </p>
                  <Link href={`/spaces/${spaceId}`}>Add space photos →</Link>
                </div>
              )}
              <p className={styles.caption}>
                {design?.imageUrl && !original
                  ? "AI concept · Not a measured 3D model. Product appearance, fit and clearances are unverified."
                  : "Original uploaded image · Not a generated concept."}
              </p>
              {design && (
                <div className={styles.savedInfo}>
                  <p>{design.basis.direction}</p>
                  <p className={styles.caption}>
                    {design.roomRevision !== room.currentRevision
                      ? "Earlier space version — this design has not been updated to your current space."
                      : "Saved against the current space version."}
                  </p>
                  {design.basis.roomState.items.some(
                    (i) => i.intent === "keep",
                  ) && (
                    <p>
                      <strong>Keep:</strong>{" "}
                      {design.basis.roomState.items
                        .filter((i) => i.intent === "keep")
                        .map((i) => i.label)
                        .join(" · ")}
                    </p>
                  )}
                  {design.basis.products.length > 0 && (
                    <>
                      <h3>Products in this idea</h3>
                      <p className={styles.caption}>
                        Reference photos guide the render; exact variant, scale
                        and finish still need checking. Prices are observed, not
                        current quotes.
                      </p>
                      <ul className={styles.productList}>
                        {design.basis.products.map((p) => (
                          <li key={p.listingId}>
                            {p.imageUrl && (
                              <img
                                className={styles.productImage}
                                src={p.imageUrl}
                                alt={`Listing reference for ${p.title}`}
                                loading="lazy"
                                referrerPolicy="no-referrer"
                              />
                            )}
                            <strong>{p.title}</strong>
                            <span>{p.placement}</span>
                            <span>
                              {p.merchant ?? "Merchant not supplied"}
                              {p.priceAmountMinor !== null &&
                              p.priceCurrencyCode === "GBP"
                                ? ` · £${(p.priceAmountMinor / 100).toFixed(2)} observed`
                                : " · price to check"}
                            </span>
                            <a
                              href={p.url}
                              target="_blank"
                              rel="noreferrer noopener"
                            >
                              {p.destinationKind === "merchant"
                                ? "Check product with retailer ↗"
                                : "Open shopping listing ↗"}
                            </a>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                  {design.failure && (
                    <p role="status" className={styles.error}>
                      {design.failure}
                    </p>
                  )}
                  {design.status === "running" && (
                    <p>
                      Generation is in progress. This saved operation will not
                      be automatically retried.
                    </p>
                  )}
                  {design.status === "draft" && (
                    <div className={styles.renderAction}>
                      {collection.generationAvailable ? (
                        <>
                          <label className={styles.consent}>
                            <input
                              type="checkbox"
                              checked={consent}
                              onChange={(e) => setConsent(e.target.checked)}
                            />
                            Send the selected space photos, product references
                            and design to OpenAI for one paid concept render.
                          </label>
                          <p className={styles.caption}>
                            {design.basis.assetIds.length} selected space
                            image(s) and {design.basis.products.length} product
                            reference(s). Nothing is sent until you click
                            Generate.
                          </p>
                          <button
                            disabled={
                              busy ||
                              !consent ||
                              design.roomRevision !== room.currentRevision ||
                              Boolean(running)
                            }
                            onClick={() => void render()}
                          >
                            Generate this concept
                          </button>
                        </>
                      ) : (
                        <p>
                          Rendering is not configured on this instance. Your
                          space, design and product selections are saved. This
                          draft has not been sent to an image provider.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
              <button
                className={styles.quiet}
                disabled={busy}
                onClick={() =>
                  void load().catch(() => setError("Unable to refresh status."))
                }
              >
                Refresh saved status
              </button>
            </section>
            <aside className={styles.editor}>
              <p className={styles.eyebrow}>A NEW POSSIBILITY</p>
              <h2>Shape the idea</h2>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void save();
                }}
              >
                <label>
                  Design name
                  <input
                    required
                    maxLength={100}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="A warmer work corner"
                  />
                </label>
                <label>
                  What would you change?
                  <textarea
                    required
                    maxLength={1600}
                    rows={5}
                    value={direction}
                    onChange={(e) => setDirection(e.target.value)}
                    placeholder="Keep my desk and the window wall. Try a warmer lamp and a rug beside the chair."
                  />
                </label>
                <p className={styles.caption}>
                  Saved keep/replace intentions and your space design travel
                  with this idea. Layout preservation is a request to the model,
                  not a guarantee.
                </p>
                <label>
                  View to redesign
                  <select
                    value={photo || room.assets[0]?.id || ""}
                    onChange={(e) => {
                      setPhoto(e.target.value);
                      setReferenceIds((current) =>
                        current.filter((id) => id !== e.target.value),
                      );
                    }}
                  >
                    {room.assets.map((a, i) => (
                      <option key={a.id} value={a.id}>
                        View {i + 1} — {a.filename}
                      </option>
                    ))}
                  </select>
                </label>
                <fieldset className={styles.references}>
                  <legend>Other angles to include (optional)</legend>
                  <p className={styles.caption}>
                    Only the main view and photos you select here will be sent.
                    Choose up to four other angles.
                  </p>
                  {room.assets
                    .filter((a) => a.id !== (photo || room.assets[0]?.id))
                    .map((a) => (
                      <label key={a.id} className={styles.consent}>
                        <input
                          type="checkbox"
                          checked={referenceIds.includes(a.id)}
                          disabled={
                            !referenceIds.includes(a.id) &&
                            referenceIds.length >= 4
                          }
                          onChange={(e) =>
                            setReferenceIds((current) =>
                              e.target.checked
                                ? [...current, a.id]
                                : current.filter((id) => id !== a.id),
                            )
                          }
                        />
                        {a.filename}
                      </label>
                    ))}
                </fieldset>
                <h3>Try your saved products</h3>
                <p className={styles.caption}>
                  Save real items in shopping, then select up to four here. No
                  imaginary product links.
                </p>
                {products.map((choice, index) => (
                  <div key={choice.listingId} className={styles.choice}>
                    <strong>
                      {
                        collection.products.find(
                          (p) => p.listingId === choice.listingId,
                        )?.title
                      }
                    </strong>
                    <label>
                      Where should it go?
                      <input
                        required
                        maxLength={300}
                        value={choice.placement}
                        onChange={(e) =>
                          setProducts((current) =>
                            current.map((p, i) =>
                              i === index
                                ? { ...p, placement: e.target.value }
                                : p,
                            ),
                          )
                        }
                        placeholder="Beside the desk, replacing the old lamp"
                      />
                    </label>
                    <button
                      type="button"
                      className={styles.quiet}
                      onClick={() =>
                        setProducts((current) =>
                          current.filter((_, i) => i !== index),
                        )
                      }
                    >
                      Remove product
                    </button>
                  </div>
                ))}
                <label>
                  Add a saved product
                  <select
                    value=""
                    disabled={products.length >= 4}
                    onChange={(e) => {
                      if (e.target.value)
                        setProducts((current) => [
                          ...current,
                          { listingId: e.target.value, placement: "" },
                        ]);
                    }}
                  >
                    <option value="">Choose a saved item…</option>
                    {collection.products
                      .filter(
                        (p) =>
                          p.imageUrl &&
                          !products.some((c) => c.listingId === p.listingId),
                      )
                      .map((p) => (
                        <option key={p.listingId} value={p.listingId}>
                          {p.title}
                        </option>
                      ))}
                  </select>
                </label>
                {!collection.products.length && (
                  <Link href="/live">Find and save products in shopping ↗</Link>
                )}
                <button type="submit" disabled={busy || !room.assets.length}>
                  {busy ? "Working…" : "Save this design"}
                </button>
                <p className={styles.caption}>
                  Saving is local and does not generate an image or spend API
                  credit.
                </p>
              </form>
            </aside>
          </div>
          {collection.designs.length > 0 && (
            <section className={styles.history}>
              <h2>Your saved possibilities</h2>
              <div>
                {collection.designs.map((d) => (
                  <button
                    key={d.id}
                    className={styles.designCard}
                    aria-pressed={design?.id === d.id}
                    onClick={() => {
                      setSelected(d.id);
                      setOriginal(false);
                      setConsent(false);
                    }}
                  >
                    {d.imageUrl && (
                      <img src={d.imageUrl} alt="" loading="lazy" />
                    )}
                    <strong>{d.basis.name}</strong>
                    <span>
                      {d.status === "completed"
                        ? "Concept saved"
                        : d.status === "draft"
                          ? "Design saved · not rendered"
                          : d.status === "running"
                            ? "Generation in progress"
                            : "No completed render"}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}
        </>
      )}
      <footer className={styles.footer}>
        A space is one kind of shopping context. You can always shop without
        one.
      </footer>
    </main>
  );
}
