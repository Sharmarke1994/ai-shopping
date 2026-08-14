# Vision and Product Principles

**Status:** Approved foundation
**Last reviewed:** 2026-08-14

## Mission

Build the shopping intelligence layer that turns incomplete, natural, and evolving human intent into confident purchasing decisions.

## User promise

Describe what you want in your own words. The product will help uncover what matters, search using language the market understands, examine available evidence, remember refinements, and help you choose—without requiring product jargon, perfect filters, or repeated explanations.

## Technical thesis

Excellent AI shopping requires explicit mutable state, adaptive information acquisition, search strategy, request-specific product knowledge, evidence-grounded judgement, and dedicated decision UX. Conversation is an input; the application owns truth.

## What we are building

A shopping task is a persistent decision workspace. The shopper starts with an ordinary sentence. The system develops an inspectable brief, asks only worthwhile questions, searches Google-backed results, evaluates candidates against the current brief, explains meaningful trade-offs, and updates the same task as the shopper reacts.

Products, evidence, saved candidates, comparisons, and current intent are first-class objects. This is not a transcript with product cards appended to it.

The long-term opportunity is broader than better product search: a shopping intelligence layer between human intent and the product internet.

## What this is not

- A generic chatbot wrapper
- A product carousel with affiliate links
- A prettier Google results page
- A universal ecommerce filter form
- An interior-design or workspace product at its core
- A giant product catalogue, crawler, or static ontology

## Protected principles

1. **Shopping is iterative.** Understand → clarify → search → learn from the market → show → react → refine → search again → compare → decide.
2. **State is explicit and mutable.** Chat history is provenance, not the database. Changing one's mind is normal.
3. **Unknown is valid.** Unmentioned information stays absent unless it becomes decision-relevant.
4. **Context is scoped.** V0 criteria belong to a shopping task. Workspace and user memory are later, explicit layers.
5. **Dynamic concepts have semantic structure.** Concepts are open-ended; the surrounding records, value shapes, authority, provenance, and lifecycle are controlled.
6. **Both sides are dynamic.** What a shopper cares about and what must be learned about a product depend on the user, item, request, and context.
7. **Truth, hypothesis, evidence, and judgement differ.** User criteria, search terms, product observations, suitability assessments, and comparative ranking never collapse into one attribute bag.
8. **Explicit beats inferred.** Inference may aid search or prompt confirmation; it does not silently rewrite intent.
9. **Questions earn their interruption.** Unknown alone is not a reason to ask. There is no fixed question count or numeric question-value theatre.
10. **Search is an engineering discipline.** Query formulation, retrieval, normalisation, product understanding, and judgement remain diagnostically separable.
11. **Relevance is not suitability.** Marketing-language matches are insufficient when the shopper cares about less obvious physical, visual, experiential, or contextual qualities.
12. **Evidence controls trust.** Claims identify whether they come from structured fields, source assertions, extraction, visual inference, or remain unknown.
13. **Rejection is conservative.** “Not for me” hides the candidate in this task. Only explicit explanation may update criteria through the normal state contract.
14. **Decision UX matters.** The product should help people browse, react, refine, save, compare, and decide—not merely produce an answer.
15. **Ranking serves the shopper.** No affiliate signal may improve rank. No fake percentages, medals, or arbitrary weighted formulas.
16. **Quality is part of V0.** Small scope is acceptable; generic dashboard/chatbot aesthetics and careless states are not.

## Founder operating principle

Architect for learning, not completeness.

Protect boundaries that would be expensive to undo, implement the smallest credible version, use it, observe the failing layer, and improve from evidence. Progress is validated learning rather than feature count or compliance with an arbitrary date.

## Product success standard

The durable question is whether a shopper would prefer this experience to combining a general-purpose AI, Google, retailer tabs, and repeated query rewriting. Success means less repetition, better questions, more useful discovery, honest evidence, persistent refinement, clearer trade-offs, and greater decision confidence.
