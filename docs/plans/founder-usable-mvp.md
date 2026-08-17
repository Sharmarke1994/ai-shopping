MASTER EXECUTION BRIEF
AI SHOPPING - FOUNDER-USABLE MVP

You are taking over sustained execution of the AI Shopping project.

Repository:
Sharmarke1994/ai-shopping

Authoritative merged baseline before current planning work:
main @ cbb3314a4dcb04ef6ff8b351fa7823ffdc0bf753

Current planning checkpoint:
PR #8 - V0-05: plan AI interpretation and context acquisition
Reviewed head:
23178f3c5b9f9d0baa4d9f028b4ab90464a09abd

The user has deliberately built the lower-level state architecture carefully.

Do not throw that architecture away.

However, the development objective is now changing.

The objective is NOT:

"complete as many backlog items as possible"

and it is NOT:

"finish every architecture document"

and it is NOT:

"build a technically impressive AI demo."

THE OBJECTIVE IS:

Deliver a founder-usable, visually polished AI shopping MVP that the user can genuinely use for real shopping tasks and evaluate against their normal behaviour of using Google, Google Shopping, retailer sites, ChatGPT, tabs, reviews and manual comparison.

The product must create obvious value in the FIRST REAL SHOPPING SESSION.

The MVP is not finished until the founder can naturally describe something they genuinely want to buy, let the system understand and refine the request, search the live market, inspect real candidates, understand why those products do or do not fit their particular needs, refine the request, save candidates, compare them, and make progress toward a purchase.

This is not permission to rush.

It is permission to stop optimizing architecture for its own sake and progressively expose the architecture to real product use.

==================================================
1. PRODUCT THESIS
==================================================

The product mission remains:

Make AI the most effective way to discover, understand, evaluate, refine and choose what to buy.

The product is NOT fundamentally:

- a chatbot;
- a prettier Google search box;
- a Google Shopping clone;
- an affiliate carousel;
- a product recommendation generator;
- a fixed shopping questionnaire;
- a filter builder;
- a room planner;
- a universal product ontology;
- an "AI answers then gives 5 links" experience.

The core loop is:

UNDERSTAND
-> CLARIFY WHEN WORTHWHILE
-> SEARCH
-> LEARN FROM THE MARKET
-> SHOW
-> REACT
-> REFINE
-> SEARCH AGAIN
-> COMPARE
-> DECIDE

The system should allow a shopper to speak naturally without already knowing:

- the right shopping vocabulary;
- the right filters;
- the relevant brands;
- which specifications matter;
- which search query will expose the right market;
- which differences between products actually matter to them.

The product should accumulate a HIGH-FIDELITY MUTABLE SHOPPING CONTEXT.

Application state owns that context.

The LLM does not become the database.

==================================================
2. THE QUESTION THE MVP MUST ANSWER
==================================================

At founder acceptance, we must be able to answer:

"Why would I use this instead of Google?"

A satisfactory answer must be visible in the behaviour of the product, not merely described in landing-page copy.

The MVP should demonstrate at least these advantages.

A. NATURAL INTENT

Google requires the shopper to translate their need into search language.

This product should let the shopper say:

"I need a light breathable cap for running in this heat."

or:

"I need a slim shelving unit for this corner around £30, no more than 60 cm wide."

or:

"I need wireless over-ear headphones for commuting. I wear glasses and hate strong clamping."

The system should convert that into durable, inspectable shopping context without inventing missing preferences.

B. MEMORY OF WHAT ACTUALLY MATTERS

The system must remember:

- explicit constraints;
- flexible targets;
- strong preferences;
- ordinary preferences;
- explicit indifference;
- changes of mind.

It must distinguish:

- unknown;
- indifferent;
- preferred;
- required;
- flexible budget;
- ceiling;
- conditional stretch.

A shopper should not have to reconstruct filters and context on every search.

C. BETTER SEARCH STRATEGY

The system should not merely run the user's literal sentence as one query.

It should use the authoritative intent to create multiple sensible retrieval directions while keeping search hypotheses separate from user truth.

For example:

"light breathable cap"

may justify exploring market terminology such as:

- lightweight running cap;
- race cap;
- ultralight cap;
- soft running cap;

without converting "race cap" into a user criterion.

D. REQUEST-SPECIFIC PRODUCT UNDERSTANDING

Do not merely show product titles.

For each useful candidate, help answer:

- Why might this suit THIS shopper?
- Which explicit criteria does available evidence support?
- What appears to conflict?
- What is genuinely unknown?
- What trade-off would the shopper be making?

E. HONEST UNCERTAINTY

Do not manufacture confidence.

If evidence does not establish:

- clamp comfort;
- exact dimensions;
- material thickness;
- fit;
- weight;
- availability;
- some other important criterion;

