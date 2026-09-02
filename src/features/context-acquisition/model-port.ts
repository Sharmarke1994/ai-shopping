import type {
  ContextActionProviderWire,
  InterpretationProviderWire,
} from "./provider-wire";
import type { ProviderInputEnvelopeV1 } from "./provider-input";
import type { InterpretationCoverageProviderWireV1 } from "./interpretation-coverage";

export type ModelCallMetadata = Readonly<{
  provider: string;
  model: string;
  promptVersion: string;
  providerSchemaVersion: number;
  providerRequestId: string | null;
  durationMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
}>;

export type ModelCallResult<T> =
  | Readonly<{
      status: "completed";
      value: T;
      metadata: ModelCallMetadata;
    }>
  | Readonly<{
      status:
        | "refused"
        | "incomplete"
        | "malformed"
        | "timed_out"
        | "provider_failed";
      errorCode: string;
      metadata: ModelCallMetadata;
    }>;

export interface ContextAcquisitionModel {
  interpret(
    input: ProviderInputEnvelopeV1,
  ): Promise<ModelCallResult<InterpretationProviderWire>>;
  selectAction(
    input: ProviderInputEnvelopeV1,
  ): Promise<ModelCallResult<ContextActionProviderWire>>;
  /** Optional on legacy fixtures; production adapters implement both calls. */
  verifyInterpretationCoverage?(
    input: ProviderInputEnvelopeV1,
  ): Promise<ModelCallResult<InterpretationCoverageProviderWireV1>>;
  repairInterpretation?(
    input: ProviderInputEnvelopeV1,
  ): Promise<ModelCallResult<InterpretationProviderWire>>;
}
