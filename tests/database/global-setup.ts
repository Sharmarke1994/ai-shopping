import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { requireTestDatabaseEnvironment } from "../../src/infrastructure/config/environment";
import { migrateDatabase } from "../../src/infrastructure/database/migrate";

const disposableDatabasePattern = /^ai_shopping_test_[a-f0-9]{32}$/;

function databaseUrlWithName(url: string, databaseName: string) {
  const parsed = new URL(url);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

export default async function setup() {
  const { TEST_DATABASE_URL } = requireTestDatabaseEnvironment(process.env);
  const baseUrl = new URL(TEST_DATABASE_URL);
  const baseDatabaseName = baseUrl.pathname.slice(1);
  const databaseName = `ai_shopping_test_${randomUUID().replaceAll("-", "")}`;
  if (
    !/(?:^|[_-])test(?:[_-]|$)/.test(baseDatabaseName) ||
    !disposableDatabasePattern.test(databaseName)
  ) {
    throw new Error("Refusing to create a database outside the test guard");
  }

  const admin = postgres(TEST_DATABASE_URL, { max: 1, prepare: false });
  const disposableUrl = databaseUrlWithName(TEST_DATABASE_URL, databaseName);

  try {
    await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
    await admin.unsafe(`
      DO $roles$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
          CREATE ROLE anon NOLOGIN;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
          CREATE ROLE authenticated NOLOGIN;
        END IF;
      END
      $roles$
    `);
    await migrateDatabase({ url: disposableUrl });
  } catch (error) {
    await admin.unsafe(
      `DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`,
    );
    await admin.end({ timeout: 5 });
    throw error;
  }

  process.env.V0_03_TEST_DATABASE_URL = disposableUrl;

  return async () => {
    if (!disposableDatabasePattern.test(databaseName)) {
      throw new Error("Refusing to drop a database outside the test guard");
    }
    await admin.unsafe(
      `DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`,
    );
    await admin.end({ timeout: 5 });
  };
}
