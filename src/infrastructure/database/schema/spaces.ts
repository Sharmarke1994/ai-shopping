import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  integer,
  jsonb,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { shoppingPrivate } from "./shopping-private";
import type { RoomState } from "@/features/spaces/contracts";

export const spaces = shoppingPrivate.table(
  "spaces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    roomType: text("room_type"),
    currentRevision: integer("current_revision").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "spaces_name_bounded",
      sql`length(trim(${t.name})) between 1 and 100`,
    ),
    check("spaces_revision_nonnegative", sql`${t.currentRevision} >= 0`),
    check(
      "spaces_room_type",
      sql`${t.roomType} is null or ${t.roomType} in ('bedroom','living_room','office','kitchen','dining_room','other')`,
    ),
  ],
);
export const spaceAssets = shoppingPrivate.table(
  "space_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => spaces.id),
    storageKey: text("storage_key").notNull(),
    sha256: text("sha256").notNull(),
    contentType: text("content_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    filename: text("filename").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("space_assets_identity").on(t.spaceId, t.id),
    unique("space_assets_digest").on(t.spaceId, t.sha256),
    check(
      "space_assets_key",
      sql`${t.storageKey} = ${t.sha256} and ${t.sha256} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      "space_assets_type",
      sql`${t.contentType} in ('image/jpeg','image/png','image/webp')`,
    ),
    check("space_assets_size", sql`${t.byteSize} between 1 and 12582912`),
    check(
      "space_assets_filename",
      sql`length(${t.filename}) between 1 and 100`,
    ),
  ],
);
export const spaceRevisions = shoppingPrivate.table(
  "space_revisions",
  {
    spaceId: uuid("space_id")
      .notNull()
      .references(() => spaces.id),
    revision: integer("revision").notNull(),
    snapshot: jsonb("snapshot").$type<RoomState>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.spaceId, t.revision] }),
    check("space_revisions_nonnegative", sql`${t.revision} >= 0`),
    check(
      "space_revisions_snapshot",
      sql`jsonb_typeof(${t.snapshot}) = 'object' and (${t.snapshot}->>'version') is not null and (${t.snapshot}->>'version') = '1' and octet_length(${t.snapshot}::text) <= 131072`,
    ),
  ],
);
export const spaceRevisionAssets = shoppingPrivate.table(
  "space_revision_assets",
  {
    spaceId: uuid("space_id").notNull(),
    revision: integer("revision").notNull(),
    assetId: uuid("asset_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.spaceId, t.revision, t.assetId] }),
    foreignKey({
      columns: [t.spaceId, t.revision],
      foreignColumns: [spaceRevisions.spaceId, spaceRevisions.revision],
      name: "space_revision_assets_revision_fk",
    }),
    foreignKey({
      columns: [t.spaceId, t.assetId],
      foreignColumns: [spaceAssets.spaceId, spaceAssets.id],
      name: "space_revision_assets_owner_fk",
    }),
  ],
);