say that it is unknown.

Missing evidence is not positive evidence.

F. REFINEMENT

The shopper should be able to say:

"These are still too bulky."

"Number three is closest but I want something thinner."

"I don't care about brand anymore."

"Actually £40 is okay if it's much nicer."

and observe a meaningful change in:

- the authoritative brief;
- search strategy;
- candidates;
- comparison;
- judgement.

G. COMPARISON AGAINST MY NEEDS

Google gives generic specifications.

This system should compare shortlisted products against the SHOPPER'S CURRENT CRITERIA.

The comparison should expose:

- strengths;
- conflicts;
- trade-offs;
- evidence gaps;
- price;
- merchant/listing context.

No fake percentage score.

==================================================
3. FOUNDER-USABLE MVP DEFINITION
==================================================

The target vertical slice is:

NATURAL REQUEST
-> AUTHORITATIVE BRIEF
-> AT MOST ONE USEFUL QUESTION
-> LIVE SEARCH
-> REAL CANDIDATE LISTINGS
-> EVIDENCE-AWARE PRODUCT ASSESSMENT
-> PRODUCT-FIRST RESULT EXPERIENCE
-> SAVE / NOT FOR ME
-> NATURAL-LANGUAGE REFINEMENT
-> RE-SEARCH
-> SHORTLIST
-> COMPARE
-> DECISION SUPPORT

The founder should be able to start a brand-new shopping task without editing fixtures or database rows.

Refresh/restart should preserve the task.

The product should support multiple tasks in persistence even if the first consumer UX foregrounds one task at a time.

The MVP may remain local/private initially.

Do not expose a paid unauthenticated public endpoint simply to say it is deployed.

==================================================
4. CURRENT ARCHITECTURE THAT REMAINS FROZEN
==================================================

V0-03 and V0-04 are accepted foundations.

Preserve:

- ShoppingTask identity and revision;
- TaskInput provenance/idempotency;
- UserMessage linkage;
- task-local ConceptDefinition;
- typed DecisionCriterion history;
- CriterionSource provenance;
- explicit vs confirmed authority;
- strength;
- target semantics;
- lifecycle;
- unknown vs indifference;
- typed semantic values;
- current/historical state loading;
- deterministic brief projection;
- V0-04 patch grammar;
- transactionality;
- CAS;
- application receipts;
- revision-aware historical receipt validation;
- latest meaningful forward undo;
- forward-only restored criterion history.

Do not rebuild these concepts.

Do not introduce another generic state engine.

Do not event-source current truth.

Do not use model conversation history as authoritative shopping state.

Do not weaken V0-04 because a model produces inconvenient output.

==================================================
5. DEVELOPMENT PHILOSOPHY FROM HERE
==================================================

Architect for validated learning, not completeness.

For each layer:

reasonable hypothesis
-> smallest credible implementation
-> run it
-> inspect failures
-> improve
-> continue.

The lower-level state engine justified deep architecture review.

Above that layer, many decisions are cheaper to reverse.

Do not spend days theoretically optimizing:

- prompt wording;
- search queries;
- result-card layout;
- ranking prompts;
- loading copy;
- question copy.

Build credible versions, evaluate them, and iterate.

BUT:

Do not use "MVP" as permission for low-quality UI, fake behaviour, hardcoded demo output, unsafe state shortcuts, or obviously temporary product architecture.

The previous student-level MVP approach is explicitly rejected.

==================================================
6. AUTONOMY
==================================================

You are expected to make normal engineering decisions yourself.

Do NOT repeatedly ask the user about:

- function names;
- small schema implementation details;
- folder structures;
- component extraction;
- ordinary TypeScript choices;
- test helper design;
- CSS minutiae;
- routine refactors;
- prompt wording experiments.

Pause for the user only when genuinely necessary for:

- a paid vendor commitment;
- a missing secret/API credential;
- a material scope change;
- security/privacy implications;
- destructive migration;
- public deployment with cost/exposure implications;
- a fundamental contradiction with accepted architecture;
- a consequential product decision where two options represent meaningfully different products.

If a credential is missing:

1. continue all work that does not require the credential;
2. prepare the integration;
3. provide the exact environment variable/credential needed;
4. pause only when live execution is genuinely blocked.

==================================================
7. QUALITY CHECKPOINT PROCESS
==================================================

Do not create one enormous unreviewable implementation.

Work through bounded vertical checkpoints.

At each meaningful checkpoint:

1. inspect existing docs/code;
2. write or update the smallest durable plan needed;
3. implement;
4. test;
5. run it;
6. inspect behaviour;
7. self-review;
8. fix material findings;
9. commit;
10. keep the tree clean.

