export class CaaSError extends Error {
  constructor(code, message, { status = 500, details } = {}) {
    super(message);
    this.name = "CaaSError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function assertCaas(condition, code, message, options) {
  if (!condition) throw new CaaSError(code, message, options);
}
