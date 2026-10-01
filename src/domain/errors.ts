/** Domain-level errors. Infrastructure/UI translate these into user-facing text. */
export type DomainErrorCode =
  | 'validation_failed'
  | 'not_found'
  | 'conflict'
  | 'invalid_state_transition'
  | 'ai_unavailable'
  | 'ai_timeout'
  | 'unsupported_language';

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: DomainErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.details = details;
  }
}

export const notFound = (what: string, id?: string): DomainError =>
  new DomainError('not_found', `${what} not found`, id ? { id } : undefined);

export const invalidTransition = (from: string, to: string): DomainError =>
  new DomainError('invalid_state_transition', `Cannot move from "${from}" to "${to}"`, {
    from,
    to,
  });

export const validationFailed = (
  message: string,
  details?: Record<string, unknown>,
): DomainError => new DomainError('validation_failed', message, details);