Use separate PRs/commits for meaningful gates where practical.

If the environment supports a genuinely separate review pass or review agent, use a read-only independent review at consequential checkpoints.

Otherwise conduct a deliberate second review pass after implementation rather than trusting the coding pass.

Do not endlessly reopen accepted decisions after evidence is clean.

==================================================
8. FIRST TASK - FINISH V0-05 PLAN
==================================================

PR #8 currently requires the following independent-review corrections.

Apply them before implementation.

A. STRUCTURED OUTPUT PROVIDER BOUNDARY

The OpenAI provider representation must be compatible with strict Structured Outputs.

Do not directly expose an incompatible Zod/domain union as the provider schema.

Use:

PROVIDER WIRE OBJECT
-> strict provider validation
-> deterministic lowering
-> existing V0-04 patch contract
-> V0-04 validation/application.

Provider-specific nullability/wrappers are transport only.

They may not:

- invent defaults;
- repair semantics;
- alter strength;
- alter target semantics;
- alter operator;
- alter value;
- introduce IDs.

Context-action provider output must also use a provider-compatible root object.

Responses parsing must locate exactly one relevant completed message payload/refusal path rather than assuming the whole `output` array contains exactly one element.

B. MAKE ACTION SELECTION INDEPENDENT

Do not make stage-two context-action selection depend on stage-one ephemeral ambiguity output.

Interpretation ambiguities remain diagnostic/eval information.

Context-action selection consumes:

- original resolved source;
- freshly authoritative concepts;
- active criteria;
- brief;
- current revision;
- capabilities.

This allows recovery after:

patch committed
-> process crash
-> retry action stage

without reinterpreting or trusting diagnostic trace state.

C. QUESTION ANSWER V2

Current TaskInput V1 question answers require an option ID.

V0-05 needs both:

- open text;
- single select.

Create a versioned backward-compatible contract rather than using a fake option ID.

Single-select semantics are resolved from the server-stored question option.

Client text cannot redefine the option's meaning.

ASK artifacts are:

- same-task;
- snapshot-bound;
- response-mode validated;
- single-use except idempotent duplicate retry.

A question selected at revision R must not later be answered after the task materially advances beyond R.

Such an answer should fail with typed stale-question behaviour before the model call.

Natural user messages retain the normal bounded stale reinterpretation behaviour.

D. STRENGTH LABELS

Freeze conservative natural-language mapping into:

- preference;
- strong_preference;
- hard.

Hard only where the shopper clearly expresses eligibility, exclusion or required-bound meaning.

Strong preference requires meaningful emphasis/priority.

An ordinary explicitly desired property uses ordinary preference unless stronger meaning is genuinely expressed.

Do not silently strengthen ambiguous wording.

Add exact labelled strengths to V0-05 golden fixtures.

E. TRACE WORDING

Diagnostic proposals may naturally contain structured user-derived semantic text.

Do not incorrectly claim trace data can never repeat any shopper-derived content.

Still prohibit:

- chain-of-thought;
- full raw prompt transcripts;
- full provider envelopes;
- secrets;
- raw stack dumps.

After correcting the V0-05 plan:

- run checks;
- self-review;
- update PR #8;
- if clean and consistent, complete the planning checkpoint and move into implementation.

Do not spend another broad architecture cycle on V0-05 unless implementation evidence reveals a real contradiction.

==================================================
9. V0-05 IMPLEMENTATION TARGET
==================================================

V0-05 must produce the first LIVE intelligence loop.

Implement:

- interpretation contract;
- provider-wire schema;
- deterministic lowering;
- OpenAI Responses adapter;
- strict output handling;
- exact source/state context building;
- patch application through V0-04;
- one bounded stale reinterpretation;
- independent context-action selector;
- ASK/SEARCH decision;
- persistent question/action artifact;
- question answer V2;
- narrow diagnostic attempts;
- fake-provider deterministic tests;
- real PostgreSQL coordination tests;
- credential-gated live evals;
- local conversational harness.

Important:

SEARCH at this stage is only a policy result.

Do not pretend retrieval exists.

V0-05 acceptance must include live interaction with the real model.

Run the golden cases.

Measure:

- invented criteria;
- missing explicit criteria;
- wrong strength;
- wrong money semantics;
- duplicate concept creation;
- change-of-mind behaviour;
- indifference handling;
- exact lookup ASK vs SEARCH;
- question usefulness;
- latency;
- tokens.

Do not keep tuning forever.

Protected semantic violations are blockers.

Minor wording differences are not.

At the end of V0-05 the founder should be able to type a message into the local harness and see:

- what was understood;
- authoritative brief;
- ASK or SEARCH;
- applied delta;
- failure state if applicable.

