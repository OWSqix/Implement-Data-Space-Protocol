import { hrtime } from "node:process";
import { createChildTraceContext, createRootTraceContext, extractTraceContext, injectTraceContext } from "./trace-context.mjs";
import { normalizeSpanAttributes } from "./redaction.mjs";
import { assertObservability } from "./errors.mjs";

const KIND = Object.freeze({ internal: 1, server: 2, client: 3, producer: 4, consumer: 5 });

function nowNanos() {
  return (BigInt(Date.now()) * 1_000_000n).toString();
}

export class MolitTracer {
  constructor({ sink, component, tenantSalt, tenantBucketCount = 64, clock = nowNanos }) {
    assertObservability(sink?.export && ["operational", "local-test"].includes(sink.mode), "OBS_SINK_INVALID", "a classified telemetry sink is required");
    assertObservability(typeof component === "string" && component.length > 0, "OBS_COMPONENT_REQUIRED", "telemetry component is required");
    this.sink = sink;
    this.component = component;
    this.tenantSalt = tenantSalt;
    this.tenantBucketCount = tenantBucketCount;
    this.clock = clock;
  }

  startSpan(name, { parent, kind = "internal", attributes = {}, tenantId } = {}) {
    assertObservability(/^[a-z][a-z0-9._/-]{0,127}$/u.test(name), "OBS_SPAN_NAME_INVALID", "span name is invalid");
    assertObservability(KIND[kind], "OBS_SPAN_KIND_INVALID", "span kind is invalid");
    const context = parent ? createChildTraceContext(parent) : createRootTraceContext();
    const startedAt = this.clock();
    const monotonicStart = hrtime.bigint();
    let ended = false;
    return Object.freeze({
      context,
      outboundHeaders: (headers) => injectTraceContext(headers, context),
      end: async ({ status = "OK", message, attributes: finalAttributes = {}, signal } = {}) => {
        assertObservability(!ended, "OBS_SPAN_ALREADY_ENDED", "span may be ended only once");
        assertObservability(["OK", "ERROR"].includes(status), "OBS_SPAN_STATUS_INVALID", "span status must be OK or ERROR");
        ended = true;
        const elapsed = hrtime.bigint() - monotonicStart;
        const endTimeUnixNano = (BigInt(startedAt) + elapsed).toString();
        const span = {
          traceId: context.traceId,
          spanId: context.spanId,
          ...(parent?.spanId ? { parentSpanId: parent.spanId } : {}),
          traceFlags: context.traceFlags,
          tracestate: context.tracestate,
          name,
          kind: KIND[kind],
          startTimeUnixNano: startedAt,
          endTimeUnixNano,
          status,
          ...(message ? { statusMessage: String(message).slice(0, 256) } : {}),
          attributes: normalizeSpanAttributes({ ...attributes, ...finalAttributes, "molit.component": this.component }, { tenantId, tenantSalt: this.tenantSalt, tenantBucketCount: this.tenantBucketCount }),
        };
        await this.sink.export([span], { signal });
        return span;
      },
    });
  }

  startIncomingSpan(name, headers, options = {}) {
    const parent = extractTraceContext(headers);
    return this.startSpan(name, { ...options, parent, kind: options.kind ?? "server" });
  }
}
