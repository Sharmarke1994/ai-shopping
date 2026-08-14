export type FixtureViewKey =
  | "landing"
  | "cap-question"
  | "cap-results"
  | "shelving-results"
  | "headphones-results"
  | "headphones-refined"
  | "exact-results"
  | "degraded-results"
  | "no-matches";

export type FixtureBriefLine = Readonly<{
  id: string;
  text: string;
  tone: "positive" | "negative" | "neutral";
}>;

export type FixtureCandidateCard = Readonly<{
  id: string;
  name: string;
  maker: string;
  merchant: string;
  observedPrice: string;
  image: string | null;
  imageAlt: string;
  mayFit: string;
  worthKnowing: string;
}>;

type FixtureQuestionChoice = Readonly<{
  label: string;
  target: FixtureViewKey;
  appliedChange: string | null;
}>;

export type FixtureQuestion = Readonly<{
  eyebrow: string;
  title: string;
  detail: string;
  choices: readonly FixtureQuestionChoice[];
  skipTarget: FixtureViewKey;
}>;

type FixtureEmptyState = Readonly<{
  eyebrow: string;
  title: string;
  detail: string;
  conflict: string;
}>;

type FixtureRefinement = Readonly<{
  placeholder: string;
  helper: string;
  target: FixtureViewKey;
  appliedChange: string;
}>;

export type FixtureSnapshot = Readonly<{
  request: string;
  kicker: string;
  heading: string;
  intro: string;
  brief: readonly FixtureBriefLine[];
  candidates: readonly FixtureCandidateCard[];
  question: FixtureQuestion | null;
  notice: string | null;
  appliedChange: string | null;
  refinement: FixtureRefinement | null;
  emptyState: FixtureEmptyState | null;
}>;

const capCandidates = [
  {
    id: "cap-aer-veil",
    name: "Veil Run Cap",
    maker: "Aer Form",
    merchant: "Northline",
    observedPrice: "£34",
    image: "/fixtures/products/cap-forest.jpg",
    imageAlt: "Unstructured deep green running cap on a warm stone backdrop",
    mayFit:
      "The soft five-panel crown and thin fabric look closest to the barely-there feel you described.",
    worthKnowing:
      "The retailer calls it ultralight, but does not publish an exact weight.",
  },
  {
    id: "cap-fieldnote-airfold",
    name: "Airfold Five Panel",
    maker: "Fieldnote",
    merchant: "Pace Supply",
    observedPrice: "£29",
    image: "/fixtures/products/cap-sand.jpg",
    imageAlt: "Pale sand packable running cap on a warm stone backdrop",
    mayFit:
      "A collapsible crown and pliable brim suggest less bulk than a conventional structured cap.",
    worthKnowing:
      "Breathable side perforations are visible; sun-protection performance is not stated.",
  },
  {
    id: "cap-kestrel-mesh",
    name: "Kestrel Mesh Runner",
    maker: "Lowform",
    merchant: "Motion Goods",
    observedPrice: "£38",
    image: "/fixtures/products/cap-blue.jpg",
    imageAlt: "Muted blue mesh running cap on a warm stone backdrop",
    mayFit:
      "Large mesh panels make this the strongest ventilation option in the fixture shortlist.",
    worthKnowing:
      "The flatter brim may feel a little more substantial than your old race cap.",
  },
] as const satisfies readonly FixtureCandidateCard[];