That is the first product-intelligence checkpoint.

==================================================
10. THEN BUILD LIVE RETRIEVAL
==================================================

After V0-05 is stable, immediately move toward live product use.

The retrieval target is UK-first:

- GB;
- GBP;
- en-GB;
- UK-relevant retailers and availability.

Do not implement a broad crawler.

Do not make provider-specific data leak throughout domain logic.

Do a SHORT, practical provider spike for live Google/Google Shopping data.

Requirements:

- Google Search / Google Shopping quality is preferred because the product thesis currently assumes Google-market discovery;
- current availability;
- UK coverage;
- structured title/link/merchant/price/image where possible;
- low-friction development setup;
- reasonable cost for founder testing;
- clear terms;
- sufficient reliability.

Do not conduct an enormous vendor study.

If one provider clearly satisfies the founder-testing requirement with a free/cheap trial, implement it behind one narrow retrieval adapter.

If a non-trivial paid commitment is required, pause for user approval at that point while continuing provider-independent work.

==================================================
11. RETRIEVAL DOMAIN BOUNDARY
==================================================

Introduce only what the live shopping loop needs.

Likely concepts include:

SearchRun

Represents one retrieval execution tied to:
- task;
- current task revision;
- market;
- timestamps;
- query strategy version.

SearchQuery

Represents a retrieval query/hypothesis.

It is NOT a DecisionCriterion.

CandidateListing

Represents one merchant offer/result URL within the task/run context.

Do not prematurely force multiple listings into a ProductIdentity unless reliable identifiers justify it.

Listing-level fields may include:

- title;
- URL;
- merchant;
- price;
- currency;
- image;
- availability when supported;
- shipping/delivery when supported;
- provider identifiers;
- query provenance.

Keep provider raw payloads bounded/diagnostic rather than domain truth.

==================================================
12. QUERY STRATEGY
==================================================

This is one of the major potential advantages over Google.

The system should take:

- current authoritative state;
- market;
- current source/refinement;
- search history where directly useful;

and produce a SMALL query portfolio.

Do not run twenty near-identical searches.

A first useful strategy might have:

1. literal/high precision query;
2. expanded commercial terminology query;
3. one alternative direction when the user's meaning suggests useful market terminology.

Search hypotheses remain hypotheses.

Example:

User:
"I need a light breathable cap for running in this heat."

Authoritative truth:
- lightweight preferred;
- breathable preferred.

Possible retrieval hypotheses:
- lightweight running cap;
- ultralight running cap;
- race cap.

Only the first two user concepts are truth.

"race cap" remains retrieval theory unless explicitly adopted by the shopper.

Store query lineage so later failures can be assigned to query strategy rather than silently changing criteria.

==================================================
13. NORMALISATION AND CANDIDATES
==================================================

Convert provider results into task/run-scoped CandidateListing records.

Be conservative about deduplication.

Do not collapse:

- different retailer offers;
- variants;
- materially different models;

just because titles look similar.

A rough imperfect candidate pool is preferable to destructive false deduplication.

At this stage:

- real image;
- title;
- price;
- merchant;
- live URL;

must be sufficient to render a real product card.

Broken/missing images need a deliberate fallback.

==================================================
14. PRODUCT EVIDENCE
==================================================

The product must not become:

"LLM reads a title and confidently tells you it is perfect."

Create an evidence layer.

Evidence can include available structured search/listing fields and bounded source text supplied by the retrieval layer.

Observation is separate from evidence.

Examples:

Evidence:
"Weight: 48 g"

Observation:
candidate weight appears to be 48 g.

Evidence:
merchant title contains "ultralight running cap"

Observation:
merchant describes it as ultralight.

Do not transform marketing adjectives into objective fact.

When only weak evidence exists, preserve the source nature.

Missing information remains unknown.

Do not hard-exclude based on:
- snippets;
- visual inference;
- absence of evidence;
- generic LLM knowledge.

==================================================
15. CRITERION ASSESSMENT
==================================================

For each promising candidate and current criterion, produce a request-specific assessment.

Use the existing conceptual model:

- Meets
- Conflicts
- Uncertain
- Not applicable

and retain a qualitative relation/explanation.

Examples:

"Within your preferred £30 target."

"£36 is above your target but below your conditional £40 stretch."

"Width is 58 cm, which is inside your 60 cm hard maximum."

"Listing does not provide enough evidence to judge clamp comfort."

"Merchant calls this lightweight, but exact physical bulk is unclear."

No fake numeric match percentage.

Do not turn every unknown into negative rank.

Hard exclusion requires a genuinely hard active criterion plus admissible direct contradiction.

==================================================
16. JUDGEMENT AND ORDERING
==================================================

The shopper needs a useful result order.

