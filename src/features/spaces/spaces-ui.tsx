"use client";

/* eslint-disable @next/next/no-img-element -- Local bounded immutable images; no thumbnail pipeline in V0-10. */
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { z } from "zod";
import {
  factKindSchema,
  roomTypeSchema,
  spaceViewSchema,
  type SpaceOperation,
  type SpaceView,
} from "./contracts";
import styles from "./spaces.module.css";

class RoomRequestError extends Error {
  constructor(
    message: string,
    public code: string,
  ) {
    super(message);
  }
}
async function responseJson(response: Response) {
  const json: unknown = await response.json();
  if (!response.ok) {
    const safe = z
      .object({ error: z.object({ message: z.string(), code: z.string() }) })
      .safeParse(json);
    throw new RoomRequestError(
      safe.success
        ? safe.data.error.message
        : "The room could not be saved. Please try again.",
      safe.success ? safe.data.error.code : "unavailable",
    );
  }
  return json;
}
async function requestRoom(url: string, body?: unknown) {
  return spaceViewSchema.parse(
    await responseJson(
      await fetch(
        url,
        body
          ? {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            }
          : { cache: "no-store" },
      ),
    ),
  );
}
function readable(value: string) {
  return value.replaceAll("_", " ");
}
function message(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Something went wrong. Your saved room is unchanged.";
}
function Shell({ children }: { children: ReactNode }) {
  return (
    <main className={styles.shell}>
      <header className={styles.nav}>
        <Link href="/spaces" className={styles.brand}>
          consider<span> / spaces</span>
        </Link>
        <Link href="/live">Shopping ↗</Link>
      </header>
      {children}
      <footer className={styles.footer}>
        A little context, kept for the decisions ahead.
        <span>
          Local founder preview · Your rooms are not yet connected to shopping.
        </span>
      </footer>
    </main>
  );
}

export function SpacesPage() {
  const router = useRouter();
  const [rooms, setRooms] = useState<SpaceView[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      setError("");
      const result = z
        .object({ spaces: z.array(spaceViewSchema) })
        .parse(
          await responseJson(await fetch("/api/spaces", { cache: "no-store" })),
        );
      setRooms(result.spaces);
    } catch (e) {
      setError(message(e));
    }
  }, []);
  useEffect(() => {
    let active = true;
    fetch("/api/spaces", { cache: "no-store" })
      .then(responseJson)
      .then((json) => {
        if (active)
          setRooms(
            z.object({ spaces: z.array(spaceViewSchema) }).parse(json).spaces,
          );
      })
      .catch((error: unknown) => {
        if (active) setError(message(error));
      });
    return () => {
      active = false;
    };
  }, [load]);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const space = await requestRoom("/api/spaces", {
        name: form.get("name"),
        roomType: form.get("roomType") || null,
      });
      router.push(`/spaces/${space.id}`);
    } catch (e) {
      setError(message(e));
      setBusy(false);
    }
  }
  return (
    <Shell>
      <section className={styles.hero}>
        <p className={styles.eyebrow}>A home for your context</p>
        <h1>Your spaces</h1>
        <p className={styles.lead}>
          Add the room once. CONSIDER can use it for future furniture and decor
          decisions.
        </p>
      </section>
      {error && (
        <div className={styles.error} role="alert" id="spaces-error">
          {error} <button onClick={() => void load()}>Try loading again</button>
        </div>
      )}
      <div className={styles.indexGrid}>
        <section className={styles.create}>
          <span className={styles.number}>01 / Start with a room</span>
          <h2>Add a space</h2>
          <p>No tape measure needed. A name is enough to begin.</p>
          <form onSubmit={create}>
            <fieldset
              disabled={busy}
              aria-describedby={error ? "spaces-error" : undefined}
            >
              <label htmlFor="space-name">Space name</label>
              <input
                id="space-name"
                name="name"
                placeholder="e.g. Bedroom"
                required
                maxLength={100}
              />
              <label htmlFor="space-type">
                Room type <span>(optional)</span>
              </label>
              <select id="space-type" name="roomType" defaultValue="">
                <option value="">Choose later</option>
                {roomTypeSchema.options.map((type) => (
                  <option key={type} value={type}>
                    {readable(type)}
                  </option>
                ))}
              </select>
              <button className={styles.primary} type="submit">
                {busy ? "Creating…" : "+ Add a space"}
              </button>
            </fieldset>
          </form>
        </section>
        <section aria-label="Saved spaces" className={styles.roomList}>
          {rooms === null ? (
            <p role="status">Loading your spaces…</p>
          ) : rooms.length === 0 ? (
            <div className={styles.empty}>
              <div className={styles.emptyShape} aria-hidden="true" />
              <h2>Make room for better decisions.</h2>
              <p>
                Photos, the things you want to keep, and an idea of what comes
                next. All in one place, ready when you return.
              </p>
            </div>
          ) : (
            rooms.map((room) => (
              <Link
                href={`/spaces/${room.id}`}
                key={room.id}
                className={styles.roomCard}
              >
                {room.assets[0] ? (
                  <img src={room.assets[0].url} alt="" loading="lazy" />
                ) : (
                  <div className={styles.coverEmpty} aria-hidden="true">
                    {room.name.slice(0, 1)}
                  </div>
                )}
                <div>
                  <p className={styles.eyebrow}>
                    {room.assets.length}{" "}
                    {room.assets.length === 1 ? "photo" : "photos"}
                  </p>
                  <h2>{room.name}</h2>
                  <p>
                    {room.state.design.goal ||
                      "Your room, ready to take shape."}
                  </p>
                  <small>
                    {
                      room.state.facts.filter((f) => f.status === "confirmed")
                        .length
                    }{" "}
                    confirmed facts · {room.state.measurements.length}{" "}
                    measurements
                  </small>
                  <span className={styles.open}>Open space →</span>
                </div>
              </Link>
            ))
          )}
        </section>
      </div>
    </Shell>
  );
}
type OperationBody = SpaceOperation extends infer T
  ? T extends SpaceOperation
    ? Omit<T, "expectedRevision">
    : never
  : never;
