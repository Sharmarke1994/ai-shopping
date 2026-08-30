import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";
import { z } from "zod";
import {
  merchantDestinationResolutionRequestSchema,
  merchantDestinationResolutionResultSchema,
} from "../src/features/purchase-destinations/contracts";
import { buildExactOfferMerchantQuery } from "../src/features/purchase-destinations/exact-offer-policy";
import { SerperMerchantDestinationResolver } from "../src/features/purchase-destinations/serper-merchant-destination-resolver";

const executeFile = promisify(execFile);
const outputDirectory = new URL("../docs/evals/", import.meta.url);
const markerUrl = new URL(
  "v0-09-recovery-rc2-destination-diagnostic-attempt.json",
  outputDirectory,
);
const resultUrl = new URL(
  "v0-09-recovery-rc2-destination-diagnostic.json",
  outputDirectory,
);
const failureUrl = new URL(
  "v0-09-recovery-rc2-destination-diagnostic-failure.json",
  outputDirectory,
);
const historicalArtifactUrl = new URL(
  "../docs/evals/v0-09-recovery-rc1-founder-proof-failure.json",
  import.meta.url,
);

const historicalListingSchema = z.strictObject({
  id: z.uuid(),
  runId: z.uuid(),
  title: z.string().min(1).max(1_000),
  merchant: z.string().min(1).max(500),
  priceText: z.string().nullable(),
  googleShoppingUrl: z.url(),
  originalMerchantDestinationUrl: z.url().nullable(),
});
const historicalArtifactSchema = z.object({
  activeCaseSnapshot: z.object({
    taskId: z.uuid(),
    listings: z.array(historicalListingSchema),
  }),
});

const exactHistoricalListingIds = [
  "884ea2d0-c19f-4b1d-8a42-c3e3a02d9a60", // Anker at eBay
  "492fa4e0-c88a-4bef-a396-d255734520e6", // Trust Bayo II at Argos
  "4ab8dd1f-1c14-4073-b548-33e087a421a8", // TeckNet at Amazon seller
] as const;

async function exists(url: URL) {
  try {
    await access(url);
    return true;
  } catch {
    return false;
  }
}

async function readSerperKey() {
  const { stdout } = await executeFile("security", [
    "find-generic-password",
    "-s",
    "ai-shopping-serper",
    "-w",
  ]);
  const value = stdout.trim();
  if (value.length < 20)
    throw new Error("Serper Keychain credential is absent");
  return value;
}

function safeDestination(raw: string) {
  const url = new URL(raw);
  url.username = "";
  url.password = "";
  for (const key of [...url.searchParams.keys()]) {
    const normalized = key.toLocaleLowerCase("en-GB");
    if (
      normalized.includes("token") ||
      normalized.includes("key") ||
      normalized.includes("secret") ||
      normalized === "gclid" ||
      normalized === "srsltid"
    ) {
      url.searchParams.delete(key);
    }
  }
  return url.toString();
}

await mkdir(outputDirectory, { recursive: true });
if (
  (await exists(markerUrl)) ||
  (await exists(resultUrl)) ||
  (await exists(failureUrl))
) {
  throw new Error(
    "RC2 destination diagnostic already has preserved evidence; refusing another provider run",
  );
}
const historical = historicalArtifactSchema.parse(
  JSON.parse(await readFile(historicalArtifactUrl, "utf8")),
);
const listings = exactHistoricalListingIds.map((id) => {
  const listing = historical.activeCaseSnapshot.listings.find(
    (candidate) => candidate.id === id,
  );
  if (listing === undefined) {
    throw new Error(`Frozen historical listing is absent: ${id}`);
  }
  return listing;
});
await writeFile(
  markerUrl,
  `${JSON.stringify(
    {
      schemaVersion: 1,
      diagnostic: "v0_09_recovery_rc2_exact_destination",
      claimedAt: new Date().toISOString(),
      provider: "serper",
      exactHistoricalListingIds,
    },
    null,
    2,
  )}\n`,
  { encoding: "utf8", flag: "wx" },
);

let key = "";
try {
  key = await readSerperKey();
  const resolver = new SerperMerchantDestinationResolver({ apiKey: key });
  const results = [];
  for (const listing of listings) {
    const request = merchantDestinationResolutionRequestSchema.parse({
      requestId: randomUUID(),
      taskId: historical.activeCaseSnapshot.taskId,
      searchRunId: listing.runId,
      candidateListingId: listing.id,
      title: listing.title,
      merchant: listing.merchant,
      googleShoppingUrl: listing.googleShoppingUrl,
      queryText: buildExactOfferMerchantQuery({
        title: listing.title,
        merchant: listing.merchant,
      }),
    });
    const startedAt = performance.now();
    const result = merchantDestinationResolutionResultSchema.parse(
      await resolver.resolve(request),
    );
    results.push({
      candidateListingId: listing.id,
      title: listing.title,
      merchant: listing.merchant,
      durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
      ...(result.outcome === "resolved"
        ? {
            outcome: result.outcome,
            destinationUrl: safeDestination(result.destinationUrl),
            acceptedResultTitle: result.acceptedResultTitle,
            observedResultUrl:
              result.observedResultUrl === null
                ? null
                : safeDestination(result.observedResultUrl),
            consideredResultCount: result.consideredResultCount,
          }
        : {
            outcome: result.outcome,
            rejectionCode: result.rejectionCode,
            consideredResultCount: result.consideredResultCount,
          }),
    });
  }
  const report = {
    schemaVersion: 1,
    diagnostic: "v0_09_recovery_rc2_exact_destination",
    generatedAt: new Date().toISOString(),
    provider: "serper",
    listingCount: listings.length,
    resolvedCount: results.filter(({ outcome }) => outcome === "resolved")
      .length,
    rejectedCount: results.filter(({ outcome }) => outcome === "rejected")
      .length,
    results,
    releaseAccepted: false,
    note: "This bounded diagnostic reuses three exact frozen task-local offers. It does not substitute merchants, mutate a SearchRun, or count as V0-09 release evidence.",
  };
  await writeFile(resultUrl, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} catch (error) {
  const rawMessage = error instanceof Error ? error.message : "Unknown error";
  const message = rawMessage
    .replaceAll(key, "[redacted-serper-key]")
    .replace(/\b(?:sk|serper)-[A-Za-z0-9_-]+\b/g, "[redacted-secret]")
    .slice(0, 500);
  await writeFile(
    failureUrl,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        diagnostic: "v0_09_recovery_rc2_exact_destination_failed",
        generatedAt: new Date().toISOString(),
        provider: "serper",
        failure: {
          name: error instanceof Error ? error.name : "UnknownError",
          message,
        },
        releaseAccepted: false,
      },
      null,
      2,
    )}\n`,
    { encoding: "utf8", flag: "wx" },
  );
  throw new Error(message);
} finally {
  key = "";
}