Do not create an arbitrary weighted score.

Use a bounded judgement stage that receives:

- current authoritative criteria;
- evidence-backed candidate assessments;
- price/listing context.

It should produce a qualitative ordered candidate set with explicit trade-offs.

Important:

- hard contradictions may eliminate when evidence qualifies;
- strong preferences influence judgement more than ordinary preferences;
- flexible target vs stretch remains visible;
- unknown important evidence remains visible;
- ties are permitted;
- retailer popularity and review counts do not automatically dominate;
- affiliate economics never influence judgement.

Persist enough judgement provenance to know which:
- task revision;
- search run;
- candidate assessments;

the result came from.

A state change makes old judgement stale.

==================================================
17. RESULTS QUALITY
==================================================

Do not overwhelm the user with 50 generic cards.

Aim initially for roughly:

8-12 useful candidate listings

after retrieval/normalisation/judgement.

If evidence quality means only 5 are genuinely useful, show 5.

The UI should make it obvious WHY the products were surfaced.

Each result card should contain:

- product image;
- title;
- merchant;
- current price when known;
- link;
- concise "Why it fits";
- concise "Watch-outs / unknowns";
- Save;
- Not for me.

Do not dump every criterion onto every card.

Prioritize the most decision-relevant 2-4 facts.

Allow detail expansion for full evidence/criterion view.

==================================================
18. REACTIONS
==================================================

Implement founder-useful reactions after real results exist.

SAVE

Adds listing to task shortlist.

Does not change criteria.

NOT FOR ME

Bare rejection suppresses that exact CandidateListing in this task.

It does NOT automatically infer:
- colour dislike;
- brand dislike;
- price sensitivity;
- style preference.

UNDO must work.

EXPLAINED REJECTION / NATURAL REFINEMENT

If user says:

"Not this one, it looks too bulky"

or:

"These are all too expensive"

that text enters through the normal user-input/interpreter path.

Only explicit meaning may update authoritative criteria.

Then:

- state changes;
- previous judgement becomes stale;
- search strategy may change;
- search reruns.

==================================================
19. REFINEMENT EXPERIENCE
==================================================

Refinement is a core MVP feature.

There should be a persistent, easy-to-find natural-language composer after results exist.

Examples:

"Show me thinner ones."

"Actually no white."

"I could stretch to £50."

"I don't care about Nike anymore."

"More like the second one."

Candidate-relative requests remain impossible until real CandidateListing identity exists.

Once CandidateListing exists, implement task-scoped candidate references properly rather than textual fake IDs.

This is the point where V0-03's deferred comparison semantic can finally be made real.

Do not weaken candidate task scoping.

==================================================
20. SHORTLIST AND COMPARISON
==================================================

A founder-usable shopping product should not stop at result discovery.

Allow saving candidates.

When at least two candidates are saved, offer Compare.

Initial comparison should support roughly 2-4 products.

Comparison should be built around CURRENT SHOPPER CRITERIA, not a generic technical spec sheet.

Desktop comparison can use a matrix.

Rows:
- important current criteria;
- price;
- key unknowns/trade-offs.

Columns:
- saved candidates.

For each cell:
- supported fit/conflict;
- qualitative relation;
- unknown;
- evidence affordance where useful.

Also provide a short plain-language comparison summary such as:

"Option A is the safest fit for your hard dimensions.
Option B costs more but better matches your visual preference.
Option C is cheapest, but depth is unverified."

Do not fabricate a single winner when evidence is genuinely mixed.

==================================================
21. MVP UI
==================================================

The interface is part of the product, not decoration applied at the end.

It must feel:

- modern;
- premium;
- calm;
- visual;
- consumer-first;
- trustworthy;
- intentional.

Avoid:

- B2B dashboard aesthetics;
- giant admin sidebars;
- dense forms;
- Bootstrap-looking cards;
- excessive border boxes;
- dozens of pills;
- fake metrics;
- analytics-dashboard layouts;
- huge dominant chatbot panel;
- gratuitous AI gradients;
- neon "AI" styling;
- developer terminology;
- semantic-model terminology.

The shopper should never see terms such as:
- DecisionCriterion;
- ConceptDefinition;
- StatePatch;
- SearchHypothesis;
- CriterionAssessment.

==================================================
22. EMPTY / START STATE
==================================================

The initial experience should be extremely simple.

A high-quality centered shopping entry point.

Suggested conceptual hierarchy:

small brand/header

"What are you looking for?"

large natural-language input

supporting copy along the lines of:

"Describe what you need naturally. We'll work out what matters, search the market and help you compare."

A few understated example prompts may exist.

Do not force category selection before the shopper speaks.

Do not begin with twenty filters.

