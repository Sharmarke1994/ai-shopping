import "server-only";
import {
  createRuntimeDatabaseConnection,
  type DatabaseConnection,
} from "@/infrastructure/database/clients";
import {
  createLocalSpaceAssetStorage,
  type SpaceAssetStorage,
} from "./asset-storage";
import type { SpaceDependencies } from "./application";
import { SpaceError } from "./domain";
import { fictionalBedroomUnderstanding } from "./understanding";
import { createOpenAISpaceRenderer } from "./visual-renderer";
import type { VisualDependencies } from "./visual-application";

declare global {
  var __considerSpacesDatabase: DatabaseConnection | undefined;
}
export function createSpaceDependencies(): SpaceDependencies {
  const connection = (globalThis.__considerSpacesDatabase ??=
    createRuntimeDatabaseConnection());
  const directory = process.env.CONSIDER_SPACE_ASSET_DIR;
  const unavailable = async (): Promise<never> => {
    throw new SpaceError(
      "storage_unavailable",
      "Photo storage is not configured. Room facts and design are still available.",
      503,
    );
  };
  const storage: SpaceAssetStorage = directory
    ? createLocalSpaceAssetStorage(directory)
    : { put: unavailable, read: unavailable };
  const database = new URL(process.env.DATABASE_URL!);
  const fixtureMode =
    process.env.CONSIDER_SPACE_FIXTURE_MODE === "1" &&
    ["localhost", "127.0.0.1"].includes(database.hostname) &&
    /(?:^|[_-])test(?:[_-]|$)/.test(database.pathname.slice(1));
  return {
    db: connection.db,
    storage,
    fixtureMode,
    ...(fixtureMode ? { understanding: fictionalBedroomUnderstanding() } : {}),
  };
}

export function createVisualDependencies(): VisualDependencies {
  const deps = createSpaceDependencies();
  const key = process.env.OPENAI_API_KEY;
  // Presence of a key alone is not consent to upload room photographs or spend.
  return {
    ...deps,
    ...(process.env.CONSIDER_SPACE_RENDER_ENABLED === "1" &&
    key &&
    process.env.LIVE_SHOPPING_TEST_MODE !== "fixture" &&
    !deps.fixtureMode
      ? { renderer: createOpenAISpaceRenderer(key) }
      : {}),
  };
}
