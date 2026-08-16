import { createDatabaseConnection } from "../../src/infrastructure/database/clients";

export type TestDatabaseConnection = ReturnType<
  typeof createTestDatabaseConnection
>;

export function createTestDatabaseConnection() {
  const url = process.env.V0_03_TEST_DATABASE_URL;
  if (url === undefined) {
    throw new Error("Database global setup did not provide a disposable URL");
  }
  return createDatabaseConnection({ url, maxConnections: 2, prepare: false });
}

export async function resetShoppingState(
  connection: ReturnType<typeof createTestDatabaseConnection>,
) {
  const url = process.env.V0_03_TEST_DATABASE_URL;
  if (
    url === undefined ||
    !/^ai_shopping_test_[a-f0-9]{32}$/.test(new URL(url).pathname.slice(1))
  ) {
    throw new Error(
      "Refusing to truncate outside the disposable test database",
    );
  }
  await connection.client.unsafe(`
    TRUNCATE TABLE
      shopping_private.criterion_sources,
      shopping_private.decision_criteria,
      shopping_private.concept_definitions,
      shopping_private.user_messages,
      shopping_private.task_inputs,
      shopping_private.shopping_tasks
    RESTART IDENTITY CASCADE
  `);
}
