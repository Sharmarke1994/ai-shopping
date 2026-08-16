import { eq } from "drizzle-orm";
import {
  DEFAULT_MARKET_CONTEXT,
  marketContextSchema,
  type MarketContext,
} from "../../../domain/shopping-state/market-context";
import { shoppingTaskIdSchema } from "../../../domain/shopping-state/ids";
import type { ShoppingDatabaseExecutor } from "../../../infrastructure/database/clients";
import { shoppingTasks } from "../../../infrastructure/database/schema";
import { mapShoppingTask } from "./mappers";

export async function createShoppingTask(
  executor: ShoppingDatabaseExecutor,
  marketInput: MarketContext = DEFAULT_MARKET_CONTEXT,
) {
  const market = marketContextSchema.parse(marketInput);
  const [row] = await executor
    .insert(shoppingTasks)
    .values({
      marketCountry: market.country,
      languageTag: market.language,
      currencyCode: market.currency,
    })
    .returning();

  if (row === undefined) {
    throw new Error("Shopping task insert returned no row");
  }
  return mapShoppingTask(row);
}

export async function findShoppingTask(
  executor: ShoppingDatabaseExecutor,
  taskIdInput: unknown,
) {
  const taskId = shoppingTaskIdSchema.parse(taskIdInput);
  const [row] = await executor
    .select()
    .from(shoppingTasks)
    .where(eq(shoppingTasks.id, taskId))
    .limit(1);
  return row === undefined ? null : mapShoppingTask(row);
}
