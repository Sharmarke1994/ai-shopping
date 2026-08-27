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

export interface ProductUnderstandingModel {
  understand(
    input: ProductUnderstandingInputV1,
  ): Promise<ProductUnderstandingModelResult>;
}

export type { ModelCallMetadata };
