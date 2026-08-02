export class ObservabilityError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = "ObservabilityError";
    this.code = code;
    this.status = options.status ?? 500;
  }
}

export function assertObservability(condition, code, message, options) {
  if (!condition) throw new ObservabilityError(code, message, options);
}
