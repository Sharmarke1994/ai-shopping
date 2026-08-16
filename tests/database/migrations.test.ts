import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrateDatabase } from "../../src/infrastructure/database/migrate";
import {
  createTestDatabaseConnection,
  type TestDatabaseConnection,
} from "./helpers";

describe("V0-03 migration shape", () => {
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
      "concept_definitions",
      "criterion_sources",
      "decision_criteria",
      "shopping_tasks",
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
    expect(before).toBe(2);
    expect(after).toBe(before);
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

  it("does not expose the private schema to client roles", async () => {
    const [privileges] = await connection.client.unsafe<
      {
        anon_schema: boolean;
        anon_table: boolean;
        authenticated_schema: boolean;
        authenticated_table: boolean;
      }[]
    >(`
      select
        has_schema_privilege('anon', 'shopping_private', 'USAGE') as anon_schema,
        has_table_privilege('anon', 'shopping_private.shopping_tasks', 'SELECT') as anon_table,
        has_schema_privilege('authenticated', 'shopping_private', 'USAGE') as authenticated_schema,
        has_table_privilege('authenticated', 'shopping_private.shopping_tasks', 'SELECT') as authenticated_table
    `);
    expect(privileges).toEqual({
      anon_schema: false,
      anon_table: false,
      authenticated_schema: false,
      authenticated_table: false,
    });
  });

  it("contains no premature product or candidate persistence", async () => {
    const rows = await connection.client.unsafe<{ table_name: string }[]>(`
      select table_name
      from information_schema.tables
      where table_schema = 'shopping_private'
        and table_name ~ '(product|candidate|search|observation|assessment|judgement)'
    `);
    expect(rows).toEqual([]);
  });
});