Do not require creating a workspace.

==================================================
23. ACTIVE SHOPPING TASK UI
==================================================

Once a task starts, move into a product-first shopping workspace.

Suggested hierarchy:

TOP

- compact product/task title;
- New search/task;
- optional task switcher;
- current brief affordance.

UNDERSTANDING / BRIEF

Show a compact "What I'm looking for" section.

It should make the system's understanding inspectable.

Examples:

Lightweight
Breathable
Nike preferred
Around £30
Max width 60 cm

Do not show explicit indifference in the normal brief.

Eventually support straightforward editing/removal through trusted brief actions.

Do not turn this into a giant form.

QUESTION

If one high-value question is worthwhile, show it clearly.

If the system can responsibly search without the answer, consider making the question non-blocking.

Never produce a survey.

RESULTS

Products dominate the page.

REFINEMENT

Keep a natural-language refinement composer easily available.

SHORTLIST

Saved items should remain visible/recoverable.

COMPARE

Comparison becomes accessible once useful.

==================================================
24. PRODUCT CARD DESIGN
==================================================

Cards should be highly visual.

Use a restrained hierarchy:

IMAGE

PRODUCT NAME

PRICE + RETAILER

2-4 useful assessment points

Example:

Why it fits
• 56 cm wide - inside your 60 cm limit
• Open-frame design matches your preference

Watch-out
• £36 - above your £30 target but inside your £40 stretch

or:

Unknown
• Exact depth not provided by current evidence

A card must not falsely imply that AI "knows" a subjective product property merely because a title contains marketing language.

Actions:

Save
Not for me
View product

Potentially:
Why this?

Do not clutter every card with a dozen buttons.

==================================================
25. EVIDENCE UX
==================================================

Trust is part of differentiation.

Users should be able to understand where important claims came from without every screen becoming a citation document.

Use layered disclosure.

Card:
concise statement

Expansion/details:
source / evidence context

External product:
real retailer/source link

Clearly distinguish:

- supported fact;
- source claim;
- inference;
- unknown.

Do not expose chain-of-thought.

==================================================
26. LOADING EXPERIENCE
==================================================

Live shopping has latency.

Do not show a blank spinner for 20 seconds.

Use staged, truthful progress such as:

Understanding what matters
Searching the market
Checking the most promising options
Comparing against your brief

Only display stages that actually correspond to work.

Use skeleton cards once retrieval begins.

Do not fake progress percentages.

==================================================
27. ERROR EXPERIENCE
==================================================

Failures must preserve the task.

Examples:

Interpretation failure:
"Couldn't safely understand that change. Your previous brief is unchanged."

Search provider failure:
"Search failed. Your shopping brief is safe. Try again."

Partial query failure:
render good candidates from successful queries.

Product assessment failure:
show factual product card with "Fit analysis unavailable" rather than hiding the product or inventing judgement.

==================================================
28. RESPONSIVE QUALITY
==================================================

Desktop is the primary founder-working environment, but mobile cannot be broken.

Desktop:
roughly 3-column result grid where dimensions allow.

Tablet:
2 columns.

Mobile:
1 strong card column.

Do not use fixed desktop widths.

Comparison should have an intentional mobile fallback rather than an unusable giant table.

==================================================
29. VISUAL ITERATION PROCESS
==================================================

Do not consider UI complete because JSX exists.

For every significant visual checkpoint:

1. run the app;
2. populate real or deterministic representative data;
3. inspect desktop;
4. inspect mobile;
5. capture screenshots;
6. critique hierarchy, whitespace, density, prominence and polish;
7. fix;
8. repeat.

Use browser/computer-use tooling when available.

Verify:

- initial empty state;
- ASK state;
- loading state;
- result state;
- sparse evidence;
- long title;
- missing image;
- save;
- rejection;
- refinement;
- shortlist;
- comparison;
- error.

The user's quality bar is substantially higher than a normal engineering MVP.

==================================================
30. DO NOT MAKE UI FIXTURE-DRIVEN AFTER LIVE LOOP EXISTS
==================================================

The current V0-02 fixture UI was valuable for direction.

Once the real loop exists, wire the polished interface to real task/application/retrieval state.

Do not retain a situation where:

- the brief is live;
- product cards are fake;

or:

- product cards are live;
- reactions are fake.

A founder acceptance session must use real end-to-end state.

==================================================
31. IMAGE / FILE INPUT
==================================================

Do not block the first live vertical loop on multimodal input.

After the text shopping loop is founder-usable, image input may be valuable for cases such as:

- room/corner photo;
- existing product photo;
- screenshot.

Only add it when the core loop is already functioning and when it can be integrated without weakening state/evidence boundaries.

Do not add image upload merely because the model supports images.

