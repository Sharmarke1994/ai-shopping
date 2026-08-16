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
