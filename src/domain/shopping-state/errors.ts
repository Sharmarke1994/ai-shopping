export class PersistedDataCorruptionError extends Error {
  readonly recordType: string;
  readonly recordId: string;

  constructor(options: {
    recordType: string;
    recordId: string;
    cause: unknown;
  }) {
    super(
      `Persisted ${options.recordType} ${options.recordId} failed domain validation`,
      { cause: options.cause },
    );
    this.name = "PersistedDataCorruptionError";
    this.recordType = options.recordType;
    this.recordId = options.recordId;
  }
}

export class CandidateIdentityNotAvailableError extends Error {
  constructor() {
    super(
      "Comparison criteria cannot be persisted until task-scoped candidate identity exists",
    );
    this.name = "CandidateIdentityNotAvailableError";
  }
}

export class IdempotencyConflictError extends Error {
  readonly clientActionId: string;

  constructor(clientActionId: string) {
    super(
      `Client action ${clientActionId} was already used for a different request`,
    );
    this.name = "IdempotencyConflictError";
    this.clientActionId = clientActionId;
  }
}

export class CriterionCompatibilityError extends Error {
  readonly reason:
    | "categorical_strength"
    | "concept_family"
    | "currency"
    | "indifference"
    | "market_scope"
    | "reference_scope"
    | "target_semantics"
    | "unit_dimension";

  constructor(reason: CriterionCompatibilityError["reason"], message: string) {
    super(message);
    this.name = "CriterionCompatibilityError";
    this.reason = reason;
  }
}

export class ProvenanceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProvenanceValidationError";
  }
}

export class TaskRevisionBoundsError extends Error {
  readonly taskId: string;
  readonly attemptedRevision: bigint;
  readonly currentRevision: bigint;

  constructor(options: {
    taskId: string;
    attemptedRevision: bigint;
    currentRevision: bigint;
  }) {
    super(
      `Revision ${options.attemptedRevision} exceeds task ${options.taskId} revision ${options.currentRevision}`,
    );
    this.name = "TaskRevisionBoundsError";
    this.taskId = options.taskId;
    this.attemptedRevision = options.attemptedRevision;
    this.currentRevision = options.currentRevision;
  }
}

export class SourceInputMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceInputMismatchError";
  }
}

export class TaskNotFoundError extends Error {
  constructor(readonly taskId: string) {
    super(`Shopping task ${taskId} was not found`);
    this.name = "TaskNotFoundError";
  }
}

export class StaleTaskRevisionError extends Error {
  constructor(
    readonly taskId: string,
    readonly expectedRevision: bigint,
    readonly actualRevision: bigint,
  ) {
    super(
      `Shopping task ${taskId} is at revision ${actualRevision}; expected ${expectedRevision}`,
    );
    this.name = "StaleTaskRevisionError";
  }
}

export class StateApplicationIdempotencyConflictError extends Error {
  constructor(readonly sourceInputId: string) {
    super(
      `Task input ${sourceInputId} was already applied with different content`,
    );
    this.name = "StateApplicationIdempotencyConflictError";
  }
}

export class SourceInputNotFoundError extends Error {
  constructor(readonly inputId: string) {
    super(`Source input ${inputId} was not found`);
    this.name = "SourceInputNotFoundError";
  }
}

export class SourceInputTaskMismatchError extends Error {
  constructor(readonly inputId: string) {
    super(`Source input ${inputId} does not belong to the shopping task`);
    this.name = "SourceInputTaskMismatchError";
  }
}

export class SourceRevisionNotAdmissibleError extends Error {
  constructor(readonly inputId: string) {
    super(
      `Source input ${inputId} was received after the interpreted revision`,
    );
    this.name = "SourceRevisionNotAdmissibleError";
  }
}

export class ConceptNotFoundError extends Error {
  constructor(readonly conceptId: string) {
    super(`Concept ${conceptId} was not found`);
    this.name = "ConceptNotFoundError";
  }
}

export class ConceptTaskMismatchError extends Error {
  constructor(readonly conceptId: string) {
    super(`Concept ${conceptId} does not belong to the shopping task`);
    this.name = "ConceptTaskMismatchError";
  }
}

export class CriterionNotFoundError extends Error {
  constructor(readonly criterionId: string) {
    super(`Criterion ${criterionId} was not found`);
    this.name = "CriterionNotFoundError";
  }
}

export class CriterionTaskMismatchError extends Error {
  constructor(readonly criterionId: string) {
    super(`Criterion ${criterionId} does not belong to the shopping task`);
    this.name = "CriterionTaskMismatchError";
  }
}

export class CriterionNotActiveError extends Error {
  constructor(readonly criterionId: string) {
    super(`Criterion ${criterionId} is not active`);
    this.name = "CriterionNotActiveError";
  }
}

export class InvalidPatchReferenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidPatchReferenceError";
  }
}

export class DuplicateLineageOperationError extends Error {
  constructor(readonly lineageId: string) {
    super(`Patch attempts to change lineage ${lineageId} more than once`);
    this.name = "DuplicateLineageOperationError";
  }
}

export class ContradictoryTransitionIntentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContradictoryTransitionIntentError";
  }
}

export class IndifferenceConflictError extends Error {
  constructor(readonly conceptId: string) {
    super(
      `Indifference conflicts with active criteria for concept ${conceptId}`,
    );
    this.name = "IndifferenceConflictError";
  }
}

export class LifecycleTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LifecycleTransitionError";
  }
}

export class LineageHistoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LineageHistoryError";
  }
}

export class UndoTargetUnavailableError extends Error {
  constructor(
    readonly applicationId: string,
    message: string,
  ) {
    super(message);
    this.name = "UndoTargetUnavailableError";
  }
}
