/**
 * Operational error with an HTTP status and a stable machine-readable code.
 * Anything that is not an AppError is treated as an unexpected 500.
 */
export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    if (details !== undefined) this.details = details;
  }

  static badRequest(message, details) {
    return new AppError(400, 'BAD_REQUEST', message, details);
  }
  static validation(details) {
    return new AppError(422, 'VALIDATION_FAILED', 'Some fields need attention.', details);
  }
  static unauthenticated(message = 'Sign in to continue.') {
    return new AppError(401, 'UNAUTHENTICATED', message);
  }
  static forbidden(message = 'You do not have permission to do this.') {
    return new AppError(403, 'FORBIDDEN', message);
  }
  static notFound(what = 'Record') {
    return new AppError(404, 'NOT_FOUND', `${what} not found.`);
  }
  static conflict(message, details) {
    return new AppError(409, 'CONFLICT', message, details);
  }
  static locked(message) {
    return new AppError(423, 'ACCOUNT_LOCKED', message);
  }
}
