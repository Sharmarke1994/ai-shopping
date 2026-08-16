import { requireMigrationEnvironment } from "../src/infrastructure/config/environment";
import { migrateDatabase } from "../src/infrastructure/database/migrate";

async function main() {
  const { DIRECT_DATABASE_URL } = requireMigrationEnvironment(process.env);
  await migrateDatabase({ url: DIRECT_DATABASE_URL });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Migration failed";
  console.error(message);
  process.exitCode = 1;
});
