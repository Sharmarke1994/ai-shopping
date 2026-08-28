import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrateDatabase } from "../../src/infrastructure/database/migrate";
import {
  createTestDatabaseConnection,
  type TestDatabaseConnection,
} from "./helpers";

describe("shopping architecture migration shape", () => {
  let connection: TestDatabaseConnection;

  beforeAll(() => {
    connection = createTestDatabaseConnection();
  });

  afterAll(async () => {
    await connection.close();
  });

  it("runs from empty on the project-compatible PostgreSQL major", async () => {
    const [version] = await connection.client.unsafe<
      { server_version: string }[]
    >("show server_version");
    expect(version?.server_version).toMatch(/^17\.6(?:[.\s]|$)/);

    const tables = await connection.client.unsafe<{ table_name: string }[]>(`
      select table_name
      from information_schema.tables
      where table_schema = 'shopping_private'
      order by table_name
    `);
    expect(tables.map((row) => row.table_name)).toEqual([
      "candidate_listings",
      "concept_definitions",
      "context_acquisition_attempts",
      "context_action_answers",
      "context_actions",
      "context_question_options",
      "criterion_assessment_observations",
      "criterion_assessments",
      "criterion_sources",
      "decision_criteria",
      "evidence_acquisition_attempts",
      "evidence_research_runs",
      "evidence_sources",
      "founder_live_sessions",
      "product_observations",
      "saved_candidate_listings",
      "search_hypotheses",
      "search_hypothesis_basis_criteria",
      "search_queries",
      "search_query_executions",
      "search_runs",
      "shopping_task_subjects",
      "shopping_tasks",
      "state_change_applications",
      "task_inputs",
      "user_messages",
    ]);
  });

  it("has no pending committed migration after a second migration pass", async () => {
    const url = process.env.V0_03_TEST_DATABASE_URL;
    if (url === undefined) throw new Error("Missing disposable database URL");

    const beforeRows = await connection.client.unsafe<{ count: number }[]>(
      'select count(*)::integer as count from "drizzle"."migrations"',
    );
    const before = beforeRows[0]?.count;
    await migrateDatabase({ url });
    const afterRows = await connection.client.unsafe<{ count: number }[]>(
      'select count(*)::integer as count from "drizzle"."migrations"',
    );
    const after = afterRows[0]?.count;
    expect(before).toBe(15);
    expect(after).toBe(before);
  });

  it("keeps receipts task-scoped, causal, and uniquely undoable", async () => {
    const constraints = await connection.client.unsafe<
      { conname: string; definition: string }[]
    >(`
      select conname, pg_get_constraintdef(oid) as definition
      from pg_constraint
      where conname in (
        'state_change_applications_source_input_fk',
        'state_change_applications_undo_target_fk',
        'state_change_applications_task_source_unique'
      )
      order by conname
    `);
    expect(constraints).toHaveLength(3);
    expect(constraints.map((row) => row.definition).join(" ")).toContain(
      "FOREIGN KEY (task_id, source_task_input_id)",
    );
    expect(constraints.map((row) => row.definition).join(" ")).toContain(
      "FOREIGN KEY (task_id, undoes_application_id)",
    );

    const [undoIndex] = await connection.client.unsafe<
      { index_definition: string }[]
    >(`
      select pg_get_indexdef(indexrelid) as index_definition
      from pg_index
      join pg_class on pg_class.oid = indexrelid
      where pg_class.relname = 'state_change_applications_one_undo_per_target'
    `);
    expect(undoIndex?.index_definition).toContain(
      "WHERE (undoes_application_id IS NOT NULL)",
    );
  });

  it("keeps successor ownership deferred across task, lineage, and concept", async () => {
    const [constraint] = await connection.client.unsafe<
      {
        condeferred: boolean;
        condeferrable: boolean;
        definition: string;
      }[]
    >(`
      select
        condeferrable,
        condeferred,
        pg_get_constraintdef(oid) as definition
      from pg_constraint
      where conname = 'decision_criteria_successor_fk'
    `);
    expect(constraint).toMatchObject({
      condeferrable: true,
      condeferred: true,
    });
    expect(constraint?.definition).toContain(
      "FOREIGN KEY (task_id, lineage_id, concept_id, superseded_by_id)",
    );
  });

  it("keeps exact message provenance and one active lineage structural", async () => {
    const constraints = await connection.client.unsafe<
      { conname: string; definition: string }[]
    >(`
      select conname, pg_get_constraintdef(oid) as definition
      from pg_constraint
      where conname in (
        'criterion_sources_exact_message_fk',
        'user_messages_exact_source_unique'
      )
      order by conname
    `);
    expect(constraints).toHaveLength(2);
    expect(constraints[0]?.definition).toContain(
      "(task_id, task_input_id, message_id)",
    );

    const [activeIndex] = await connection.client.unsafe<
      { index_definition: string }[]
    >(`
      select pg_get_indexdef(indexrelid) as index_definition
      from pg_index
      join pg_class on pg_class.oid = indexrelid
      where pg_class.relname = 'decision_criteria_one_active_lineage'
    `);
    expect(activeIndex?.index_definition).toContain(
      "WHERE (lifecycle = 'active'::text)",
    );
  });

  it("binds immutable subjects and one leased run to each SEARCH action", async () => {
    const constraints = await connection.client.unsafe<
      { conname: string; definition: string }[]
    >(`
      select conname, pg_get_constraintdef(oid) as definition
      from pg_constraint
      where conname in (
        'shopping_task_subjects_exact_message_fk',
        'search_runs_task_context_action_unique',
        'search_runs_lease_shape'
      )
      order by conname
    `);
    expect(constraints).toHaveLength(3);
    const definitions = constraints.map((row) => row.definition).join(" ");
    expect(definitions).toContain(
      "FOREIGN KEY (task_id, task_input_id, user_message_id)",
    );
    expect(definitions).toContain("UNIQUE (task_id, context_action_id)");
    expect(definitions).toContain("lease_token IS NULL");
    expect(definitions).toContain("status = 'running'::text");
  });

  it("does not expose the private schema to client roles", async () => {
    const [privileges] = await connection.client.unsafe<
      {
        anon_schema: boolean;
        anon_table: boolean;
        anon_subject_table: boolean;
        anon_live_session_table: boolean;
        anon_saved_table: boolean;
        authenticated_schema: boolean;
        authenticated_table: boolean;
        authenticated_subject_table: boolean;
        authenticated_live_session_table: boolean;
        authenticated_saved_table: boolean;
      }[]
    >(`
      select
        has_schema_privilege('anon', 'shopping_private', 'USAGE') as anon_schema,
        has_table_privilege('anon', 'shopping_private.candidate_listings', 'SELECT') as anon_table,
        has_table_privilege('anon', 'shopping_private.shopping_task_subjects', 'SELECT') as anon_subject_table,
        has_table_privilege('anon', 'shopping_private.founder_live_sessions', 'SELECT') as anon_live_session_table,
        has_table_privilege('anon', 'shopping_private.saved_candidate_listings', 'SELECT') as anon_saved_table,
        has_schema_privilege('authenticated', 'shopping_private', 'USAGE') as authenticated_schema,
        has_table_privilege('authenticated', 'shopping_private.search_runs', 'SELECT') as authenticated_table,
        has_table_privilege('authenticated', 'shopping_private.shopping_task_subjects', 'SELECT') as authenticated_subject_table,
        has_table_privilege('authenticated', 'shopping_private.founder_live_sessions', 'SELECT') as authenticated_live_session_table,
        has_table_privilege('authenticated', 'shopping_private.saved_candidate_listings', 'SELECT') as authenticated_saved_table
    `);
    expect(privileges).toEqual({
      anon_schema: false,
      anon_table: false,
      anon_subject_table: false,
      anon_live_session_table: false,
      anon_saved_table: false,
      authenticated_schema: false,
      authenticated_table: false,
      authenticated_subject_table: false,
      authenticated_live_session_table: false,
      authenticated_saved_table: false,
    });
  });

  it("binds every merchant destination to explicit provenance", async () => {
    const [constraint] = await connection.client.unsafe<
      { definition: string }[]
    >(`
      select pg_get_constraintdef(oid) as definition
      from pg_constraint
      where conname = 'candidate_listings_destination_provenance_shape'
    `);
    expect(constraint?.definition).toContain(
      "merchant_destination_source = ANY",
    );
    expect(constraint?.definition).toContain("verified_organic");
    expect(constraint?.definition).toContain(
      "merchant_destination_url IS NOT NULL",
    );
    expect(constraint?.definition).toContain(
      "merchant_destination_source IS NOT NULL",
    );
  });

  it("keeps actions receipt-bound and attempts terminally coherent", async () => {
    const constraints = await connection.client.unsafe<
      { conname: string; definition: string }[]
    >(`
      select conname, pg_get_constraintdef(oid) as definition
      from pg_constraint
      where conname in (
        'context_actions_application_fk',
        'context_actions_task_application_unique',
        'context_acquisition_attempts_terminal_shape',
        'context_acquisition_attempts_run_stage_ordinal_unique'
      )
      order by conname
    `);
    expect(constraints).toHaveLength(4);
    const definitions = constraints.map((row) => row.definition).join(" ");
    expect(definitions).toContain(
      "FOREIGN KEY (task_id, state_change_application_id)",
    );
    expect(definitions).toContain(
      "UNIQUE (orchestration_run_id, stage, attempt_ordinal)",
    );
    expect(definitions).toContain("status = 'completed'::text");
  });

  it("contains no premature product identity, comparative judgement, or reaction persistence", async () => {
    const rows = await connection.client.unsafe<{ table_name: string }[]>(`
      select table_name
      from information_schema.tables
      where table_schema = 'shopping_private'
        and table_name ~ '(product_identity|judgement|reaction)'
    `);
    expect(rows).toEqual([]);
  });
});
