import { validateProfileDocument } from "../profile/validator.mjs";

export class MolitProfileGate {
  async validate(options) {
    const report = await validateProfileDocument(options);
    return {
      gatePassed: report.summary.gatePassed,
      decisionDigest: report.decisionDigest,
      inputSha256: report.input.byteSha256,
    };
  }
}
