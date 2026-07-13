import { assertRuntime } from "./errors.mjs";
import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { resolve, relative } from "node:path";

function at(value, path) {
  return path.split(".").filter(Boolean).reduce((current, key) => current?.[key], value);
}

export class JsonPathDispatchProjector {
  constructor(mapping, { metadataRoot, profileGate }) {
    this.mapping = mapping;
    this.metadataRoot = resolve(metadataRoot);
    this.profileGate = profileGate;
  }

  async project(source) {
    const offering = at(source, this.mapping.offeringPath);
    const approvalId = at(source, this.mapping.approvalIdPath);
    const metadataRelativePath = at(source, this.mapping.metadataPath);
    assertRuntime(offering && typeof approvalId === "string" && typeof metadataRelativePath === "string", "PROJECTION_FAILED", "platform mapping did not produce metadata, offering and approval ID");
    const canonicalRoot = await realpath(this.metadataRoot);
    const metadataPath = await realpath(resolve(canonicalRoot, metadataRelativePath));
    assertRuntime(!relative(canonicalRoot, metadataPath).startsWith(".."), "METADATA_PATH_ESCAPE", "metadata path escapes the configured root");
    const size = (await stat(metadataPath)).size;
    assertRuntime(size <= (this.mapping.maxMetadataBytes ?? 16 * 1024 * 1024), "METADATA_TOO_LARGE", "staged RDF exceeds the configured byte limit");
    const metadataBytes = await readFile(metadataPath);
    assertRuntime(metadataBytes.byteLength <= (this.mapping.maxMetadataBytes ?? 16 * 1024 * 1024), "METADATA_TOO_LARGE", "staged RDF grew beyond the configured byte limit while reading");
    const metadataDigest = createHash("sha256").update(metadataBytes).digest("hex");
    const validation = await this.profileGate.validate({ inputPath: metadataPath, profileName: this.mapping.profileName, version: this.mapping.profileVersion });
    assertRuntime(validation.gatePassed === true, "MOLIT_PROFILE_GATE_FAILED", "MOLIT AP validation did not pass");
    assertRuntime(validation.inputSha256 === metadataDigest, "METADATA_CHANGED_DURING_VALIDATION", "staged RDF changed between digest calculation and profile validation");
    return {
      dispatchEnvelope: {
        schemaVersion: "molit.operational-dispatch/1",
        automaticDispatchAllowed: true,
        routing: "production-connector",
        approvalId,
        metadata: { sha256: metadataDigest, profileName: this.mapping.profileName, profileVersion: this.mapping.profileVersion, decisionDigest: validation.decisionDigest },
        offering: structuredClone(offering),
      },
    };
  }
}
