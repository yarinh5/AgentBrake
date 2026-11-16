import type express from "express";
import { SpanKind, SpanStatusCode } from "@opentelemetry/api";
import {
  TracerProvider,
  SimpleSpanProcessor,
  type SpanExporter,
} from "@opentelemetry/sdk-trace";
// Explicit SDK/exporter configuration: no automatic instrumentation, remote endpoint,
// environment resource detection, URL/body/header/error collection or user attributes.
export class LocalTelemetry {
  private provider: TracerProvider;
  constructor(
    private component: "gateway" | "control",
    write: (line: string) => void,
  ) {
    const exporter: SpanExporter = {
      export: (spans, callback) => {
        try {
          for (const span of spans) {
            const context = span.spanContext();
            const ns = (time: [number, number]) =>
              (BigInt(time[0]) * 1000000000n + BigInt(time[1])).toString();
            const attributes = Object.entries(span.attributes)
              .filter(([key]) =>
                [
                  "agentbrake.correlation_id",
                  "http.request.method",
                  "http.route",
                  "http.response.status_code",
                ].includes(key),
              )
              .map(([key, value]) => ({
                key,
                value:
                  typeof value === "number"
                    ? { intValue: String(value) }
                    : { stringValue: String(value) },
              }));
            write(
              JSON.stringify({
                resourceSpans: [
                  {
                    resource: {
                      attributes: [
                        {
                          key: "service.name",
                          value: {
                            stringValue: "agentbrake-" + this.component,
                          },
                        },
                      ],
                    },
                    scopeSpans: [
                      {
                        scope: { name: "agentbrake.local", version: "1" },
                        spans: [
                          {
                            traceId: context.traceId,
                            spanId: context.spanId,
                            name: "agentbrake.http",
                            kind: 2,
                            startTimeUnixNano: ns(span.startTime),
                            endTimeUnixNano: ns(span.endTime),
                            attributes,
                            status: { code: span.status.code },
                          },
                        ],
                      },
                    ],
                  },
                ],
              }),
            );
          }
          callback({ code: 0 });
        } catch {
          callback({ code: 1 });
        }
      },
      shutdown: async () => {},
    };
    this.provider = new TracerProvider({
      spanLimits: {
        attributeCountLimit: 8,
        attributeValueLengthLimit: 150,
        eventCountLimit: 0,
        linkCountLimit: 0,
      },
      spanProcessors: [new SimpleSpanProcessor({ exporter })],
    });
  }
  middleware(): express.RequestHandler {
    return (req, res, next) => {
      const span = this.provider
        .getTracer("agentbrake.local", "1")
        .startSpan("agentbrake.http", {
          kind: SpanKind.SERVER,
          attributes: {
            "agentbrake.correlation_id": res.locals.correlationId,
            "http.request.method": [
              "GET",
              "POST",
              "PUT",
              "PATCH",
              "DELETE",
              "HEAD",
              "OPTIONS",
            ].includes(req.method)
              ? req.method
              : "OTHER",
          },
        });
      res.setHeader("X-Trace-ID", span.spanContext().traceId);
      res.once("finish", () => {
        span.setAttribute("http.response.status_code", res.statusCode);
        span.setAttribute(
          "http.route",
          typeof req.route?.path === "string" ? req.route.path : "unmatched",
        );
        if (res.statusCode >= 500)
          span.setStatus({ code: SpanStatusCode.ERROR });
        span.end();
      });
      next();
    };
  }
  shutdown() {
    return this.provider.shutdown();
  }
}
