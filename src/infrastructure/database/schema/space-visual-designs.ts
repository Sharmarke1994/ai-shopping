import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  integer,
  jsonb,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { shoppingPrivate } from "./shopping-private";
import { spaceRevisions } from "./spaces";
import type { VisualBasis } from "@/features/spaces/visual-contracts";

export const spaceVisualDesigns = shoppingPrivate.table(
  "space_visual_designs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    spaceId: uuid("space_id").notNull(),
    roomRevision: integer("room_revision").notNull(),
    actionId: uuid("action_id").notNull(),
    requestHash: text("request_hash").notNull(),
    basis: jsonb("basis").$type<VisualBasis>().notNull(),
    status: text("status").notNull().default("draft"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    storageKey: text("storage_key"),
    byteSize: integer("byte_size"),
    failure: text("failure"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("space_visual_action").on(t.spaceId, t.actionId),
    foreignKey({
      columns: [t.spaceId, t.roomRevision],
      foreignColumns: [spaceRevisions.spaceId, spaceRevisions.revision],
      name: "space_visual_basis_fk",
    }),
    check(
      "space_visual_basis_shape",
      sql`jsonb_typeof(${t.basis}) = 'object' and (${t.basis}->>'version') is not null and ${t.basis}->>'version' = '1' and octet_length(${t.basis}::text) <= 196608`,
    ),
    check(
      "space_visual_request_hash",
      sql`${t.requestHash} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      "space_visual_state",
      sql`
    (${t.status} = 'draft' and ${t.startedAt} is null and ${t.finishedAt} is null and ${t.storageKey} is null and ${t.byteSize} is null and ${t.failure} is null) or
    (${t.status} = 'running' and ${t.startedAt} is not null and ${t.finishedAt} is null and ${t.storageKey} is null and ${t.byteSize} is null and ${t.failure} is null) or
    (${t.status} = 'failed' and ${t.startedAt} is not null and ${t.finishedAt} is not null and ${t.storageKey} is null and ${t.byteSize} is null and ${t.failure} is not null and ${t.failure} in ('provider_failed','reference_unavailable')) or
    (${t.status} = 'completed' and ${t.startedAt} is not null and ${t.finishedAt} is not null and ${t.storageKey} is not null and ${t.storageKey} ~ '^[a-f0-9]{64}$' and ${t.byteSize} is not null and ${t.byteSize} between 1 and 12582912 and ${t.failure} is null)
  `,
    ),
  ],
);
