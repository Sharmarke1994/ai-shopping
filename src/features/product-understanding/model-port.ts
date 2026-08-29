import type {
  ModelCallMetadata,
  ModelCallResult,
} from "@/features/context-acquisition/model-port";
import type {
  ProductUnderstandingInputV1,
  ProductUnderstandingProviderWireV1,
} from "./provider-wire";

export type ProductUnderstandingModelResult =
  ModelCallResult<ProductUnderstandingProviderWireV1>;

export type ProductUnderstandingCallPolicy = Readonly<{
  requireCriterionBinding: boolean;
}>;

export interface ProductUnderstandingModel {
  understand(
    input: ProductUnderstandingInputV1,
    policy: ProductUnderstandingCallPolicy,
  ): Promise<ProductUnderstandingModelResult>;
}

export type { ModelCallMetadata };