==================================================
32. LIVE MVP ACCEPTANCE JOURNEYS
==================================================

The MVP must successfully support these founder journeys.

JOURNEY A - RUNNING CAP

Start from zero:

"I need a light breathable cap for running in this heat."

Expected:
- only explicit truth;
- no invented budget/colour/brand;
- useful question only if justified;
- real UK products;
- product evidence;
- useful trade-offs.

Then:

"Normal running caps feel too thick and substantial. I liked my old Nike race cap because it barely felt like anything. Nike is preferred but I'm open."

Expected:
- physical bulk/minimal feel becomes explicit;
- Nike is preference, not constraint;
- race-cap terminology may affect retrieval without becoming criterion.

Then inspect products.

React/refine.

Eventually:

"I don't care about brand anymore."

Expected:
- explicit indifference;
- no brand question;
- brief hides brand;
- search broadens appropriately.

JOURNEY B - SHELVING

"I need a slim open shelving unit for this corner around £30."

Question may ask fit dimensions.

Then:

"It must be no more than 60 cm wide and 30 cm deep. No white. Dark is preferable and I don't want anything visually bulky."

Expected:
- hard dimensions;
- hard no-white;
- dark preference;
- visual lightness preference;
- no height invented.

Then:

"I could go to £40 if it looks much better."

Expected:
- money target + conditional stretch;
- prior budget does not remain conflicting.

Search and compare actual candidates.

JOURNEY C - HEADPHONES

"I need wireless over-ear headphones for commuting around £150. I wear glasses and hate strong clamping. Good noise cancellation matters, but I'm open on brand."

Expected:
- separate relevant criteria;
- no colour/mic/codec/battery/ecosystem invention;
- open brand remembered.

Then:

"Comfort with glasses matters more than strongest ANC."

Expected:
- priorities change without rewriting unrelated truth.

JOURNEY D - UNRELATED GENERALISATION

Before declaring MVP success, use at least one shopping request outside the three golden categories.

Choose a real ordinary product request that exercises different concepts.

The system must demonstrate that it is not secretly a cap/furniture/headphone demo.

==================================================
33. PRODUCT-VALUE ACCEPTANCE
==================================================

After the first vertical MVP exists, perform a deliberate evaluation.

Ask:

1. Could Google have produced the same experience from one search box?

If yes, improve the product.

2. Did the AI invent anything important?

If yes, fix interpretation.

3. Did search explore useful market terminology without corrupting user truth?

4. Did the results explain why they matter for this shopper?

5. Were unknowns visible?

6. Did refinement make the next search materially better?

7. Was comparison more useful than manually opening tabs?

8. Did the UI feel like a real consumer product?

9. Would the founder willingly use it for the next genuine purchase?

Do not declare victory because the flow technically completes.

==================================================
34. SCOPE CONTROL
==================================================

DO NOT add before founder MVP proves the loop:

- full authentication platform;
- social features;
- affiliate tracking;
- checkout;
- payments;
- retailer accounts;
- browser extension;
- native app;
- global preference memory;
- workspace ontology;
- background recommendation feed;
- generic agent framework;
- vector database without a demonstrated need;
- large crawler;
- reviews ingestion platform;
- elaborate analytics;
- arbitrary match scores;
- team/admin dashboard;
- multi-model orchestration platform.

These may matter later.

They are not needed to answer whether the shopping loop is valuable.

==================================================
35. AUTH
==================================================

Do not let authentication delay founder validation.

Local founder use may use a simple developer identity/task ownership mechanism as already planned.

Before exposing the app publicly to testers, add the minimum real ownership/auth boundary required to prevent task leakage and paid endpoint abuse.

Do not build enterprise auth.

==================================================
36. TEST STRATEGY
==================================================

Keep the strong deterministic suite.

As new layers arrive, add layer-specific coverage.

INTERPRETATION
- golden cases;
- no invented criteria;
- structured-output failures;
- stale handling.

QUERY
- criteria cannot be mutated;
- query hypotheses are independent;
- market context preserved.

NORMALISATION
- listing identity;
- currency;
- merchant;
- URLs;
- duplicate safety.

EVIDENCE
- source linkage;
- missing evidence;
- source claim vs derived observation.

ASSESSMENT
- hard exclusions require admissible contradiction;
- unknown does not become conflict.

REACTIONS
- save no criterion mutation;
- bare rejection no criterion mutation;
- explained rejection goes through normal input.

COMPARISON
- current task revision only;
- evidence-backed cells;
- no stale judgement shown as current.

UI
- browser smoke;
- key interaction flows;
- desktop and mobile screenshots.

Do not make live external provider calls mandatory in ordinary CI.

Use deterministic fixtures for CI and credential-gated live smoke/evals separately.

