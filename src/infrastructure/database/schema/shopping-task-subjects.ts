import { foreignKey, timestamp, uuid } from "drizzle-orm/pg-core";
import { shoppingPrivate } from "./shopping-private";
import { userMessages } from "./user-messages";

export const shoppingTaskSubjects = shoppingPrivate.table(
  "shopping_task_subjects",
  {
    taskId: uuid("task_id").primaryKey(),
    taskInputId: uuid("task_input_id").notNull(),
    userMessageId: uuid("user_message_id").notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "shopping_task_subjects_exact_message_fk",
      columns: [table.taskId, table.taskInputId, table.userMessageId],
      foreignColumns: [
        userMessages.taskId,
        userMessages.taskInputId,
        userMessages.id,
      ],
    }).onDelete("restrict"),
  ],
);
