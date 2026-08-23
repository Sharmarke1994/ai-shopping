import { projectShoppingBrief } from "@/domain/shopping-state/brief";
import {
  currentShoppingStateSchema,
  type CurrentShoppingState,
} from "@/domain/shopping-state/shopping-state";
import {
  shoppingTaskIdSchema,
  taskInputIdSchema,
} from "@/domain/shopping-state/ids";
import type { ShoppingDatabase } from "@/infrastructure/database/clients";
import {
  resolvedShoppingInputV1Schema,
  type ResolvedShoppingInputV1,
} from "@/features/context-acquisition/contracts";
import { loadContextActionByApplication } from "@/features/context-acquisition/persistence/context-actions";
import { resolveStoredShoppingInput } from "@/features/context-acquisition/persistence/resolved-input";
import { loadCurrentShoppingState } from "@/features/shopping-state/persistence/state-loaders";
import { loadValidatedStateApplicationBySourceInput } from "@/features/shopping-state/persistence/state-transitions";
import { retrievalContextV1Schema, type RetrievalContextV1 } from "./contracts";

export class RetrievalSubjectInputKindError extends Error {
  constructor(readonly inputKind: ResolvedShoppingInputV1["kind"]) {
    super(
      `Retrieval subject must be a persisted shopper message, not ${inputKind}`,
    );
    this.name = "RetrievalSubjectInputKindError";
  }
}

export class RetrievalSourceApplicationNotFoundError extends Error {
  constructor(readonly sourceInputId: string) {
    super(`No validated state application exists for ${sourceInputId}`);
    this.name = "RetrievalSourceApplicationNotFoundError";
  }
}

export class RetrievalActionNotSearchError extends Error {
  constructor(readonly action: "missing" | "ask" | "show_refine") {
    super(`Retrieval requires a persisted SEARCH action, received ${action}`);
    this.name = "RetrievalActionNotSearchError";
  }
}

export class StaleRetrievalSearchActionError extends Error {
  constructor(
    readonly selectedAtRevision: bigint,
    readonly currentRevision: bigint,
  ) {
    super(
      `SEARCH selected at revision ${selectedAtRevision} is stale at revision ${currentRevision}`,
    );
    this.name = "StaleRetrievalSearchActionError";
  }
}

function buildRetrievalContextFromCurrentState(options: {
  state: CurrentShoppingState;
  subjectInputId: unknown;
  subject: ResolvedShoppingInputV1;
  marketVocabulary?: unknown;
}): RetrievalContextV1 {
  const state = currentShoppingStateSchema.parse(options.state);
  const subject = resolvedShoppingInputV1Schema.parse(options.subject);
  if (subject.kind !== "message") {
    throw new RetrievalSubjectInputKindError(subject.kind);
  }
  const subjectInputId = taskInputIdSchema.parse(options.subjectInputId);
  const brief = projectShoppingBrief(state);

  return retrievalContextV1Schema.parse({
    schemaVersion: 1,
    taskId: state.task.id,
    revision: state.task.currentRevision,
    market: state.task.market,
    shoppingSubject: {
      text: subject.body,
      sourceInputId: subjectInputId,
    },
    brief,
    marketVocabulary: options.marketVocabulary ?? [],
  });
}

export async function loadRetrievalContextFromPersistedState(options: {
  db: ShoppingDatabase;
  taskId: unknown;
  subjectInputId: unknown;
  marketVocabulary?: unknown;
}): Promise<RetrievalContextV1> {
  const taskId = shoppingTaskIdSchema.parse(options.taskId);
  const subjectInputId = taskInputIdSchema.parse(options.subjectInputId);
  return options.db.transaction(
    async (tx) => {
      const application = await loadValidatedStateApplicationBySourceInput(
        tx,
        taskId,
        subjectInputId,
      );
      if (application === null) {
        throw new RetrievalSourceApplicationNotFoundError(subjectInputId);
      }
      const state = await loadCurrentShoppingState(tx, taskId);
      const subject = await resolveStoredShoppingInput({
        db: tx,
        taskId,
        inputId: subjectInputId,
      });
      const action = await loadContextActionByApplication({
        db: tx,
        taskId,
        stateChangeApplicationId: application.application.id,
      });
      if (action === null || action.action !== "search") {
        throw new RetrievalActionNotSearchError(action?.action ?? "missing");
      }
      if (action.selectedAtRevision !== state.task.currentRevision) {
        throw new StaleRetrievalSearchActionError(
          action.selectedAtRevision,
          state.task.currentRevision,
        );
      }

      return buildRetrievalContextFromCurrentState({
        state,
        subjectInputId,
        subject,
        ...(options.marketVocabulary === undefined
          ? {}
          : { marketVocabulary: options.marketVocabulary }),
      });
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}
