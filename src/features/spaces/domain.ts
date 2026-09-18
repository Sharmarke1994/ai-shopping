import { randomUUID } from "node:crypto";
import {
  roomStateSchema,
  type RoomState,
  type SpaceOperation,
} from "./contracts";

export class SpaceError extends Error {
  constructor(
    public code:
      | "not_found"
      | "stale_revision"
      | "invalid_request"
      | "asset_limit"
      | "analysis_unavailable"
      | "storage_unavailable",
    message: string,
    public status: number = 400,
  ) {
    super(message);
  }
}
export function assertRevision(current: number, expected: number) {
  if (current !== expected)
    throw new SpaceError(
      "stale_revision",
      "This room changed in another tab. Reload the latest room before saving again.",
      409,
    );
}
export function applySpaceOperation(
  current: RoomState,
  operation: Exclude<SpaceOperation, { operation: "analyse_photos" }>,
): RoomState {
  const state = structuredClone(roomStateSchema.parse(current));
  switch (operation.operation) {
    case "set_design":
      state.design = operation.design;
      break;
    case "add_fact": {
      const fact = {
        id: randomUUID(),
        kind: operation.kind,
        label: operation.label,
        value: operation.value,
        basis: "user_explicit" as const,
        origin: "user" as const,
        status: "confirmed" as const,
        sourceAssetIds: [],
      };
      state.facts.push(fact);
      if (fact.kind === "existing_item")
        state.items.push({
          id: randomUUID(),
          factId: fact.id,
          label: fact.value.length <= 120 ? fact.value : fact.label,
          intent: "undecided",
        });
      break;
    }
    case "confirm_fact":
    case "correct_fact":
    case "reject_fact": {
      const index = state.facts.findIndex(
        (f) => f.id === operation.factId && f.status !== "rejected",
      );
      if (index === -1)
        throw new SpaceError(
          "not_found",
          "That observation is no longer available.",
          404,
        );
      const fact = state.facts[index];
      if (!fact)
        throw new SpaceError("not_found", "Observation not found.", 404);
      if (operation.operation === "reject_fact") {
        if (fact.basis !== "visual_observation")
          throw new SpaceError(
            "invalid_request",
            "Only a photo proposal can be dismissed.",
          );
        state.facts[index] = { ...fact, status: "rejected" };
      } else {
        const confirmed = {
          ...fact,
          value:
            operation.operation === "correct_fact"
              ? operation.value
              : fact.value,
          basis: "user_confirmed" as const,
          status: "confirmed" as const,
        };
        state.facts[index] = confirmed;
        if (fact.kind === "existing_item") {
          const item = state.items.find((i) => i.factId === fact.id);
          const itemLabel =
            confirmed.value.length <= 120 ? confirmed.value : confirmed.label;
          if (item) item.label = itemLabel;
          else
            state.items.push({
              id: randomUUID(),
              factId: fact.id,
              label: itemLabel,
              intent: "undecided",
            });
        }
      }
      break;
    }
    case "add_measurement": {
      const m = operation.measurement;
      state.measurements.push({
        ...m,
        id: randomUUID(),
        basis: "user_measured",
        millimetres: Math.round(m.amount * { mm: 1, cm: 10, m: 1000 }[m.unit]),
      });
      break;
    }
    case "remove_measurement": {
      if (!state.measurements.some((m) => m.id === operation.measurementId))
        throw new SpaceError("not_found", "Measurement not found.", 404);
      state.measurements = state.measurements.filter(
        (m) => m.id !== operation.measurementId,
      );
      break;
    }
    case "add_item":
      state.items.push({
        id: randomUUID(),
        factId: null,
        label: operation.label,
        intent: "undecided",
      });
      break;
    case "set_item_intent": {
      const item = state.items.find((i) => i.id === operation.itemId);
      if (!item) throw new SpaceError("not_found", "Room item not found.", 404);
      item.intent = operation.intent;
      break;
    }
    case "add_unknown":
      state.unknowns.push({
        id: randomUUID(),
        label: operation.label,
        basis: "user_explicit",
        origin: "user",
        sourceAssetIds: [],
      });
      break;
    case "remove_unknown":
      state.unknowns = state.unknowns.filter(
        (u) => u.id !== operation.unknownId,
      );
      break;
  }
  return roomStateSchema.parse(state);
}
