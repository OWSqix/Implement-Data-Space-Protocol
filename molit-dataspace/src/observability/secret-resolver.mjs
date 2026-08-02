import { BoundedFileSecretProvider } from "../identity/operational-config.mjs";
import { assertObservability, ObservabilityError } from "./errors.mjs";

export function createOperationalSecretResolver({ env = process.env, fileProvider = new BoundedFileSecretProvider({ maxBytes: 1_048_576 }) } = {}) {
  return async (reference, { signal } = {}) => {
    const environmentMatch = /^env:\/\/([A-Z_][A-Z0-9_]*)$/u.exec(reference);
    if (environmentMatch) {
      const name = environmentMatch[1];
      const value = env[name];
      assertObservability(typeof value === "string" && value.length > 0 && value.length <= 1_048_576 && !value.includes("\0"),
        "OBS_SECRET_UNAVAILABLE", "observability environment secret is unavailable");
      return value;
    }
    let url;
    try { url = new URL(reference); } catch { throw new ObservabilityError("OBS_SECRET_REFERENCE_INVALID", "observability secret reference is invalid"); }
    if (url.protocol === "file:") return fileProvider.get(reference, { signal });
    assertObservability(false, "OBS_SECRET_REFERENCE_INVALID", "observability secret reference must use env://NAME or an unadorned file URL");
  };
}
