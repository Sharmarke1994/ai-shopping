import { foreignKey, primaryKey, timestamp, uuid } from "drizzle-orm/pg-core";
import { candidateListings } from "./candidate-listings";
import { shoppingPrivate } from "./shopping-private";

export const rejectedCandidateListings = shoppingPrivate.table(
  "rejected_candidate_listings",
  {
    taskId: uuid("task_id").notNull(),
    candidateListingId: uuid("candidate_listing_id").notNull(),
    rejectedAt: timestamp("rejected_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "rejected_candidate_listings_pk",
      columns: [table.taskId, table.candidateListingId],
    }),
    foreignKey({
      name: "rejected_candidate_listings_candidate_fk",
      columns: [table.taskId, table.candidateListingId],
      foreignColumns: [candidateListings.taskId, candidateListings.id],
    }).onDelete("restrict"),
  ],
);
