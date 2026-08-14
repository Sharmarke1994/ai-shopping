# AI Shopping

An AI-first consumer shopping product that turns incomplete, evolving intent
into evidence-aware product discovery and confident decisions.

The repository is currently at the V0-01 application-foundation checkpoint.
The durable product, semantic, retrieval, and delivery decisions live in
[`docs/`](docs/), with the working invariants in [`AGENTS.md`](AGENTS.md).

## Local setup

Requirements: Node.js 22 and pnpm 11.

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

Browser tests use installed Google Chrome on macOS. Linux and CI use the
Playwright-managed Chromium runtime; install it with
`pnpm exec playwright install chromium`.
