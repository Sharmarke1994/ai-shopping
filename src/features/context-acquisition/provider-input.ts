import { z } from "zod";
import {
  interpretShoppingInputRequestV1Schema,
  selectContextActionRequestV1Schema,
} from "./contracts";

export const PROVIDER_INPUT_SCHEMA_VERSION = 1 as const;
export const DEFAULT_PROVIDER_INPUT_MAX_BYTES = 96_000;

const canonicalRevisionSchema = z.string().regex(/^(0|[1-9][0-9]*)$/);

const providerInputEnvelopeSchema = z.strictObject({
  providerInputSchemaVersion: z.literal(PROVIDER_INPUT_SCHEMA_VERSION),
  payload: z.record(z.string(), z.unknown()),
});

export class ContextAcquisitionInputTooLargeError extends Error {
  readonly code = "input_too_large" as const;

  constructor(
    readonly actualBytes: number,
    readonly maximumBytes: number,
  ) {
    super(
      `Complete context-acquisition input is ${actualBytes} bytes; maximum is ${maximumBytes}`,
    );
    this.name = "ContextAcquisitionInputTooLargeError";
  }
}

export type ProviderInputEnvelopeV1 = Readonly<{
  providerInputSchemaVersion: 1;
  payload: Readonly<Record<string, unknown>>;
}>;

export function projectInterpretationProviderInputV1(
  input: unknown,
  maximumBytes = DEFAULT_PROVIDER_INPUT_MAX_BYTES,
): ProviderInputEnvelopeV1 {
  const request = interpretShoppingInputRequestV1Schema.parse(input);
  return boundedEnvelope(
    {
      requestSchemaVersion: request.schemaVersion,
      taskId: request.taskId,
      sourceInputId: request.sourceInputId,
      interpretedRevision: canonicalRevisionSchema.parse(
        request.revision.toString(),
      ),
      market: request.market,
      source: request.source,
      concepts: request.concepts,
      activeCriteria: request.activeCriteria,
    },
    maximumBytes,
  );
}

export function projectContextActionProviderInputV1(
  input: unknown,
  maximumBytes = DEFAULT_PROVIDER_INPUT_MAX_BYTES,
): ProviderInputEnvelopeV1 {
  const request = selectContextActionRequestV1Schema.parse(input);
  return boundedEnvelope(
    {
      requestSchemaVersion: request.schemaVersion,
      taskId: request.taskId,
      sourceInputId: request.sourceInputId,
      currentRevision: canonicalRevisionSchema.parse(
        request.revision.toString(),
      ),
      market: request.market,
      source: request.source,
      concepts: request.concepts,
      activeCriteria: request.activeCriteria,
      brief: request.brief,
      capabilities: request.capabilities,
    },
    maximumBytes,
  );
}

function boundedEnvelope(
  payload: Readonly<Record<string, unknown>>,
  maximumBytes: number,
): ProviderInputEnvelopeV1 {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0) {
    throw new RangeError("maximumBytes must be a positive safe integer");
  }
  const envelope = providerInputEnvelopeSchema.parse({
    providerInputSchemaVersion: PROVIDER_INPUT_SCHEMA_VERSION,
    payload,
  });
  const actualBytes = Buffer.byteLength(JSON.stringify(envelope), "utf8");
  if (actualBytes > maximumBytes) {
    throw new ContextAcquisitionInputTooLargeError(actualBytes, maximumBytes);
  }
  return envelope as ProviderInputEnvelopeV1;
}
