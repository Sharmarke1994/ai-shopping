import { sql } from "drizzle-orm";
import { bigint, check, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { shoppingPrivate } from "./shopping-private";

export const shoppingTasks = shoppingPrivate.table(
  "shopping_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    currentRevision: bigint("current_revision", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    marketCountry: text("market_country").notNull(),
    languageTag: text("language_tag").notNull(),
    currencyCode: text("currency_code").notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "shopping_tasks_revision_nonnegative",
      sql`${table.currentRevision} >= 0`,
    ),
    check(
      "shopping_tasks_market_country_shape",
      sql`${table.marketCountry} ~ '^[A-Z]{2}$'`,
    ),
    check(
      "shopping_tasks_language_tag_shape",
      sql`${table.languageTag} ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$'`,
    ),
    check(
      "shopping_tasks_currency_code_shape",
      sql`${table.currencyCode} ~ '^[A-Z]{3}$'`,
    ),
    check(
      "shopping_tasks_timestamp_order",
      sql`${table.updatedAt} >= ${table.createdAt}`,
    ),
  ],
);
