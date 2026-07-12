import { digest } from "./stable-json.mjs";

export function computeOutboxEventId(event) {
  return digest({
    approvalGate: event.approvalGate,
    sequence: event.sequence,
    type: event.type,
    key: event.aggregateKey,
    version: event.resourceVersion,
    payload: event.payload,
  });
}