type Act = (operation: OperationBody) => Promise<boolean>;

export function SpacePage({ spaceId }: { spaceId: string }) {
  // Route identity owns the entire edit buffer and revision reference. Navigating
  // to a newer/older room must never reuse another room's optimistic client state.
  return <SpaceRoom key={spaceId} spaceId={spaceId} />;
}
function SpaceRoom({ spaceId }: { spaceId: string }) {
  const [room, setRoom] = useState<SpaceView | null>(null);
  const roomRef = useRef<SpaceView | null>(null);
  const [error, setError] = useState("");
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [notice, setNotice] = useState("");
  const accept = useCallback((next: SpaceView) => {
    if (
      !roomRef.current ||
      next.currentRevision >= roomRef.current.currentRevision
    ) {
      roomRef.current = next;
      setRoom(next);
    }
  }, []);
  const load = useCallback(async () => {
    try {
      accept(await requestRoom(`/api/spaces/${spaceId}`));
      setError("");
      setStale(false);
    } catch (e) {
      setError(message(e));
    }
  }, [spaceId, accept]);
  useEffect(() => {
    let active = true;
    requestRoom(`/api/spaces/${spaceId}`)
      .then((next) => {
        if (active) accept(next);
      })
      .catch((error: unknown) => {
        if (active) setError(message(error));
      });
    return () => {
      active = false;
    };
  }, [spaceId, accept]);
  const reportError = (e: unknown) => {
    setError(message(e));
    setStale(e instanceof RoomRequestError && e.code === "stale_revision");
  };
  const act: Act = async (operation) => {
    if (saving.current || !roomRef.current) return false;
    saving.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      accept(
        await requestRoom(`/api/spaces/${spaceId}`, {
          ...operation,
          expectedRevision: roomRef.current.currentRevision,
        }),
      );
      setNotice("Saved to your room.");
      return true;
    } catch (e) {
      reportError(e);
      return false;
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };
  if (!room)
    return (
      <Shell>
        <Link href="/spaces">← Your spaces</Link>
        {error ? (
          <div role="alert" className={styles.error}>
            {error}
            <button onClick={() => void load()}>Try again</button>
          </div>
        ) : (
          <p role="status">Opening your space…</p>
        )}
      </Shell>
    );
  const confirmed = room.state.facts.filter((f) => f.status === "confirmed"),
    proposed = room.state.facts.filter((f) => f.status === "proposed");
  return (
    <Shell>
      <Link href="/spaces" className={styles.back}>
        ← Your spaces
      </Link>
      <section className={styles.roomHero}>
        <div>
          <p className={styles.eyebrow}>
            {room.roomType ? readable(room.roomType) : "Your space"}
          </p>
          <h1>{room.name}</h1>
          <p className={styles.lead}>
            {room.state.design.goal ||
              "A room you know. A direction you can come back to."}
          </p>
        </div>
        <p className={styles.updated}>
          Saved{" "}
          <time dateTime={room.updatedAt}>
            {new Date(room.updatedAt).toLocaleString("en-GB", {
              day: "numeric",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </time>
          <span>Photos and room details persist when you leave.</span>
        </p>
      </section>
      {error && (
        <div role="alert" className={styles.error} id="room-error">
          {error}
          {stale && (
            <button onClick={() => void load()}>Reload latest room</button>
          )}
        </div>
      )}
      <p role="status" className={styles.status}>
        {notice}
      </p>
      <PhotoSection
        room={room}
        current={() => roomRef.current!}
        accept={accept}
        onError={reportError}
      />
      <section className={styles.analysis}>
        <div>
          <h2>
            {room.analysisMode === "fictional_fixture"
              ? "Fictional development fixture"
              : "Your photos, safely kept"}
          </h2>
          <p>
            {room.analysisMode === "fictional_fixture"
              ? "The sample observations below are scripted for testing. They do not describe or analyse these photos."
              : "Automatic photo analysis is not available yet. Add what you know below; your photos are saved for later."}
          </p>
        </div>
        {room.analysisMode === "fictional_fixture" && (
          <button
            disabled={busy || !room.assets.length}
            onClick={() =>
              void act({
                operation: "analyse_photos",
                assetIds: room.assets.map((a) => a.id),
              })
            }
          >
            Load fictional observations
          </button>
        )}
      </section>
      <div className={styles.columns}>
        <div>
          <section className={styles.panel} aria-labelledby="design-heading">
            <p className={styles.eyebrow}>
              The direction, not a generated image
            </p>
            <h2 id="design-heading">{room.name} design</h2>
            {room.state.design.goal ? (
              <p className={styles.designGoal}>{room.state.design.goal}</p>
            ) : (
              <p>How would you like this room to feel or work?</p>
            )}
            <div className={styles.designLists}>
              {(["keep", "replace"] as const).map((intent) => (
                <div key={intent}>
                  <h3>{intent === "keep" ? "Keep" : "Replace"}</h3>
                  <SimpleList
                    entries={room.state.items
                      .filter((i) => i.intent === intent)
                      .map((i) => i.label)}
                    empty="Nothing decided yet"
                  />
                </div>
              ))}
              <div>
                <h3>Add</h3>
                <SimpleList
                  entries={room.state.design.add}
                  empty="Room for an idea"
                />
              </div>
            </div>
            {room.state.design.palette.length > 0 && (
              <p>
                <strong>Palette</strong> ·{" "}
                {room.state.design.palette.join(" · ")}
              </p>
            )}
            {room.state.design.styles.length > 0 && (
              <p>
                <strong>Style direction</strong> ·{" "}
                {room.state.design.styles.join(" · ")}
              </p>
            )}
            {room.state.design.notes && <p>{room.state.design.notes}</p>}
            {room.state.design.budget && (
              <p>
                Optional room budget ·{" "}
                {new Intl.NumberFormat("en-GB", {
                  style: "currency",
                  currency: "GBP",
                }).format(room.state.design.budget.amountMinor / 100)}
              </p>
            )}
            <details className={styles.details}>
              <summary>Edit room design</summary>
              <DesignForm
                key={JSON.stringify(room.state.design)}
                room={room}
                busy={busy}
                act={act}
              />
            </details>
          </section>
          <section className={styles.panel} aria-labelledby="inventory-heading">
            <h2 id="inventory-heading">Already in the room</h2>
            <p>Keep what works. Decide what could change.</p>
            {room.state.items.length ? (
              <ul className={styles.records}>
                {room.state.items.map((item) => (
                  <li key={item.id}>
                    <strong>{item.label}</strong>
                    <label className={styles.intentLabel}>
                      Plan for {item.label}
                      <select
                        aria-label={`Plan for ${item.label}`}
                        value={item.intent}
                        disabled={busy}
                        onChange={(event) =>
                          void act({
                            operation: "set_item_intent",
                            itemId: item.id,
                            intent: event.target.value as
                              "keep" | "replace" | "undecided",
                          })
                        }
                      >
                        <option value="undecided">Undecided</option>
                        <option value="keep">Keep</option>
                        <option value="replace">Replace</option>
                      </select>
                    </label>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.muted}>
                Confirm an item from a photo proposal, or add one yourself.
              </p>
            )}
            <details className={styles.details}>
              <summary>Add a room item</summary>
              <SmallForm
                busy={busy}
                onSave={(form) =>
                  act({
                    operation: "add_item",
                    label: String(form.get("item")),
                  })
                }
              >
                <label htmlFor="item">Item name</label>
                <input
                  id="item"
                  name="item"
                  required
                  maxLength={120}
                  placeholder="e.g. Floor lamp"
                />
                <button>Add item</button>
              </SmallForm>
            </details>
          </section>
        </div>
        <div>
          <section className={styles.panel} aria-labelledby="knowledge-heading">
            <p className={styles.eyebrow}>What CONSIDER knows</p>
            <h2 id="knowledge-heading" tabIndex={-1}>
              Confirmed by you
            </h2>
            {confirmed.length ? (
              <ul className={styles.records}>
                {confirmed.map((fact) => (
                  <li key={fact.id}>
                    <div>
                      <strong>{fact.label}</strong>
                      <p>{fact.value}</p>
                      <small>
                        {fact.basis === "user_explicit"
                          ? "Entered by you"
                          : "Confirmed by you"}
                        {fact.sourceAssetIds.length > 0
                          ? " · Originally a photo proposal"
                          : ""}
                        {fact.origin === "fictional_fixture"
                          ? " · Fictional fixture origin"
                          : ""}
                      </small>
                    </div>
                    <details>
                      <summary>Correct</summary>
                      <SmallForm
                        busy={busy}
                        onSave={(form) =>
                          act({
                            operation: "correct_fact",
                            factId: fact.id,
                            value: String(form.get("value")),
                          })
                        }
                      >
                        <label htmlFor={`correct-${fact.id}`}>
                          Correct {fact.label}
                        </label>
                        <input
                          id={`correct-${fact.id}`}
                          name="value"
                          defaultValue={fact.value}
                          required
                          maxLength={600}
                        />
                        <button>Save correction</button>
                      </SmallForm>
                    </details>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.muted}>
                Nothing confirmed yet. Add a detail you know—no measurements
                required.
              </p>
            )}
            <details className={styles.details}>
              <summary>Add a room fact</summary>
              <SmallForm
                busy={busy}
                onSave={(form) =>
                  act({
                    operation: "add_fact",
                    kind: factKindSchema.parse(form.get("kind")),
                    label: String(form.get("label")),
                    value: String(form.get("value")),
                  })
                }
              >
                <label htmlFor="fact-kind">Kind of detail</label>
                <select id="fact-kind" name="kind">
                  {factKindSchema.options.map((kind) => (
                    <option key={kind} value={kind}>
                      {readable(kind)}
                    </option>
                  ))}
                </select>
                <label htmlFor="fact-label">Detail label</label>
                <input
                  id="fact-label"
                  name="label"
                  placeholder="e.g. Flooring"
                  required
                  maxLength={120}
                />
                <label htmlFor="fact-value">What you know</label>
                <input
                  id="fact-value"
                  name="value"
                  placeholder="e.g. Oak floorboards"
                  required
                  maxLength={600}
                />
                <button>Add fact</button>
              </SmallForm>
            </details>
          </section>
          <section className={styles.panel} aria-labelledby="proposals-heading">
            <h2 id="proposals-heading" tabIndex={-1}>
              From photos
            </h2>
            <p>Proposals are not confirmed room truth or measurements.</p>
            {proposed.length ? (
              <ul className={styles.records}>
                {proposed.map((fact) => (
                  <li key={fact.id} className={styles.proposal}>
                    <div>
                      <span className={styles.badge}>
                        Proposed · not confirmed
                      </span>
                      <h3>{fact.label}</h3>
                      <p>{fact.value}</p>
                      <small>
                        {fact.sourceAssetIds.length} source{" "}
                        {fact.sourceAssetIds.length === 1 ? "photo" : "photos"}
                        {fact.origin === "fictional_fixture"
                          ? " · Fictional fixture"
                          : ""}
                      </small>
                    </div>
                    <div className={styles.actions}>
                      <button
                        disabled={busy}
                        onClick={async () => {
                          if (
                            await act({
                              operation: "confirm_fact",
                              factId: fact.id,
                            })
                          )
                            document
                              .getElementById("proposals-heading")
                              ?.focus();
                        }}
                      >
                        Confirm {fact.label}
                      </button>
                      <button
                        disabled={busy}
                        onClick={async () => {
                          if (
                            await act({
                              operation: "reject_fact",
                              factId: fact.id,
                            })
                          )
                            document
                              .getElementById("proposals-heading")
                              ?.focus();
                        }}
                      >
                        Remove {fact.label}
                      </button>
                    </div>
                    <details>
                      <summary>Correct {fact.label}</summary>
                      <SmallForm
                        busy={busy}
                        focusAfterSave="proposals-heading"
                        onSave={async (form) => {
                          const saved = await act({
                            operation: "correct_fact",
                            factId: fact.id,
                            value: String(form.get("value")),
                          });
                          if (saved)
                            document
                              .getElementById("proposals-heading")
                              ?.focus();
                          return saved;
                        }}
                      >
                        <label htmlFor={`proposal-${fact.id}`}>
                          Correct value for {fact.label}
                        </label>
                        <input
                          id={`proposal-${fact.id}`}
                          name="value"
                          defaultValue={fact.value}
                          required
                          maxLength={600}
                        />
                        <button>Confirm correction</button>
                      </SmallForm>
                    </details>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.muted}>
                No photo proposals waiting for you.
              </p>
            )}
          </section>
          <section
            className={styles.panel}
            aria-labelledby="measurements-heading"
          >
            <h2 id="measurements-heading">
              Measurements <span className={styles.optional}>Optional</span>
            </h2>
            <p>
              Add a dimension when a decision needs it. Photos never supply
              measured dimensions.
            </p>
            <ul className={styles.records}>
              {room.state.measurements.map((m) => (
                <li key={m.id}>
                  <div>
                    <strong>{m.label}</strong>
                    <p>
                      {m.amount} {m.unit}
                    </p>
                    <small>Measured by you</small>
                  </div>
                  <button
                    disabled={busy}
                    aria-label={`Remove ${m.label}`}
                    onClick={() =>
                      void act({
                        operation: "remove_measurement",
                        measurementId: m.id,
                      })
                    }
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
            <details className={styles.details}>
              <summary>Add a measurement</summary>
              <SmallForm
                busy={busy}
                onSave={(form) =>
                  act({
                    operation: "add_measurement",
                    measurement: {
                      label: String(form.get("label")),
                      amount: Number(form.get("amount")),
                      unit: form.get("unit") as "mm" | "cm" | "m",
                    },
                  })
                }
              >
                <label htmlFor="measurement-label">Measurement label</label>
                <input
                  id="measurement-label"
                  name="label"
                  required
                  maxLength={120}
                  placeholder="e.g. Desk wall width"
                />
                <div className={styles.formRow}>
                  <div>
                    <label htmlFor="measurement-amount">Value</label>
                    <input
                      id="measurement-amount"
                      name="amount"
                      type="number"
                      min="0.001"
                      max="100000"
                      step="any"
                      required
                    />
                  </div>
                  <div>
                    <label htmlFor="measurement-unit">Unit</label>
                    <select id="measurement-unit" name="unit" defaultValue="cm">
                      <option>mm</option>
                      <option>cm</option>
                      <option>m</option>
                    </select>
                  </div>
                </div>
                <button>Save measurement</button>
              </SmallForm>
            </details>
          </section>
          <section className={styles.panel} aria-labelledby="unknown-heading">
            <h2 id="unknown-heading">Still unknown</h2>
            <p>
              Only gaps you or a room proposal have named. No questionnaire.
            </p>
            <ul className={styles.records}>
              {room.state.unknowns.map((u) => (
                <li key={u.id}>
                  <div>
                    <strong>{u.label}</strong>
                    <small>
                      {u.basis === "user_explicit"
                        ? "Noted by you"
                        : "Gap from photo proposal"}
                      {u.origin === "fictional_fixture"
                        ? " · Fictional fixture"
                        : ""}
                    </small>
                  </div>
                  <button
                    disabled={busy}
                    aria-label={`Remove unknown ${u.label}`}
                    onClick={() =>
                      void act({ operation: "remove_unknown", unknownId: u.id })
                    }
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
            <details className={styles.details}>
              <summary>Add a fit question</summary>
              <SmallForm
                busy={busy}
                onSave={(form) =>
                  act({
                    operation: "add_unknown",
                    label: String(form.get("gap")),
                  })
                }
              >
                <label htmlFor="gap">What do you still need to know?</label>
                <input
                  id="gap"
                  name="gap"
                  required
                  maxLength={120}
                  placeholder="e.g. Free bedside width"
                />
                <button>Save question</button>
              </SmallForm>
            </details>
          </section>
        </div>
      </div>
    </Shell>
  );
}
function SimpleList({ entries, empty }: { entries: string[]; empty: string }) {
  return entries.length ? (
    <ul>
      {entries.map((entry, index) => (
        <li key={`${entry}-${index}`}>{entry}</li>
      ))}
    </ul>
  ) : (
    <p className={styles.muted}>{empty}</p>
  );
}
function SmallForm({
  children,
  busy,
  onSave,
  focusAfterSave,
}: {
  children: ReactNode;
  busy: boolean;
  onSave: (form: FormData) => Promise<boolean>;
  focusAfterSave?: string;
}) {
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        const element = event.currentTarget;
        const details = element.closest("details");
        if (await onSave(new FormData(element))) {
          element.reset();
          if (details) {
            details.open = false;
          }
          if (focusAfterSave) document.getElementById(focusAfterSave)?.focus();
          else if (details?.isConnected)
            details.querySelector("summary")?.focus();
        }
      }}
    >
      <fieldset disabled={busy} aria-describedby="room-error">
        {children}
      </fieldset>
    </form>
  );
}
function DesignForm({
  room,
  busy,
  act,
}: {
  room: SpaceView;
  busy: boolean;
  act: Act;
}) {
  const design = room.state.design;
  const lines = (value: FormDataEntryValue | null) =>
    String(value || "")
      .split("\n")
      .map((x) => x.trim())
      .filter(Boolean);
  return (
    <SmallForm
      busy={busy}
      onSave={(form) =>
        act({
          operation: "set_design",
          design: {
            goal: String(form.get("goal")),
            add: lines(form.get("add")),
            palette: lines(form.get("palette")),
            styles: lines(form.get("styles")),
            notes: String(form.get("notes")),
            budget: form.get("budget")
              ? {
                  amountMinor: Math.round(Number(form.get("budget")) * 100),
                  currency: "GBP",
                }
              : null,
          },
        })
      }
    >
      <label htmlFor="design-goal">What would you like to change?</label>
      <textarea
        id="design-goal"
        name="goal"
        maxLength={1600}
        defaultValue={design.goal}
        rows={4}
        placeholder="Make the room warmer and more put together."
      />
      <label htmlFor="design-add">
        Things to add <span>(one per line)</span>
      </label>
      <textarea
        id="design-add"
        name="add"
        maxLength={2400}
        defaultValue={design.add.join("\n")}
        rows={3}
      />
      <label htmlFor="design-palette">
        Palette <span>(optional, one colour per line)</span>
      </label>
      <textarea
        id="design-palette"
        name="palette"
        maxLength={1440}
        defaultValue={design.palette.join("\n")}
        rows={2}
      />
      <label htmlFor="design-styles">
        Style direction <span>(optional, one per line)</span>
      </label>
      <textarea
        id="design-styles"
        name="styles"
        maxLength={1440}
        defaultValue={design.styles.join("\n")}
        rows={2}
      />
      <label htmlFor="design-notes">
        Notes <span>(optional)</span>
      </label>
      <textarea
        id="design-notes"
        name="notes"
        maxLength={1600}
        defaultValue={design.notes}
        rows={2}
      />
      <label htmlFor="design-budget">
        Room budget in £ <span>(optional)</span>
      </label>
      <input
        id="design-budget"
        name="budget"
        type="number"
        min="0"
        max="1000000"
        step="0.01"
        defaultValue={design.budget ? design.budget.amountMinor / 100 : ""}
      />
      <button className={styles.primary}>Save room design</button>
    </SmallForm>
  );
}
function PhotoSection({
  room,
  current,
  accept,
  onError,
}: {
  room: SpaceView;
  current: () => SpaceView;
  accept: (view: SpaceView) => void;
  onError: (error: unknown) => void;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const previews = useMemo(
    () => files.map((file) => URL.createObjectURL(file)),
    [files],
  );
  const [uploading, setUploading] = useState(false);
  const uploadingRef = useRef(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    return () => previews.forEach((url) => URL.revokeObjectURL(url));
  }, [previews]);
  function select(selected: File[]) {
    if (uploadingRef.current) return;
    if (selected.length + room.assets.length > 10) {
      setError("Choose up to 10 photos total for this room.");
      return;
    }
    if (
      selected.some(
        (f) =>
          !["image/jpeg", "image/png", "image/webp"].includes(f.type) ||
          f.size > 12 * 1024 * 1024,
      )
    ) {
      setError("Choose JPEG, PNG or WebP photos, no larger than 12 MB each.");
      return;
    }
    setError("");
    setFiles(selected);
  }
  async function upload() {
    if (uploadingRef.current || !files.length) return;
    uploadingRef.current = true;
    setUploading(true);
    setError("");
    let complete = 0;
    try {
      for (const file of files) {
        setProgress(`Saving photo ${complete + 1} of ${files.length}…`);
        const form = new FormData();
        form.append("photo", file);
        form.append("expectedRevision", String(current().currentRevision));
        accept(
          spaceViewSchema.parse(
            await responseJson(
              await fetch(`/api/spaces/${room.id}/assets`, {
                method: "POST",
                body: form,
              }),
            ),
          ),
        );
        complete++;
      }
      setProgress(
        `${complete} ${complete === 1 ? "photo saved" : "photos saved"}. Exact duplicates are kept only once.`,
      );
      setFiles([]);
      if (input.current) input.current.value = "";
    } catch (e) {
      setError(`${complete ? `${complete} saved. ` : ""}${message(e)}`);
      setFiles(files.slice(complete));
      setProgress("");
      onError(e);
    } finally {
      uploadingRef.current = false;
      setUploading(false);
    }
  }
  return (
    <section className={styles.photoSection} aria-labelledby="photos-heading">
      <div className={styles.sectionHeading}>
        <div>
          <p className={styles.eyebrow}>See the whole space</p>
          <h2 id="photos-heading">Your room, from a few angles</h2>
          <p>
            Add a few views so CONSIDER can understand the room. One is a useful
            start; three to eight gives more context.
          </p>
        </div>
        <span>{room.assets.length} / 10 photos</span>
      </div>
      {room.assets.length > 0 && (
        <div className={styles.gallery}>
          {room.assets.map((asset, index) => (
            <a
              href={asset.url}
              key={asset.id}
              target="_blank"
              rel="noreferrer"
              aria-label={`Open ${room.name} photo ${index + 1} in a new tab`}
            >
              <img
                src={asset.url}
                alt={`${room.name}, uploaded view ${index + 1}`}
                loading={index === 0 ? "eager" : "lazy"}
                decoding="async"
              />
              <span>View {String(index + 1).padStart(2, "0")}</span>
            </a>
          ))}
        </div>
      )}
      <div
        className={styles.dropzone}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          select(Array.from(e.dataTransfer.files));
        }}
      >
        <div>
          <strong>
            {room.assets.length
              ? "Add another angle"
              : "Start with a view of your room"}
          </strong>
          <p>
            Drop photos here, or choose files. JPEG, PNG or WebP · up to 12 MB
            each.
          </p>
        </div>
        <label className={styles.fileLabel}>
          Choose photos
          <input
            ref={input}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            disabled={uploading || room.assets.length >= 10}
            onChange={(e) => select(Array.from(e.target.files ?? []))}
            aria-describedby="photo-help photo-error"
          />
        </label>
      </div>
      <p id="photo-help" className={styles.muted}>
        Photos are stored locally for this founder preview. Location metadata is
        removed. These photos are not sent to an AI provider.
      </p>
      {previews.length > 0 && (
        <div className={styles.preview}>
          <p>{files.length} selected · not saved yet</p>
          <div>
            {previews.map((url, index) => (
              <img
                key={url}
                src={url}
                alt={`Selected photo ${index + 1} preview`}
              />
            ))}
          </div>
          <button
            className={styles.primary}
            disabled={uploading}
            onClick={() => void upload()}
          >
            {uploading ? "Saving photos…" : "Save selected photos"}
          </button>
          <button
            disabled={uploading}
            onClick={() => {
              setFiles([]);
              if (input.current) input.current.value = "";
            }}
          >
            Clear selection
          </button>
        </div>
      )}
      {error && (
        <p id="photo-error" className={styles.error} role="alert">
          {error}
        </p>
      )}
      <p className={styles.status} role="status" aria-live="polite">
        {progress}
      </p>
    </section>
  );
}
