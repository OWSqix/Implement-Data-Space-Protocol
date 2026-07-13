export class RuntimeError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "RuntimeError";
    this.code = code;
    this.details = details;
  }
}

export function assertRuntime(condition, code, message, details) {
  if (!condition) throw new RuntimeError(code, message, details);
}
