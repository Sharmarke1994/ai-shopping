import { randomUUID } from "node:crypto";
import { access, mkdir, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import type { ContextAcquisitionModel } from "../src/features/context-acquisition/model-port";
import type {
  ContextActionProviderWireV1,
  InterpretationProviderWireV1,
} from "../src/features/context-acquisition/provider-wire";
import {
  startLiveShopping,
  type LiveShoppingDependencies,
} from "../src/features/live-shopping/application";
import { admitFetchedPageEvidence } from "../src/features/product-understanding/page-evidence-admission";
import {
  computeExtractedPageDocumentHash,
  extractProductPageDocument,
} from "../src/features/product-understanding/page-extraction";
import {
  MAX_PAGE_RETAINED_DOCUMENT_BYTES,
  MAX_PERSISTED_PAGE_DOCUMENT_JSON_BYTES,
} from "../src/features/product-understanding/page-budgets";
import {
  fetchBoundedPage,
  requestWithPinnedAddress,
} from "../src/features/product-understanding/page-fetch";
import {
  evidenceSearchResponseSchema,
  type EvidenceSearchProvider,
} from "../src/features/product-understanding/evidence-search";
import { FakeProductUnderstandingModel } from "../src/features/product-understanding/fakes";
import {
  loadEvidenceResearchRun,
  loadFetchedEvidenceDocuments,
} from "../src/features/product-understanding/persistence";
import { PRODUCT_UNDERSTANDING_PROMPT_VERSION } from "../src/features/product-understanding/prompts";
import { executeOrResumeEvidenceResearch } from "../src/features/product-understanding/research-orchestrator";
import {
  candidateListingSchema,
  providerSearchResultSchema,
  type SearchQuery,
  type ShoppingSearchProvider,
} from "../src/features/retrieval-spike/contracts";
import { requireTestDatabaseEnvironment } from "../src/infrastructure/config/environment";
import { createDatabaseConnection } from "../src/infrastructure/database/clients";
import { migrateDatabase } from "../src/infrastructure/database/migrate";
import {
  founderLiveSessions,
  searchRuns,
} from "../src/infrastructure/database/schema";

const outputDirectory = new URL("../docs/evals/", import.meta.url);
const successJson = new URL(
  "v0-09-recovery-rc2-page-soak.json",
  outputDirectory,
);
const successMarkdown = new URL(
  "v0-09-recovery-rc2-page-soak.md",
  outputDirectory,
);
const failureJson = new URL(
  "v0-09-recovery-rc2-page-soak-failure.json",
  outputDirectory,
);
const disposableDatabasePattern =
  /^ai_shopping_test_v009_rc2_soak_[a-f0-9]{32}$/;

const exactSources = [
  {
    key: "toms-guide-anker-review",
    candidateTitle: "Anker 2.4G Wireless Vertical Ergonomic Optical Mouse",
    merchant: "Anker",
    role: "independent_review" as const,
    title: "Anker 2.4G Wireless Vertical Ergonomic mouse review",
    url: "https://www.tomsguide.com/computing/peripherals/anker-2-4g-wireless-vertical-ergonomic-mouse-review",
  },
  {
    key: "anker-product",
    candidateTitle: "Anker 2.4G Wireless Vertical Ergonomic Optical Mouse",
    merchant: "Anker",
    role: "other" as const,
    title: "Anker 2.4G Wireless Vertical Ergonomic Optical Mouse",
    url: "https://www.anker.com/products/a7582",
  },
  {
    key: "amazon-kensington-retailer",
    candidateTitle: "Kensington Pro Fit Ergo MY630 EQ Rechargeable Mouse",
    merchant: "Amazon",
    role: "retailer" as const,
    title: "Kensington Pro Fit Ergo MY630 EQ Rechargeable Mouse",
    url: "https://www.amazon.co.uk/Kensington-Rechargeable-Bluetooth-Post-Consumer-K72482WW/dp/B0DDTPGZ66",
  },
] as const;

const metadata = {
  provider: "fixture",
  model: "rc2-page-soak-context",
  promptVersion: "rc2-page-soak-v1",
  providerSchemaVersion: 1,
  providerRequestId: "rc2-page-soak-context",
  durationMs: 0,
  inputTokens: null,
  outputTokens: null,
} as const;

const interpretation: InterpretationProviderWireV1 = {
  providerSchemaVersion: 1,
  outcome: "change",
  operations: [
    {
      op: "create_concept",
      localRef: "battery_life",
      label: "Battery life",
      definition: "Published battery life for the exact mouse",
      valueFamily: "qualitative",
      canonicalUnit: null,
    },
    {
      op: "add_criterion",
      concept: { kind: "created", localRef: "battery_life" },
      target: {
        strength: "preference",
        targetSemantics: "qualitative",
        semanticValue: {
          schemaVersion: 1,
          kind: "qualitative_text",
          text: "good battery life",
        },
      },
    },
  ],
  ambiguities: [],
};

const searchAction: ContextActionProviderWireV1 = {
  providerSchemaVersion: 1,
  action: "search",
  question: null,
  rationale: { summary: "The exact mouse request is ready." },
};

function contextModel(): ContextAcquisitionModel {
  return {
    interpret: async () => ({
      status: "completed" as const,
      value: interpretation,
      metadata,
    }),
    selectAction: async () => ({
      status: "completed" as const,
      value: searchAction,
      metadata,
    }),
  };
}

class ExactAnkerShoppingProvider implements ShoppingSearchProvider {
  readonly provider = "fixture" as const;
  readonly maxRequestDurationMs = 0;
  #calls = 0;

  async search(query: SearchQuery) {
    this.#calls += 1;
    if (this.#calls > 1) {
      return providerSearchResultSchema.parse({
        listings: [],
        diagnostics: { receivedResultCount: 0, rejectedResultCount: 0 },
      });
    }
    const source = exactSources[1];
    return providerSearchResultSchema.parse({
      listings: [
        candidateListingSchema.parse({
          taskId: query.taskId,
          runId: query.runId,
          queryId: query.id,
          provider: "fixture",
          providerResultId: "rc2-soak-anker-a7582",
          sourceRank: 1,
          surface: "shopping",
          title: source.candidateTitle,
          url: source.url,
          canonicalUrl: source.url,
          merchantDestinationUrl: null,
          merchantDestinationSource: null,
          merchant: source.merchant,
          price: null,
          priceText: null,
          imageUrl: null,
          deliveryText: null,
          availabilityText: null,
          reviewEvidence: null,
          retrievedAt: new Date(),
        }),
      ],
      diagnostics: { receivedResultCount: 1, rejectedResultCount: 0 },
    });
  }
}

class ExactAnkerEvidenceProvider implements EvidenceSearchProvider {
  readonly provider = "fixture" as const;

  async search() {
    const source = exactSources[0];
    return evidenceSearchResponseSchema.parse({
      providerRequestId: "rc2-soak-toms-guide-anker-evidence",
      receivedResultCount: 1,
      results: [
        {
          providerResultId: "rc2-soak-toms-guide-anker-source",
          rank: 1,
          title: source.title,
          url: source.url,
          snippet: "A hands-on review of the exact Anker vertical mouse.",
          sourceRole: source.role,
        },
      ],
    });
  }
}

type FetchSuccessDiagnostic = Readonly<{
  outcome: "fetched";
  key: (typeof exactSources)[number]["key"];
  requestedUrl: string;
  requestedHost: string;
  finalUrl: string;
  finalHost: string;
  sourceRole: (typeof exactSources)[number]["role"];
  responseStatus: number | null;
  declaredContentLength: number | null;
  encodedBytes: number;
  decodedBytes: number;
  redirectCount: number;
  retainedDocumentBytes: number;
  retainedVisibleTextCharacters: number;
  canonicalUrlCandidate: string | null;
  title: string | null;
  products: readonly Readonly<{
    name: string | null;
    brand: string | null;
    model: string | null;
    sku: string | null;
    mpn: string | null;
  }>[];
  admission:
    | Readonly<{ decision: "admit"; sourceRole: string }>
    | Readonly<{ decision: "reject"; reason: string }>;
  durationMs: number;
}>;

type FetchFailureDiagnostic = Readonly<{
  outcome: "failed";
  key: (typeof exactSources)[number]["key"];
  requestedUrl: string;
  requestedHost: string;
  sourceRole: (typeof exactSources)[number]["role"];
  failure: Readonly<{ name: string; message: string }>;
}>;

type FetchDiagnostic = FetchSuccessDiagnostic | FetchFailureDiagnostic;

function contentLength(value: string | readonly string[] | undefined) {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (typeof candidate !== "string" || !/^\d{1,16}$/.test(candidate)) {
    return null;
  }
  const parsed = Number(candidate);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

async function inspectSource(source: (typeof exactSources)[number]) {
  let responseStatus: number | null = null;
  let declaredContentLength: number | null = null;
  const startedAt = performance.now();
  const fetch = await fetchBoundedPage({
    url: source.url,
    requester: async (options) => {
      const response = await requestWithPinnedAddress(options);
      responseStatus = response.statusCode;
      declaredContentLength = contentLength(response.headers["content-length"]);
      return response;
    },
  });
  const document = extractProductPageDocument({
    html: fetch.text,
    sourceUrl: fetch.finalUrl,
  });
  const admission = admitFetchedPageEvidence({
    candidateTitle: source.candidateTitle,
    merchant: source.merchant,
    discovered: {
      sourceRole: source.role,
      url: source.url,
      title: source.title,
    },
    page: {
      finalUrl: fetch.finalUrl,
      canonicalUrl: document.canonicalUrlCandidate,
      title: document.title,
      openGraphTitle: document.metadata.openGraphTitle,
      products: document.jsonLdProducts.map((product) => ({
        productName: product.name,
        brand: product.brand,
        model: product.model,
        sku: product.sku,
        mpn: product.mpn,
      })),
    },
  });
  return {
    outcome: "fetched" as const,
    key: source.key,
    requestedUrl: source.url,
    requestedHost: new URL(source.url).hostname,
    finalUrl: fetch.finalUrl,
    finalHost: new URL(fetch.finalUrl).hostname,
    sourceRole: source.role,
    responseStatus,
    declaredContentLength,
    encodedBytes: fetch.encodedBytes,
    decodedBytes: fetch.decodedBytes,
    redirectCount: fetch.redirectCount,
    retainedDocumentBytes: Buffer.byteLength(JSON.stringify(document), "utf8"),
    retainedVisibleTextCharacters: document.visibleText.length,
    canonicalUrlCandidate: document.canonicalUrlCandidate,
    title: document.title,
    products: document.jsonLdProducts.map((product) => ({
      name: product.name,
      brand: product.brand,
      model: product.model,
      sku: product.sku,
      mpn: product.mpn,
    })),
    admission:
      admission.decision === "admit"
        ? { decision: admission.decision, sourceRole: admission.admittedRole }
        : { decision: admission.decision, reason: admission.reason },
    durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
  };
}

function json(value: unknown) {
  return JSON.stringify(value, null, 2);
}

async function exists(url: URL) {
  try {
    await access(url);
    return true;
  } catch {
    return false;
  }
}

await mkdir(outputDirectory, { recursive: true });
if (await exists(successJson)) {
  throw new Error(
    "RC2 page-soak success evidence already exists; refusing to overwrite it",
  );
}

const { TEST_DATABASE_URL } = requireTestDatabaseEnvironment(process.env);
const databaseName = `ai_shopping_test_v009_rc2_soak_${randomUUID().replaceAll("-", "")}`;
if (!disposableDatabasePattern.test(databaseName)) {
  throw new Error("Refusing to create an unguarded RC2 soak database");
}
const disposableUrl = new URL(TEST_DATABASE_URL);
disposableUrl.pathname = `/${databaseName}`;
const admin = postgres(TEST_DATABASE_URL, { max: 1, prepare: false });
let connection: ReturnType<typeof createDatabaseConnection> | null = null;
let databaseCreated = false;
let report: unknown = null;
let failure: unknown = null;
let disposableDatabaseDestroyed = false;
const cleanupErrors: unknown[] = [];
const sourceDiagnostics: FetchDiagnostic[] = [];
let orchestratedFetchMetadata: Readonly<{
  requestedUrl: string;
  finalUrl: string;
  encodedBytes: number;
  decodedBytes: number;
  responseHash: string;
}> | null = null;

try {
  for (const source of exactSources) {
    try {
      sourceDiagnostics.push(await inspectSource(source));
    } catch (error) {
      sourceDiagnostics.push({
        outcome: "failed",
        key: source.key,
        requestedUrl: source.url,
        requestedHost: new URL(source.url).hostname,
        sourceRole: source.role,
        failure:
          error instanceof Error
            ? { name: error.name, message: error.message.slice(0, 500) }
            : { name: "UnknownError", message: "Unknown page failure" },
      });
    }
  }

  await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
  databaseCreated = true;
  await migrateDatabase({ url: disposableUrl.toString() });
  connection = createDatabaseConnection({
    url: disposableUrl.toString(),
    prepare: false,
  });
  const model = new FakeProductUnderstandingModel();
  const sessionId = randomUUID();
  await startLiveShopping({
    dependencies: {
      db: connection.db,
      model: contextModel(),
      provider: new ExactAnkerShoppingProvider(),
    } satisfies LiveShoppingDependencies,
    input: {
      operation: "start",
      sessionId,
      turnId: randomUUID(),
      message:
        "Anker 2.4G Wireless Vertical Ergonomic Optical Mouse with good battery life",
    },
  });
  const [session] = await connection.db
    .select()
    .from(founderLiveSessions)
    .where(eq(founderLiveSessions.id, sessionId));
  if (session === undefined) throw new Error("RC2 soak session was not stored");
  const [searchRun] = await connection.db
    .select()
    .from(searchRuns)
    .where(eq(searchRuns.taskId, session.taskId));
  if (searchRun === undefined) throw new Error("RC2 soak search run is absent");
  const research = await executeOrResumeEvidenceResearch({
    dependencies: {
      db: connection.db,
      evidenceProvider: new ExactAnkerEvidenceProvider(),
      pageFetcher: {
        provider: "server_http",
        fetch: async ({ url }) => {
          const fetch = await fetchBoundedPage({ url });
          orchestratedFetchMetadata = {
            requestedUrl: url,
            finalUrl: fetch.finalUrl,
            encodedBytes: fetch.encodedBytes,
            decodedBytes: fetch.decodedBytes,
            responseHash: fetch.responseHash,
          };
          return fetch;
        },
      },
      model,
      modelIdentity: {
        provider: "fixture",
        model: "fixture-product-understanding",
        promptVersion: PRODUCT_UNDERSTANDING_PROMPT_VERSION,
      },
    },
    taskId: session.taskId,
    searchRunId: searchRun.id,
    mode: "first_pass",
  });
  const replay = await loadEvidenceResearchRun({
    db: connection.db,
    taskId: session.taskId,
    researchRunId: research.run.id,
  });
  if (replay === null) throw new Error("RC2 soak replay is absent");
  const fetchedSource = replay.sources.find(
    ({ sourceKind }) => sourceKind === "fetched_page",
  );
  if (fetchedSource === undefined) {
    throw new Error("RC2 soak did not persist an admitted fetched page");
  }
  const [storedDocument] = await loadFetchedEvidenceDocuments({
    db: connection.db,
    taskId: session.taskId,
    researchRunId: research.run.id,
    candidateListingId: fetchedSource.candidateListingId,
    evidenceSourceIdsInOrder: [fetchedSource.id],
  });
  if (storedDocument === undefined) {
    throw new Error("RC2 soak fetched document is absent on replay");
  }
  const capturedFetch = orchestratedFetchMetadata as null | Readonly<{
    requestedUrl: string;
    finalUrl: string;
    encodedBytes: number;
    decodedBytes: number;
    responseHash: string;
  }>;
  if (capturedFetch === null) {
    throw new Error("RC2 soak did not capture the orchestrated page response");
  }
  if (
    storedDocument.encodedBytes <= 1_500_000 ||
    storedDocument.decodedBytes <= 1_500_000
  ) {
    throw new Error(
      "RC2 soak exact page did not cross the historical 1.5 MB persistence boundary",
    );
  }
  if (
    storedDocument.requestedUrl !== capturedFetch.requestedUrl ||
    storedDocument.finalUrl !== capturedFetch.finalUrl ||
    storedDocument.encodedBytes !== capturedFetch.encodedBytes ||
    storedDocument.decodedBytes !== capturedFetch.decodedBytes ||
    storedDocument.responseHash !== capturedFetch.responseHash
  ) {
    throw new Error(
      "RC2 soak persisted response metadata differs from the orchestrated fetch",
    );
  }
  if (
    storedDocument.documentHash !==
    computeExtractedPageDocumentHash(storedDocument.document)
  ) {
    throw new Error("RC2 soak persisted extracted-document hash is invalid");
  }
  const retainedDocumentBytes = Buffer.byteLength(
    JSON.stringify(storedDocument.document),
    "utf8",
  );
  if (
    retainedDocumentBytes > MAX_PERSISTED_PAGE_DOCUMENT_JSON_BYTES ||
    retainedDocumentBytes >= storedDocument.decodedBytes ||
    Buffer.byteLength(storedDocument.document.visibleText, "utf8") >
      MAX_PAGE_RETAINED_DOCUMENT_BYTES
  ) {
    throw new Error("RC2 soak retained evidence exceeds its independent bound");
  }
  const modelCall = model.calls.find((input) =>
    input.sources.some(
      ({ kind, url }) =>
        kind === "fetched_page" && url === fetchedSource.sourceUrl,
    ),
  );
  if (modelCall === undefined) {
    throw new Error(
      "RC2 soak model input did not receive fetched-page evidence",
    );
  }
  const modelSource = modelCall.sources.find(
    ({ kind, url }) =>
      kind === "fetched_page" && url === fetchedSource.sourceUrl,
  );
  if (
    modelSource === undefined ||
    modelSource.title !== fetchedSource.sourceTitle ||
    modelSource.role !== fetchedSource.sourceRole ||
    modelSource.excerpt !== fetchedSource.excerpt
  ) {
    throw new Error(
      "RC2 soak model source differs from the replayed page source",
    );
  }
  report = {
    schemaVersion: 1,
    diagnostic: "v0_09_recovery_rc2_page_soak",
    generatedAt: new Date().toISOString(),
    sourceDiagnostics,
    persistenceReplay: {
      taskId: session.taskId,
      searchRunId: searchRun.id,
      researchRunId: research.run.id,
      researchStatus: research.run.status,
      fetchedSourceRole: fetchedSource.sourceRole,
      requestedUrl: storedDocument.requestedUrl,
      finalUrl: storedDocument.finalUrl,
      encodedBytes: storedDocument.encodedBytes,
      decodedBytes: storedDocument.decodedBytes,
      responseHashMatchesFetch: true,
      documentHashMatchesReplay: true,
      retainedDocumentBytes,
      retainedVisibleTextBytes: Buffer.byteLength(
        storedDocument.document.visibleText,
        "utf8",
      ),
      retainedDocumentWithinEnvelope: true,
      fetchedPageEnteredModel: true,
      modelSourceCount: modelCall.sources.length,
      modelSourceMatchesReplay: true,
      rawResponseRetention: "schema_excludes_raw_response_body",
    },
  };
} catch (error) {
  failure = error;
} finally {
  try {
    await connection?.close();
  } catch (error) {
    cleanupErrors.push(error);
  }
  if (databaseCreated) {
    try {
      await admin.unsafe(
        `DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`,
      );
      disposableDatabaseDestroyed = true;
    } catch (error) {
      cleanupErrors.push(error);
    }
  } else {
    disposableDatabaseDestroyed = true;
  }
  try {
    await admin.end();
  } catch (error) {
    cleanupErrors.push(error);
  }
  if (failure === null && cleanupErrors.length > 0) {
    failure = new Error("RC2 soak disposable-database cleanup failed");
  }
}

if (failure !== null) {
  const scrubbedMessage = (
    failure instanceof Error ? failure.message : "Unknown RC2 soak failure"
  )
    .replaceAll(TEST_DATABASE_URL, "[redacted-test-database]")
    .replaceAll(disposableUrl.toString(), "[redacted-disposable-database]")
    .replace(/postgres(?:ql)?:\/\/[^\s;]+/gi, "[redacted-database-url]")
    .replace(/\bsk-[A-Za-z0-9_-]+\b/g, "[redacted-secret]")
    .slice(0, 1_000);
  const failureReport = {
    schemaVersion: 1,
    diagnostic: "v0_09_recovery_rc2_page_soak_failed",
    generatedAt: new Date().toISOString(),
    sourceDiagnostics,
    failure: {
      name: failure instanceof Error ? failure.name : "UnknownError",
      message: scrubbedMessage,
    },
    cleanup: {
      disposableDatabaseDestroyed,
      errorCount: cleanupErrors.length,
    },
  };
  await writeFile(failureJson, `${json(failureReport)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  throw new Error(scrubbedMessage);
}

const finalReport = {
  ...(report as Record<string, unknown>),
  cleanup: {
    disposableDatabaseDestroyed,
    errorCount: cleanupErrors.length,
  },
} as Record<string, unknown> & {
  cleanup: { disposableDatabaseDestroyed: boolean; errorCount: number };
};
const generatedAt =
  typeof finalReport.generatedAt === "string"
    ? finalReport.generatedAt
    : new Date().toISOString();
await Promise.all([
  writeFile(successJson, `${json(finalReport)}\n`, {
    encoding: "utf8",
    flag: "wx",
  }),
  writeFile(
    successMarkdown,
    `# V0-09 Recovery RC2 page soak\n\nGenerated: ${generatedAt}\n\nThe exact historical pages were fetched only through the bounded SSRF-safe production transport. Raw HTML remained ephemeral. The exact Tom's Guide Anker review crossed fetch, extraction, exact admission, typed persistence, replay and bounded model-input projection in a disposable database.\n\n\`\`\`json\n${json(finalReport)}\n\`\`\`\n`,
    { encoding: "utf8", flag: "wx" },
  ),
]);
process.stdout.write(`${json(finalReport)}\n`);
