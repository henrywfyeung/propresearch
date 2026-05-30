// Error hierarchy — CLAUDE.md §14.2. Every thrown error in the pipeline is
// one of these typed AppErrors so Sentry tagging + per-error-class UX (F2)
// can switch on `.code`.

export class AppError extends Error {
  readonly code: string;
  readonly details?: unknown;
  /** Whether an Inngest step should retry on this error (transient classes). */
  readonly retryable: boolean;

  constructor(
    code: string,
    message: string,
    opts?: { details?: unknown; retryable?: boolean; cause?: unknown },
  ) {
    super(message, opts?.cause ? { cause: opts.cause } : undefined);
    this.name = new.target.name;
    this.code = code;
    this.details = opts?.details;
    this.retryable = opts?.retryable ?? false;
  }
}

/** No address suggestion met the confidence threshold (Node 01). */
export class AddressResolutionError extends AppError {
  constructor(message = 'Could not resolve the address', details?: unknown) {
    super('ADDRESS_UNRESOLVED', message, { details });
  }
}

/** Address is outside the supported region / Phase-1 LGA gate (Node 01). */
export class UnsupportedRegionError extends AppError {
  constructor(message = 'This region is not supported yet', details?: unknown) {
    super('REGION_UNSUPPORTED', message, { details });
  }
}

/** Per-report Domain API call ceiling exceeded (§11.2). */
export class DomainQuotaError extends AppError {
  constructor(message = 'Domain API call ceiling reached for this report', details?: unknown) {
    super('DOMAIN_QUOTA_PER_REPORT', message, { details });
  }
}

/** Per-report RapidAPI call ceiling exceeded (spec §6). */
export class RapidApiQuotaError extends AppError {
  constructor(message = 'RapidAPI call ceiling reached for this report', details?: unknown) {
    super('RAPIDAPI_QUOTA_PER_REPORT', message, { details });
  }
}

/** Per-report LLM cost ceiling exceeded (§11.3). */
export class CostCeilingError extends AppError {
  constructor(message = 'Cost ceiling reached', details?: unknown) {
    super('COST_CEILING', message, { details });
  }
}

/** Per-user daily report cap reached (§11.1). */
export class RateLimitError extends AppError {
  constructor(message = 'Daily report limit reached', details?: unknown) {
    super('RATE_LIMIT', message, { details });
  }
}

/** A non-fatal degradation — logged + tagged for Sentry, report continues (§7.17). */
export class PartialDataError extends AppError {
  constructor(message: string, details?: unknown) {
    super('PARTIAL_DATA', message, { details });
  }
}

/** A Domain (or other external) response failed Zod validation (§8.1). */
export class SchemaDriftError extends AppError {
  constructor(message: string, details?: unknown) {
    super('DOMAIN_SCHEMA_DRIFT', message, { details, retryable: false });
  }
}

/** Both OpenAI and the Anthropic fallback failed (§9.1, [R34]). Retryable. */
export class LlmProvidersUnavailableError extends AppError {
  constructor(message = 'All LLM providers are currently unavailable', details?: unknown) {
    super('LLM_PROVIDERS_UNAVAILABLE', message, { details, retryable: true });
  }
}

/** A compose ClaimBlock's sourceRef.path didn't resolve in state (§7.13, [R22]). */
export class PointerUnresolvedError extends AppError {
  constructor(pointer: string, details?: unknown) {
    super('POINTER_UNRESOLVED', `sourceRef.path did not resolve: ${pointer}`, { details });
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}
