import { createDatabaseConnection } from "../../src/infrastructure/database/clients";

export type TestDatabaseConnection = ReturnType<
  typeof createTestDatabaseConnection
>;

export function createTestDatabaseConnection(applicationName?: string) {
  const url = process.env.V0_03_TEST_DATABASE_URL;
  if (url === undefined) {
    throw new Error("Database global setup did not provide a disposable URL");
  }
  const connectionUrl = new URL(url);
  if (applicationName !== undefined) {
    connectionUrl.searchParams.set("application_name", applicationName);
  }
  return createDatabaseConnection({
    url: connectionUrl.toString(),
    maxConnections: applicationName === undefined ? 2 : 1,
    prepare: false,
  });
}

export async function waitForDatabaseLock(options: {
  observer: TestDatabaseConnection;
  applicationNames: readonly string[];
}) {
  const expected = new Set(options.applicationNames);
  for (let attempt = 0; attempt < 250; attempt += 1) {
    const rows = await options.observer.client<
      { application_name: string; wait_event_type: string | null }[]
    >`
      SELECT application_name, wait_event_type
      FROM pg_stat_activity
      WHERE application_name = ANY(${options.observer.client.array([...expected])})
    `;
    if (
      rows.length === expected.size &&
      rows.every(
        (row) =>
          expected.has(row.application_name) && row.wait_event_type === "Lock",
      )
    ) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(
    `Timed out waiting for database locks: ${[...expected].join(", ")}`,
  );
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
      shopping_private.state_change_applications,
      shopping_private.criterion_sources,
      shopping_private.decision_criteria,
      shopping_private.concept_definitions,
      shopping_private.user_messages,
      shopping_private.task_inputs,
      shopping_private.shopping_tasks
    RESTART IDENTITY CASCADE
  `);
}