const shelvingCandidates = [
  {
    id: "shelf-nookline",
    name: "Nookline Three Tier",
    maker: "Harth",
    merchant: "Harth & Home",
    observedPrice: "£34",
    image: "/fixtures/products/shelf-black.jpg",
    imageAlt: "Slim black metal three-tier shelving unit in a pale room",
    mayFit:
      "Listed at 58 × 29 cm, with an open frame that should keep the corner visually light.",
    worthKnowing:
      "It is £4 above your target, although still inside the flexible stretch you gave us.",
  },
  {
    id: "shelf-column-four",
    name: "Column Four",
    maker: "Fallow Living",
    merchant: "Fallow Living",
    observedPrice: "£39",
    image: "/fixtures/products/shelf-walnut.jpg",
    imageAlt: "Narrow dark walnut four-tier shelving unit in a pale room",
    mayFit:
      "The 54 × 28 cm footprint is safely inside both limits, and the dark walnut feels warmer than black steel.",
    worthKnowing:
      "The shelves are narrower than the other options, so usable storage is the trade-off.",
  },
  {
    id: "shelf-outline-step",
    name: "Outline Step Shelf",
    maker: "Mere Form",
    merchant: "Urban Form",
    observedPrice: "£31",
    image: "/fixtures/products/shelf-olive.jpg",
    imageAlt: "Open olive-black stepped shelving unit in a pale room",
    mayFit:
      "Its open perforated shelves make it the least visually bulky option, listed at 60 × 30 cm.",
    worthKnowing:
      "Those dimensions sit exactly on both limits; assembly tolerance is not documented.",
  },
] as const satisfies readonly FixtureCandidateCard[];

const headphoneCandidates = [
  {
    id: "headphones-hush-arc",
    name: "Hush Arc One",
    maker: "Common Audio",
    merchant: "Quiet Street",
    observedPrice: "£149",
    image: "/fixtures/products/headphones-graphite.jpg",
    imageAlt: "Graphite over-ear headphones on a warm stone backdrop",
    mayFit:
      "Deep oval cushions leave useful room around the temples, with strong stated noise cancellation.",
    worthKnowing:
      "Clamp comfort with glasses is not covered in the available retailer description.",
  },
  {
    id: "headphones-softline",
    name: "Softline Commute",
    maker: "Morrow Sound",
    merchant: "Common Room Audio",
    observedPrice: "£165",
    image: "/fixtures/products/headphones-moss.jpg",
    imageAlt: "Muted moss over-ear headphones on a warm stone backdrop",
    mayFit:
      "A broad textile headband and softer pads make this the most comfort-led option on paper.",
    worthKnowing:
      "It stretches the budget by £15, and the noise-cancellation claim comes from the maker.",
  },
  {
    id: "headphones-aven-form",
    name: "Aven Form 2",
    maker: "Aven",
    merchant: "Field Audio",
    observedPrice: "£139",
    image: "/fixtures/products/headphones-stone.jpg",
    imageAlt: "Pale stone over-ear headphones on a warm stone backdrop",
    mayFit:
      "Large fabric-lined earcups and a lighter listed weight make this a plausible all-day commuter.",
    worthKnowing:
      "There is no credible evidence yet about side pressure over longer journeys.",
  },
] as const satisfies readonly FixtureCandidateCard[];

const capBrief: readonly FixtureBriefLine[] = [
  { id: "cap-light", text: "Very lightweight and minimal", tone: "positive" },
  { id: "cap-breathable", text: "Breathable in hot weather", tone: "positive" },
  {
    id: "cap-structure",
    text: "Avoid a thick or structured crown",
    tone: "negative",
  },
  {
    id: "cap-brand",
    text: "Nike preferred, others welcome",
    tone: "neutral",
  },
];

const shelvingBrief: readonly FixtureBriefLine[] = [
  { id: "shelf-width", text: "No more than 60 cm wide", tone: "positive" },
  { id: "shelf-depth", text: "No more than 30 cm deep", tone: "positive" },
  {
    id: "shelf-budget",
    text: "Around £30, flexible for a better-looking option",
    tone: "neutral",
  },
  {
    id: "shelf-colour",
    text: "Avoid white; dark preferred",
    tone: "negative",
  },
  {
    id: "shelf-weight",
    text: "Open and visually light, not bulky",
    tone: "positive",
  },
];

const headphoneBrief: readonly FixtureBriefLine[] = [
  {
    id: "headphones-form",
    text: "Wireless, over-ear for commuting",
    tone: "positive",
  },
  {
    id: "headphones-budget",
    text: "Around £150, flexible",
    tone: "neutral",
  },
  {
    id: "headphones-comfort",
    text: "Comfortable with glasses; avoid strong clamp",
    tone: "positive",
  },
  {
    id: "headphones-anc",
    text: "Good noise cancellation matters",
    tone: "positive",
  },
  {
    id: "headphones-brand",
    text: "Open on brand",
    tone: "neutral",
  },
];

