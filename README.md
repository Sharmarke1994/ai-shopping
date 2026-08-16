# AI Shopping

An AI-first consumer shopping product that turns incomplete, evolving intent
into evidence-aware product discovery and confident decisions.

The accepted V0-02 fixture-driven consumer shell remains the visible product
hypothesis. V0-03 is the current bounded implementation slice: a task-scoped
semantic domain and PostgreSQL persistence foundation. The durable product,
semantic, retrieval, and delivery decisions live in [`docs/`](docs/), with the
working invariants in [`AGENTS.md`](AGENTS.md).

The UI is deliberately powered by prepared, fictional fixture journeys. Use
the landing examples or a direct `?fixture=` URL; it does not call live AI,
retailers, search providers, or persistence.

The **Consider** wordmark is a working prototype label, not an approved product
name or durable brand decision.

## Local setup

Requirements: Node.js 22.18.0 and pnpm 11.

```bash
cp .env.example .env.local
pnpm install
pnpm dev
```

The foundation and fixture UI run without external credentials. Individual
live adapters validate only the secrets they require when they are invoked.

## Verification

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

`pnpm check` runs all non-browser checks in sequence.

With the local app running on port 3100, `pnpm screenshots:v0-02` regenerates
the desktop, laptop, and mobile review matrix in
[`docs/reviews/v0-02/screenshots`](docs/reviews/v0-02/screenshots/).

Browser tests use installed Google Chrome on macOS. Linux and CI use the
Playwright-managed Chromium runtime; install it with
`pnpm exec playwright install chromium`.

## PostgreSQL persistence checks

Ordinary checks do not open a database. The explicit persistence suite requires
a visibly test-only PostgreSQL URL and creates then drops a uniquely named
disposable database beneath it.

```bash
docker compose -f compose.persistence.yml up -d
export TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:54329/ai_shopping_test
pnpm test:db
docker compose -f compose.persistence.yml down
```

The compose service and CI use the PostgreSQL 17.6 image/digest recorded in the
V0-03 plan. Never point `TEST_DATABASE_URL` at a shared or production database.
Release migrations require `DIRECT_DATABASE_URL` and run only through
`pnpm db:migrate`; application imports and startup never migrate implicitly.
