import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  integer,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { shoppingPrivate } from "./shopping-private";
import { shoppingTasks } from "./shopping-tasks";
import { stateChangeApplications } from "./state-change-applications";

export const contextActions = shoppingPrivate.table(
  "context_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id").notNull(),
    stateChangeApplicationId: uuid("state_change_application_id").notNull(),
    selectedAtRevision: bigint("selected_at_revision", {
      mode: "bigint",
    }).notNull(),
    actionSchemaVersion: integer("action_schema_version").notNull(),
    actionKind: text("action_kind").notNull(),
    promptSchemaVersion: integer("prompt_schema_version"),
    questionPrompt: text("question_prompt"),
    responseMode: text("response_mode"),
    expectedImpact: text("expected_impact"),
    whyNow: text("why_now"),
    canSearchWithoutAnswer: boolean("can_search_without_answer"),
    rationale: text("rationale"),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    promptVersion: text("prompt_version").notNull(),
    providerSchemaVersion: integer("provider_schema_version").notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("context_actions_task_id_id_unique").on(table.taskId, table.id),
    unique("context_actions_task_application_unique").on(
      table.taskId,
      table.stateChangeApplicationId,
    ),
    foreignKey({
      name: "context_actions_task_fk",
      columns: [table.taskId],
      foreignColumns: [shoppingTasks.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "context_actions_application_fk",
      columns: [table.taskId, table.stateChangeApplicationId],
      foreignColumns: [
        stateChangeApplications.taskId,
        stateChangeApplications.id,
      ],
    }).onDelete("restrict"),
    check(
      "context_actions_kind_allowed",
      sql`${table.actionKind} in ('ask', 'search', 'show_refine')`,
    ),
    check(
      "context_actions_versions_positive",
      sql`${table.actionSchemaVersion} > 0 and ${table.providerSchemaVersion} > 0 and (${table.promptSchemaVersion} is null or ${table.promptSchemaVersion} > 0)`,
    ),
    check(
      "context_actions_revision_nonnegative",
      sql`${table.selectedAtRevision} >= 0`,
    ),
    check(
      "context_actions_config_text",
      sql`char_length(${table.provider}) between 1 and 120 and char_length(${table.model}) between 1 and 160 and char_length(${table.promptVersion}) between 1 and 120`,
    ),
    check(
      "context_actions_branch_shape",
      sql`(
        ${table.actionKind} = 'ask'
        and ${table.promptSchemaVersion} is not null
        and ${table.questionPrompt} is not null
        and ${table.responseMode} in ('open_text', 'single_select')
        and ${table.expectedImpact} in ('retrieval', 'eligibility', 'judgement')
        and ${table.whyNow} is not null
        and ${table.canSearchWithoutAnswer} is not null
        and ${table.rationale} is null
      ) or (
        ${table.actionKind} in ('search', 'show_refine')
        and ${table.promptSchemaVersion} is null
        and ${table.questionPrompt} is null
        and ${table.responseMode} is null
        and ${table.expectedImpact} is null
        and ${table.whyNow} is null
        and ${table.canSearchWithoutAnswer} is null
        and ${table.rationale} is not null
      )`,
    ),
    check(
      "context_actions_text_bounds",
      sql`(
        (${table.questionPrompt} is null or char_length(btrim(${table.questionPrompt})) between 1 and 500)
        and (${table.whyNow} is null or char_length(btrim(${table.whyNow})) between 1 and 500)
        and (${table.rationale} is null or char_length(btrim(${table.rationale})) between 1 and 500)
      )`,
    ),
  ],
);

export const contextQuestionOptions = shoppingPrivate.table(
  "context_question_options",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id").notNull(),
    contextActionId: uuid("context_action_id").notNull(),
    ordinal: integer("ordinal").notNull(),
    label: text("label").notNull(),
  },
  (table) => [
    unique("context_question_options_task_id_id_unique").on(
      table.taskId,
      table.id,
    ),
    unique("context_question_options_action_ordinal_unique").on(
      table.taskId,
      table.contextActionId,
      table.ordinal,
    ),
    foreignKey({
      name: "context_question_options_action_fk",
      columns: [table.taskId, table.contextActionId],
      foreignColumns: [contextActions.taskId, contextActions.id],
    }).onDelete("restrict"),
    check(
      "context_question_options_ordinal_nonnegative",
      sql`${table.ordinal} >= 0`,
    ),
    check(
      "context_question_options_label_bounds",
      sql`char_length(btrim(${table.label})) between 1 and 160`,
    ),
  ],
);
