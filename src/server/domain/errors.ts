export type DomainErrorCode = "NOT_FOUND" | "CONFLICT" | "INVALID" | "FORBIDDEN_HOST" | "UPSTREAM";

/** Error esperado de negocio. `message` está escrito para mostrarse tal cual al administrador. */
export class DomainError extends Error {
  constructor(
    public readonly code: DomainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export function isDomainError(err: unknown): err is DomainError {
  return err instanceof DomainError;
}
