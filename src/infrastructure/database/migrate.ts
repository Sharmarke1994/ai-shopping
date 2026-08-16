import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

export async function migrateDatabase(options: {
  url: string;
  migrationsFolder?: string;
}) {
  const client = postgres(options.url, {
    max: 1,
    onnotice: () => undefined,
    prepare: false,
  });
  const db = drizzle(client);

  try {
    await migrate(db, {
      migrationsFolder: options.migrationsFolder ?? "drizzle",
      migrationsSchema: "drizzle",
      migrationsTable: "migrations",
    });
  } finally {
    await client.end({ timeout: 5 });
  }
}