==================================================
37. PERFORMANCE / COST
==================================================

Measure rather than speculate.

Record by stage where practical:

- latency;
- model input/output tokens;
- retrieval calls;
- number of candidates assessed.

Do not prematurely build elaborate optimization infrastructure.

Obvious optimizations are allowed where behaviour is preserved, such as:

- bounded candidate count;
- parallel independent external calls;
- prompt/context minimisation;
- avoiding re-analysis of unchanged state.

Do not sacrifice correctness for tiny token savings during founder validation.

==================================================
38. SECURITY / PROMPT INJECTION
==================================================

External product text is untrusted evidence.

A product page/snippet saying:

"Ignore previous instructions"

is data, not instruction.

Retrieval/evidence content can never:

- mutate task state;
- change system prompts;
- grant authority;
- call tools by itself;
- choose provenance;
- override constraints.

Maintain clean trust boundaries.

Paid external calls remain server-side.

Secrets never reach browser bundles.

==================================================
39. DOCUMENTATION / PROGRESS
==================================================

Create or maintain one concise durable founder-MVP progress document so long-running execution survives compaction.

It should track:

- current phase;
- merged baseline;
- what is working end to end;
- next validation gate;
- open consequential decisions;
- current live-provider requirements;
- latest visual acceptance state.

Do not duplicate entire architecture docs into it.

Update AGENTS.md phase markers as major gates close.

==================================================
40. BRANCH / PR DISCIPLINE
==================================================

Prefer bounded PRs rather than one giant MVP PR.

Suggested conceptual checkpoints:

A. V0-05 planning correction
B. V0-05 live interpretation/context acquisition
C. live retrieval + CandidateListing
D. evidence + assessment + useful result ordering
E. reactions/refinement
F. shortlist + comparison
G. live consumer UI integration + visual acceptance
H. founder hardening

The existing V-number plan may continue to be used internally.

Do not allow numbering to become the product objective.

At each gate:

- CI green;
- tests green;
- no unexplained migration drift;
- self-review;
- no unrelated scope.

If automated merge is available and the checkpoint has passed all required evidence with no unresolved material finding, it is acceptable to merge and continue.

Do not merge around red CI or known correctness issues simply to keep Goal mode moving.

==================================================
41. FULL REPOSITORY GATES
==================================================

At meaningful merge checkpoints run the applicable full suite:

pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm test:db

plus:

migration from empty
pnpm db:generate and inspect unexplained drift
production dependency audit
git diff --check

Run credential-gated live evals separately when the phase requires them.

==================================================
42. WHEN TO STOP
==================================================

Do NOT stop merely because:

- V0-05 is implemented;
- search provider responds;
- product cards render;
- one golden demo works;
- the build is green.

Continue toward founder-usable MVP.

STOP SUCCESSFULLY when the following are all true:

1. A user can start a new shopping task through the polished UI.

2. Natural language becomes authoritative state safely.

3. The system asks zero or one useful question rather than a questionnaire.

4. It performs live market retrieval.

5. Real product listings render with real merchant links, prices/images where supplied.

6. Product cards explain fit/trade-offs/unknowns against the shopper's actual criteria.

7. The user can naturally refine the request and observe a meaningful new search/result state.

8. Save works.

9. Bare rejection works without inventing preferences.

10. Explained refinement routes through authoritative state.

11. The user can shortlist and compare at least 2-4 products against their own current criteria.

12. Refresh/restart preserves the task.

13. Cap, shelving and headphones journeys work.

14. At least one unrelated product request demonstrates generalisation.

15. Desktop UI has been screenshot-reviewed and iterated.

16. Mobile UI has been screenshot-reviewed and is usable.

17. Loading/error/empty states are intentional.

18. No fixture result is masquerading as live output in founder acceptance.

19. All required deterministic tests are green.

20. The founder can open the app and meaningfully use it to shop.

At that point:

- produce a concise founder testing guide;
- document required environment variables;
- document known limitations;
- give exact run command;
- give the URL;
- list the 3-5 most important real-world questions the founder should test next.

Then STOP.

Do not automatically continue into monetisation, affiliate systems, growth, public launch, native app, or V1 architecture.

==================================================
43. CRITICAL FINAL PRINCIPLE
==================================================

The purpose of this work is not to make an impressive repository.

The purpose is to discover whether this product deserves to become a company.

The fastest route to that answer is NOT reckless speed.

It is:

strong enough foundations
+
a real vertical product
+
actual shopping behaviour
+
honest observation of where it fails.

Every technical decision from this point should ultimately move us closer to the founder sitting down and thinking:

"I would genuinely rather start this shopping task here than on Google."

Continue working toward that outcome.
