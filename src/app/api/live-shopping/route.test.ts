import { expect, it, vi } from "vitest";
import { StaleTaskRevisionError } from "@/domain/shopping-state/errors";

const runtime = vi.hoisted(() => ({ createLiveShoppingDependencies: vi.fn() }));
vi.mock("@/features/live-shopping/runtime", () => runtime);
import { POST } from "./route";

it("returns a recoverable authority conflict when research races a refinement", async () => {
  runtime.createLiveShoppingDependencies.mockRejectedValueOnce(
    new StaleTaskRevisionError("private-task-id", 1n, 2n),
  );
  const result = await POST(
    new Request("http://localhost/api/live-shopping", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operation: "deepen_research",
        sessionId: "00000000-0000-4000-8000-000000000001",
      }),
    }),
  );
  expect(result.status).toBe(409);
  expect(result.headers.get("Cache-Control")).toBe("no-store");
  const body = await result.json();
  expect(body.error.code).toBe("stale_authority");
  expect(body.error.message).toContain("Refresh");
  expect(body.error.message).not.toContain("private-task-id");
});