export const fixtureSnapshots: Readonly<
  Record<Exclude<FixtureViewKey, "landing">, FixtureSnapshot>
> = {
  "cap-question": {
    request: "I need a light breathable cap for running in this heat.",
    kicker: "One useful detail",
    heading: "Before we look, what does lightweight mean to you?",
    intro:
      "This answer could change both the shape of cap we look for and what we treat as a good result.",
    brief: capBrief.slice(0, 2),
    candidates: [],
    question: {
      eyebrow: "Worth asking",
      title: "What normally makes a running cap feel wrong?",
      detail: "Choose the closest answer—or skip and see options now.",
      choices: [
        {
          label: "They feel too thick and substantial",
          target: "cap-results",
          appliedChange: "Added: soft, minimal construction; no bulky crown.",
        },
        {
          label: "They trap too much heat",
          target: "cap-results",
          appliedChange: "Added: ventilation matters more than coverage.",
        },
      ],
      skipTarget: "cap-results",
    },
    notice: null,
    appliedChange: null,
    refinement: null,
    emptyState: null,
  },
  "cap-results": {
    request: "I need a light breathable cap for running in this heat.",
    kicker: "A considered shortlist",
    heading: "Three caps that look genuinely light—not just labelled that way",
    intro:
      "We favoured soft construction and visible ventilation. Exact fabric weight remains unknown where it is not published.",
    brief: capBrief,
    candidates: capCandidates,
    question: null,
    notice: null,
    appliedChange: null,
    refinement: null,
    emptyState: null,
  },
  "shelving-results": {
    request: "I need a slim open shelving unit for this corner, around £30.",
    kicker: "Options that fit the space",
    heading: "Slim shelving without the visual weight",
    intro:
      "These stay within your stated footprint. We kept slightly better-looking stretch options in view because your budget is flexible.",
    brief: shelvingBrief,
    candidates: shelvingCandidates,
    question: null,
    notice: null,
    appliedChange: null,
    refinement: null,
    emptyState: null,
  },
  "headphones-results": {
    request:
      "I need wireless over-ear headphones for commuting, around £150. I wear glasses and hate strong clamping.",
    kicker: "A useful distinction",
    heading: "Comfort-led options, with one priority still worth settling",
    intro:
      "The current shortlist stays visible while you decide whether comfort or maximum noise cancellation should lead.",
    brief: headphoneBrief,
    candidates: headphoneCandidates,
    question: {
      eyebrow: "Refine without starting over",
      title: "Which compromise would bother you more on a long commute?",
      detail:
        "We’ll use this to reorder the shortlist, not turn it into a must-have.",
      choices: [
        {
          label: "Pressure around my glasses",
          target: "headphones-refined",
          appliedChange:
            "Changed: comfort with glasses now leads noise cancellation.",
        },
        {
          label: "Hearing more of the train",
          target: "headphones-results",
          appliedChange:
            "Kept: stronger noise cancellation remains the lead preference.",
        },
      ],
      skipTarget: "headphones-results",
    },
    notice: null,
    appliedChange: null,
    refinement: {
      placeholder: "Try: comfort with glasses matters most",
      helper: "Say what changed. We’ll update the order without starting over.",
      target: "headphones-refined",
      appliedChange:
        "Changed: comfort with glasses now matters more than maximum noise cancellation.",
    },
    emptyState: null,
  },
  "headphones-refined": {
    request:
      "I need wireless over-ear headphones for commuting, around £150. I wear glasses and hate strong clamping.",
    kicker: "Shortlist updated",
    heading: "Comfort now leads; maximum noise cancellation comes second",
    intro:
      "Saved products stay put. The order changed because your stated priority changed—not because new evidence appeared.",
    brief: [
      ...headphoneBrief.filter((line) => line.id !== "headphones-comfort"),
      {
        id: "headphones-comfort-refined",
        text: "Comfort with glasses matters most",
        tone: "positive",
      },
    ],
    candidates: [
      headphoneCandidates[1],
      headphoneCandidates[2],
      headphoneCandidates[0],
    ],
    question: null,
    notice: null,
    appliedChange:
      "Comfort with glasses moved ahead of having the strongest noise cancellation.",
    refinement: null,
    emptyState: null,
  },
  "exact-results": {
    request: "Show me the Alder Quiet One headphones in graphite.",
    kicker: "Straight to the item",
    heading: "The exact model you asked for",
    intro:
      "This prepared lookup needs no clarification. The shell can move directly to a factual result when the request is already specific.",
    brief: [
      {
        id: "exact-model",
        text: "Alder Quiet One, graphite",
        tone: "positive",
      },
      {
        id: "exact-open",
        text: "No other preferences added",
        tone: "neutral",
      },
    ],
    candidates: [
      {
        ...headphoneCandidates[0],
        id: "exact-alder-quiet-one",
        name: "Quiet One",
        maker: "Alder",
        merchant: "Alder UK",
        observedPrice: "£159",
        mayFit: "This is the exact model and colour named in your request.",
        worthKnowing:
          "Availability and the observed price would need fresh retailer evidence in the live product.",
      },
    ],
    question: null,
    notice: null,
    appliedChange: null,
    refinement: null,
    emptyState: null,
  },
  "degraded-results": {
    request: "I need wireless over-ear headphones for commuting, around £150.",
    kicker: "Partial results",
    heading: "Useful options, with some evidence still unavailable",
    intro:
      "Two sources loaded cleanly. One image and several comfort details did not, so the cards stay factual instead of filling the gaps.",
    brief: headphoneBrief.slice(0, 4),
    candidates: [
      headphoneCandidates[0],
      headphoneCandidates[2],
      {
        id: "headphones-transit-fold",
        name: "Transit Fold",
        maker: "North Audio",
        merchant: "Sound Room",
        observedPrice: "£145",
        image: null,
        imageAlt: "Product image unavailable",
        mayFit:
          "The retailer lists wireless over-ear fit and active noise cancellation.",
        worthKnowing:
          "The image and comfort specification did not load; clamp pressure remains unknown.",
      },
    ],
    question: null,
    notice:
      "Some sources could not be reached. Showing the useful evidence that did arrive.",
    appliedChange: null,
    refinement: null,
    emptyState: null,
  },
  "no-matches": {
    request:
      "I need dark open shelving under £25, no wider than 42 cm or deeper than 20 cm, with no wall fixing.",
    kicker: "No credible matches",
    heading: "Nothing we'd confidently put in front of you yet",
    intro:
      "The search completed successfully. The honest result is that the available candidates miss at least one requirement.",
    brief: [
      {
        id: "no-match-budget",
        text: "Maximum £25",
        tone: "positive",
      },
      {
        id: "no-match-size",
        text: "Maximum 42 × 20 cm footprint",
        tone: "positive",
      },
      {
        id: "no-match-colour",
        text: "Avoid white; dark and open",
        tone: "negative",
      },
      {
        id: "no-match-fixing",
        text: "Freestanding; avoid wall fixing",
        tone: "negative",
      },
    ],
    candidates: [],
    question: null,
    notice: null,
    appliedChange: null,
    refinement: null,
    emptyState: {
      eyebrow: "The main conflict",
      title:
        "The size and fixing limits remove every credible option under £25.",
      detail:
        "We found narrow units and freestanding units, but none that satisfy the full combination closely enough to recommend.",
      conflict: "£25 ceiling  ·  42 × 20 cm  ·  freestanding  ·  dark and open",
    },
  },
};

export const landingExamples = [
  {
    id: "cap",
    label: "Running, without the bulk",
    prompt: "I need a light breathable cap for running in this heat.",
    target: "cap-question" as const,
  },
  {
    id: "shelving",
    label: "Make a small corner work",
    prompt: "I need a slim open shelving unit for this corner, around £30.",
    target: "shelving-results" as const,
  },
  {
    id: "headphones",
    label: "Commute in comfort",
    prompt:
      "I need wireless over-ear headphones for commuting, around £150. I wear glasses and hate strong clamping.",
    target: "headphones-results" as const,
  },
] as const;

export const exactLookupPrompt =
  "Show me the Alder Quiet One headphones in graphite.";

export function isFixtureViewKey(value: string): value is FixtureViewKey {
  return value === "landing" || Object.hasOwn(fixtureSnapshots, value);
}
