/**
 * Raw response bytes accepted transiently by the bounded page transport and
 * extractor. Raw HTML is never retained after extraction.
 */
export const MAX_PAGE_TRANSPORT_BYTES = 2_500_000;

/** Maximum JSON bytes targeted by the extracted evidence document itself. */
export const MAX_PAGE_RETAINED_DOCUMENT_BYTES = 36_000;

/**
 * Database guard for JSONB's normalized textual representation of a retained
 * document. This deliberately leaves a small envelope above the extractor's
 * own limit.
 */
export const MAX_PERSISTED_PAGE_DOCUMENT_JSON_BYTES = 40_000;

/** Database guard for the compact page-admission receipt. */
export const MAX_PERSISTED_PAGE_ADMISSION_JSON_BYTES = 8_000;
