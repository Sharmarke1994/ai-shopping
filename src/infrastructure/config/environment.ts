import { z } from "zod";

const requiredSecret = z.string().trim().min(1);

const openAIEnvironmentSchema = z.object({
  OPENAI_API_KEY: requiredSecret,
});

const databaseEnvironmentSchema = z.object({
  DATABASE_URL: z.url(),
});

const searchEnvironmentSchema = z.object({
  SERP_PROVIDER: z.enum(["serpapi", "serper"]),
  SERP_API_KEY: requiredSecret,
});

export type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

export function requireOpenAIEnvironment(environment: RuntimeEnvironment) {
  return openAIEnvironmentSchema.parse(environment);
}

export function requireDatabaseEnvironment(environment: RuntimeEnvironment) {
  return databaseEnvironmentSchema.parse(environment);
}

export function requireSearchEnvironment(environment: RuntimeEnvironment) {
  return searchEnvironmentSchema.parse(environment);
}
