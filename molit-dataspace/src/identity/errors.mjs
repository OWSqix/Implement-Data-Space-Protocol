export class IdentityError extends Error {
  constructor(code, message, { status = 401, details, cause } = {}) {
    super(message, { cause });
    this.name = "IdentityError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function assertIdentity(condition, code, message, options) {
  if (!condition) throw new IdentityError(code, message, options);
}

export function unavailable(code, message, cause) {
  return new IdentityError(code, message, { status: 503, cause });
}
