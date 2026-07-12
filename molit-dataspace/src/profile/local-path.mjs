export function assertLocalFilesystemPath(filePath, label = "path") {
  if (typeof filePath !== "string" || filePath.length === 0 || filePath.includes("\0")) {
    const error = new Error(`${label} must be a non-empty local filesystem path`);
    error.code = "INVALID_LOCAL_PATH";
    throw error;
  }
  const normalized = filePath.replaceAll("/", "\\");
  if (normalized.startsWith("\\\\")) {
    const error = new Error(`${label} must not use a UNC or device namespace`);
    error.code = "NON_LOCAL_PATH";
    throw error;
  }
}
