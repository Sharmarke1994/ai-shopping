import type { ExtractTablesWithRelations } from "drizzle-orm";
import {
  drizzle,
  type PostgresJsDatabase,
  type PostgresJsTransaction,
} from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { requireDatabaseEnvironment } from "../config/environment";
import * as schema from "./schema";

export type ShoppingDatabase = PostgresJsDatabase<typeof schema>;
export type ShoppingDatabaseExecutor = Pick<
  ShoppingDatabase,
  "insert" | "select"
>;
export type ShoppingTransaction = PostgresJsTransaction<
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

export type DatabaseConnection = Readonly<{
  client: ReturnType<typeof postgres>;
  db: ShoppingDatabase;
  close: () => Promise<void>;
}>;

export function createDatabaseConnection(options: {
  url: string;
  maxConnections?: number;
  prepare?: boolean;
}): DatabaseConnection {
  const client = postgres(options.url, {
    idle_timeout: 20,
    max: options.maxConnections ?? 5,
    prepare: options.prepare ?? false,
  });

  return {
    client,
    db: drizzle(client, { schema }),
    close: () => client.end({ timeout: 5 }),
  };
}

export function createRuntimeDatabaseConnection(
  environment: Readonly<Record<string, string | undefined>> = process.env,
) {
  const { DATABASE_URL } = requireDatabaseEnvironment(environment);
  return createDatabaseConnection({ url: DATABASE_URL, prepare: false });
}
