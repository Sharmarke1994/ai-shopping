import { projectShoppingBrief } from "@/domain/shopping-state/brief";
import {
  currentShoppingStateSchema,
  type CurrentShoppingState,
} from "@/domain/shopping-state/shopping-state";
import { taskInputIdSchema } from "@/domain/shopping-state/ids";
import {
  interpretShoppingInputRequestV1Schema,
  resolvedShoppingInputV1Schema,
  selectContextActionRequestV1Schema,
  type ResolvedShoppingInputV1,
} from "./contracts";

function authoritativeContext(stateInput: CurrentShoppingState) {
  const state = currentShoppingStateSchema.parse(stateInput);
  return {
    taskId: state.task.id,
    revision: state.task.currentRevision,
    market: state.task.market,
    concepts: state.concepts.map((concept) => ({
      id: concept.id,
      label: concept.label,
      definition: concept.definition,
      valueFamily: concept.valueFamily,
      canonicalUnit: concept.canonicalUnit,
    })),
    activeCriteria: state.activeCriteria.map(({ criterion }) => ({
      id: criterion.id,
      conceptId: criterion.conceptId,
      authority: criterion.authority,
      strength: criterion.strength,
      targetSemantics: criterion.targetSemantics,
      semanticValue: criterion.semanticValue,
    })),
  };
}

export function buildInterpretationRequestV1(options: {
  state: CurrentShoppingState;
  sourceInputId: unknown;
  source: ResolvedShoppingInputV1;
}) {
  return interpretShoppingInputRequestV1Schema.parse({
    schemaVersion: 1,
    sourceInputId: taskInputIdSchema.parse(options.sourceInputId),
    source: resolvedShoppingInputV1Schema.parse(options.source),
    ...authoritativeContext(options.state),
  });
}

export function buildContextActionRequestV1(options: {
  state: CurrentShoppingState;
  sourceInputId: unknown;
  source: ResolvedShoppingInputV1;
  capabilities: { canSearch: boolean; canShowRefine: boolean };
}) {
  const state = currentShoppingStateSchema.parse(options.state);
  const brief = projectShoppingBrief(state);
  return selectContextActionRequestV1Schema.parse({
    schemaVersion: 1,
    sourceInputId: taskInputIdSchema.parse(options.sourceInputId),
    source: resolvedShoppingInputV1Schema.parse(options.source),
    ...authoritativeContext(state),
    brief: { schemaVersion: 1, items: brief.items },
    capabilities: options.capabilities,
  });
}
