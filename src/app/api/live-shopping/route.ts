import { ZodError } from "zod";
import { StaleRetrievalSearchActionError } from "@/features/retrieval-spike/context-from-persisted-state";
import { StaleSearchRunAuthorityError } from "@/features/retrieval-spike/retrieval-orchestrator";
import {
  answerLiveShoppingQuestion,
  LiveShoppingQuestionUnavailableError,
  LiveShoppingRetryConflictError,
  LiveShoppingSearchUnavailableError,
  LiveShoppingSessionNotFoundError,
  loadLiveShoppingSession,
  refineLiveShopping,
  resumeLiveShoppingSearch,
  retryLiveShoppingContext,
  setLiveListingSaved,
  startLiveShopping,
} from "@/features/live-shopping/application";
import {
  liveSessionIdSchema,
  liveShoppingErrorSchema,
  liveShoppingMutationSchema,
} from "@/features/live-shopping/contracts";
import {
  createLiveShoppingDatabase,
  createLiveShoppingDependencies,
} from "@/features/live-shopping/runtime";
import { SavedListingNotAvailableError } from "@/features/live-shopping/saved-listings";

export const runtime = "nodejs";

const noStoreHeaders = { "Cache-Control": "no-store" };

function response(body: unknown, status = 200) {
  return Response.json(body, { status, headers: noStoreHeaders });
}

function safeError(error: unknown) {
  if (error instanceof ZodError) {
    return response(
      liveShoppingErrorSchema.parse({
        error: {
          code: "invalid_request",
          message: "That shopping request is not valid.",
        },
      }),
      400,
    );
  }
  if (error instanceof LiveShoppingSessionNotFoundError) {
    return response(
      { error: { code: "session_not_found", message: error.message } },
      404,
    );
  }
  if (error instanceof SavedListingNotAvailableError) {
    return response(
      { error: { code: "listing_not_available", message: error.message } },
      404,
    );
  }
  if (error instanceof LiveShoppingRetryConflictError) {
    return response(
      { error: { code: "retry_conflict", message: error.message } },
      409,
    );
  }
  if (
    error instanceof LiveShoppingQuestionUnavailableError ||
    error instanceof LiveShoppingSearchUnavailableError
  ) {
    return response(
      { error: { code: "operation_unavailable", message: error.message } },
      409,
    );
  }
  if (
    error instanceof StaleRetrievalSearchActionError ||
    error instanceof StaleSearchRunAuthorityError
  ) {
    return response(
      {
        error: {
          code: "stale_authority",
          message:
            "The shopping brief changed before this search could continue. Start a fresh task.",
        },
      },
      409,
    );
  }
  return response(
    {
      error: {
        code: "service_unavailable",
        message:
          "Shopping is temporarily unavailable. Your saved task is safe to retry.",
      },
    },
    503,
  );
}

export async function GET(request: Request) {
  try {
    const sessionId = liveSessionIdSchema.parse(
      new URL(request.url).searchParams.get("session"),
    );
    const connection = createLiveShoppingDatabase();
    return response(
      await loadLiveShoppingSession({ db: connection.db, sessionId }),
    );
  } catch (error) {
    return safeError(error);
  }
}

export async function POST(request: Request) {
  try {
    const input = liveShoppingMutationSchema.parse(await request.json());
    switch (input.operation) {
      case "start": {
        const dependencies = await createLiveShoppingDependencies();
        return response(await startLiveShopping({ dependencies, input }));
      }
      case "answer": {
        const dependencies = await createLiveShoppingDependencies();
        return response(
          await answerLiveShoppingQuestion({ dependencies, input }),
        );
      }
      case "refine": {
        const dependencies = await createLiveShoppingDependencies();
        return response(await refineLiveShopping({ dependencies, input }));
      }
      case "save_listing":
      case "unsave_listing": {
        const connection = createLiveShoppingDatabase();
        return response(
          await setLiveListingSaved({
            dependencies: { db: connection.db },
            input,
          }),
        );
      }
      case "retry_context": {
        const dependencies = await createLiveShoppingDependencies();
        return response(
          await retryLiveShoppingContext({
            dependencies,
            sessionId: input.sessionId,
          }),
        );
      }
      case "resume_search": {
        const dependencies = await createLiveShoppingDependencies();
        return response(
          await resumeLiveShoppingSearch({
            dependencies,
            sessionId: input.sessionId,
          }),
        );
      }
    }
  } catch (error) {
    return safeError(error);
  }
}
