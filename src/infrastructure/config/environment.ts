import { z } from "zod";

const requiredSecret = z.string().trim().min(1);

const openAIEnvironmentSchema = z.object({
  OPENAI_API_KEY: requiredSecret,
});

const postgresUrl = z
  .url()
  .refine(
    (value) =>
      value.startsWith("postgresql://") || value.startsWith("postgres://"),
    "Expected a PostgreSQL connection URL",
  );

const databaseEnvironmentSchema = z.object({
  DATABASE_URL: postgresUrl,
});

const migrationEnvironmentSchema = z.object({
  DIRECT_DATABASE_URL: postgresUrl,
});

const testDatabaseEnvironmentSchema = z
  .object({
    TEST_DATABASE_URL: postgresUrl,
  })
  .superRefine((environment, context) => {
    const databaseName = new URL(environment.TEST_DATABASE_URL).pathname
      .slice(1)
      .toLowerCase();
    if (!/(?:^|[_-])test(?:[_-]|$)/.test(databaseName)) {
      context.addIssue({
        code: "custom",
        message: "TEST_DATABASE_URL must name a clearly test-only database",
        path: ["TEST_DATABASE_URL"],
      });
    }
  });

export type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

export function requireOpenAIEnvironment(environment: RuntimeEnvironment) {
  return openAIEnvironmentSchema.parse(environment);
}

export function requireDatabaseEnvironment(environment: RuntimeEnvironment) {
  return databaseEnvironmentSchema.parse(environment);
}

export function requireMigrationEnvironment(environment: RuntimeEnvironment) {
  return migrationEnvironmentSchema.parse(environment);
}

export function requireTestDatabaseEnvironment(
  environment: RuntimeEnvironment,
) {
  return testDatabaseEnvironmentSchema.parse(environment);
}
