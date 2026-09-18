import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  factKindSchema,
  roomStateSchema,
  spaceIdSchema,
  type RoomState,
} from "./contracts";
import type { ImageContentType } from "./asset-storage";

const proposedFact = z
  .object({
    kind: factKindSchema,
    label: z.string().trim().min(1).max(120),
    value: z.string().trim().min(1).max(600),
    sourceAssetIds: z.array(spaceIdSchema).min(1).max(10),
  })
  .strict();
export const spaceUnderstandingOutputSchema = z
  .object({
    facts: z.array(proposedFact).max(20),
    unknowns: z
      .array(
        z
          .object({
            label: z.string().trim().min(1).max(120),
            sourceAssetIds: z.array(spaceIdSchema).min(1).max(10),
          })
          .strict(),
      )
      .max(5),
  })
  .strict();
export interface SpaceUnderstandingModel {
  propose(input: {
    name: string;
    roomType: string | null;
    assets: { id: string; contentType: ImageContentType; bytes: Uint8Array }[];
    confirmedFacts: RoomState["facts"];
    measurements: RoomState["measurements"];
  }): Promise<unknown>;
}
export function appendVisualProposals(
  state: RoomState,
  output: unknown,
  selectedAssetIds: string[],
  origin: "photo_analysis" | "fictional_fixture" = "photo_analysis",
): RoomState {
  const parsed = spaceUnderstandingOutputSchema.parse(output);
  const next = structuredClone(state);
  for (const proposal of [...parsed.facts, ...parsed.unknowns]) {
    if (proposal.sourceAssetIds.some((id) => !selectedAssetIds.includes(id)))
      throw new Error("Proposal references unselected photo");
  }
  for (const fact of parsed.facts) {
    // The model never gets an update operation. Even corrected/rejected concepts
    // stay protected from repeated identical proposals on subsequent analysis.
    if (
      next.facts.some(
        (f) =>
          f.kind === fact.kind &&
          f.label.toLocaleLowerCase("en-GB") ===
            fact.label.toLocaleLowerCase("en-GB"),
      )
    )
      continue;
    next.facts.push({
      ...fact,
      id: randomUUID(),
      basis: "visual_observation",
      origin,
      status: "proposed",
    });
  }
  for (const gap of parsed.unknowns) {
    if (!next.unknowns.some((u) => u.label === gap.label))
      next.unknowns.push({
        ...gap,
        id: randomUUID(),
        basis: "visual_observation",
        origin,
      });
  }
  return roomStateSchema.parse(next);
}

/** Fictional development observations, NOT an interpretation of uploaded bytes. */
export function fictionalBedroomUnderstanding(): SpaceUnderstandingModel {
  return {
    async propose(input) {
      const sourceAssetIds = input.assets.map((a) => a.id);
      return {
        facts: [
          { kind: "existing_item", label: "Bed", value: "King bed" },
          { kind: "existing_item", label: "Desk", value: "Black desk" },
          { kind: "existing_item", label: "Shelving", value: "Open shelving" },
          {
            kind: "architectural_feature",
            label: "Window",
            value: "Large window",
          },
          {
            kind: "material",
            label: "Textiles",
            value: "Beige and cream textiles",
          },
          {
            kind: "layout_observation",
            label: "Desk wall",
            value: "Desk wall appears wide",
          },
        ].map((f) => ({ ...f, sourceAssetIds })),
        unknowns: ["Rug footprint", "Free bedside width"].map((label) => ({
          label,
          sourceAssetIds,
        })),
      };
    },
  };
}
