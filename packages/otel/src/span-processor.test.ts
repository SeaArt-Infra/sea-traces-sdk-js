import { propagation, ROOT_CONTEXT, type Context } from "@opentelemetry/api";
import { ExportResultCode } from "@opentelemetry/core";
import type {
  ReadableSpan,
  Span,
  SpanExporter,
} from "@opentelemetry/sdk-trace-base";
import {
  base64Encode,
  clearSealangfuseCredentialsCache,
  LANGFUSE_TRACER_NAME,
  LANGFUSE_TRACE_ID_BAGGAGE_KEY,
  LangfuseAPIClient,
  LangfuseOtelSpanAttributes,
  getPropagatedAttributesFromContext,
} from "@sea-traces/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LangfuseSpanProcessor } from "./span-processor.js";

const noopExporter: SpanExporter = {
  export: (_spans, cb) => cb({ code: ExportResultCode.SUCCESS }),
  shutdown: async () => undefined,
};

type TestSpan = Span &
  ReadableSpan & {
    setAttribute: (key: string, value: unknown) => TestSpan;
    setAttributes: (kv: Record<string, unknown>) => TestSpan;
  };

let spanIdCounter = 0;
const nextSpanId = () => (++spanIdCounter).toString(16).padStart(16, "0");

function createTestSpan(opts: {
  traceId: string;
  spanId?: string;
  parentSpanId?: string;
  instrumentationScopeName?: string;
  name?: string;
  initialAttributes?: Record<string, unknown>;
}): TestSpan {
  const attributes: Record<string, unknown> = {
    ...(opts.initialAttributes ?? {}),
  };
  const spanId = opts.spanId ?? nextSpanId();

  const span = {
    name: opts.name ?? "test-span",
    attributes,
    instrumentationScope: {
      name: opts.instrumentationScopeName ?? "unknown.instrumentation",
      version: undefined,
      schemaUrl: undefined,
    },
    parentSpanContext: opts.parentSpanId
      ? { traceId: opts.traceId, spanId: opts.parentSpanId, traceFlags: 1 }
      : undefined,
    spanContext: () => ({
      traceId: opts.traceId,
      spanId,
      traceFlags: 1,
    }),
    setAttribute(key: string, value: unknown) {
      attributes[key] = value;
      return span;
    },
    setAttributes(kv: Record<string, unknown>) {
      Object.assign(attributes, kv);
      return span;
    },
    // Stubbed ReadableSpan surface used by the export pipeline.
    duration: [0, 0],
    startTime: [0, 0],
    endTime: [0, 0],
    kind: 0,
    status: { code: 0 },
    resource: { attributes: {} },
    events: [],
    links: [],
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
    ended: false,
  } as unknown as TestSpan;

  return span;
}

function contextWithBaggageClaim(
  traceId: string,
  base: Context = ROOT_CONTEXT,
): Context {
  const baggage = propagation
    .createBaggage()
    .setEntry(LANGFUSE_TRACE_ID_BAGGAGE_KEY, { value: traceId });

  return propagation.setBaggage(base, baggage);
}

const TRACE_ID = "0123456789abcdef0123456789abcdef";
const originalFetch = globalThis.fetch;
type FetchCall = [Parameters<typeof fetch>[0], Parameters<typeof fetch>[1]?];

describe("LangfuseSpanProcessor app-root marking", () => {
  let processor: LangfuseSpanProcessor;

  beforeEach(() => {
    spanIdCounter = 0;
    processor = new LangfuseSpanProcessor({
      apiKey: "sea-team-test",
      baseUrl: "https://sea-traces.example.com",
      publicKey: "pk-lf-test",
      secretKey: "sk-lf-test",
      exporter: noopExporter,
    });
  });

  it("marks an exported child whose immediate parent is filtered", () => {
    const parent = createTestSpan({
      traceId: TRACE_ID,
      instrumentationScopeName: "unknown.instrumentation",
    });
    processor.onStart(parent, ROOT_CONTEXT);

    const child = createTestSpan({
      traceId: TRACE_ID,
      parentSpanId: parent.spanContext().spanId,
      instrumentationScopeName: LANGFUSE_TRACER_NAME,
    });
    processor.onStart(child, ROOT_CONTEXT);

    expect(
      parent.attributes[LangfuseOtelSpanAttributes.IS_APP_ROOT],
    ).toBeUndefined();
    expect(child.attributes[LangfuseOtelSpanAttributes.IS_APP_ROOT]).toBe(true);
  });

  it("marks all exported siblings under a filtered parent", () => {
    const parent = createTestSpan({
      traceId: TRACE_ID,
      instrumentationScopeName: "unknown.instrumentation",
    });
    processor.onStart(parent, ROOT_CONTEXT);

    const childA = createTestSpan({
      traceId: TRACE_ID,
      parentSpanId: parent.spanContext().spanId,
      instrumentationScopeName: LANGFUSE_TRACER_NAME,
    });
    const childB = createTestSpan({
      traceId: TRACE_ID,
      parentSpanId: parent.spanContext().spanId,
      instrumentationScopeName: LANGFUSE_TRACER_NAME,
    });
    processor.onStart(childA, ROOT_CONTEXT);
    processor.onStart(childB, ROOT_CONTEXT);

    expect(childA.attributes[LangfuseOtelSpanAttributes.IS_APP_ROOT]).toBe(
      true,
    );
    expect(childB.attributes[LangfuseOtelSpanAttributes.IS_APP_ROOT]).toBe(
      true,
    );
  });

  it("only considers the immediate parent's export status", () => {
    const grandparent = createTestSpan({
      traceId: TRACE_ID,
      instrumentationScopeName: LANGFUSE_TRACER_NAME,
    });
    processor.onStart(grandparent, ROOT_CONTEXT);

    const parent = createTestSpan({
      traceId: TRACE_ID,
      parentSpanId: grandparent.spanContext().spanId,
      instrumentationScopeName: "unknown.instrumentation",
    });
    processor.onStart(parent, ROOT_CONTEXT);

    const child = createTestSpan({
      traceId: TRACE_ID,
      parentSpanId: parent.spanContext().spanId,
      instrumentationScopeName: LANGFUSE_TRACER_NAME,
    });
    processor.onStart(child, ROOT_CONTEXT);

    expect(grandparent.attributes[LangfuseOtelSpanAttributes.IS_APP_ROOT]).toBe(
      true,
    );
    expect(
      parent.attributes[LangfuseOtelSpanAttributes.IS_APP_ROOT],
    ).toBeUndefined();
    expect(child.attributes[LangfuseOtelSpanAttributes.IS_APP_ROOT]).toBe(true);
  });

  it("marks only the parent when both parent and child export", () => {
    const parent = createTestSpan({
      traceId: TRACE_ID,
      instrumentationScopeName: LANGFUSE_TRACER_NAME,
    });
    processor.onStart(parent, ROOT_CONTEXT);

    const child = createTestSpan({
      traceId: TRACE_ID,
      parentSpanId: parent.spanContext().spanId,
      instrumentationScopeName: LANGFUSE_TRACER_NAME,
    });
    processor.onStart(child, ROOT_CONTEXT);

    expect(parent.attributes[LangfuseOtelSpanAttributes.IS_APP_ROOT]).toBe(
      true,
    );
    expect(
      child.attributes[LangfuseOtelSpanAttributes.IS_APP_ROOT],
    ).toBeUndefined();
  });

  it("never marks spans rejected by a custom shouldExportSpan filter", () => {
    const rejectAll = new LangfuseSpanProcessor({
      apiKey: "sea-team-test",
      baseUrl: "https://sea-traces.example.com",
      publicKey: "pk-lf-test",
      secretKey: "sk-lf-test",
      exporter: noopExporter,
      shouldExportSpan: () => false,
    });

    const span = createTestSpan({
      traceId: TRACE_ID,
      instrumentationScopeName: LANGFUSE_TRACER_NAME,
    });
    rejectAll.onStart(span, ROOT_CONTEXT);

    expect(
      span.attributes[LangfuseOtelSpanAttributes.IS_APP_ROOT],
    ).toBeUndefined();
  });

  it("marks known GenAI instrumentation scopes before gen_ai attributes are set", () => {
    const span = createTestSpan({
      traceId: TRACE_ID,
      instrumentationScopeName: "opentelemetry.instrumentation.openai",
    });
    processor.onStart(span, ROOT_CONTEXT);

    expect(span.attributes[LangfuseOtelSpanAttributes.IS_APP_ROOT]).toBe(true);
  });

  it("suppresses local marking when matching baggage claim exists and no local parent", () => {
    const span = createTestSpan({
      traceId: TRACE_ID,
      instrumentationScopeName: LANGFUSE_TRACER_NAME,
    });
    processor.onStart(span, contextWithBaggageClaim(TRACE_ID));

    expect(
      span.attributes[LangfuseOtelSpanAttributes.IS_APP_ROOT],
    ).toBeUndefined();
  });

  it("does not suppress when baggage claim is for a different trace", () => {
    const otherTrace = "ffffffffffffffffffffffffffffffff";
    const span = createTestSpan({
      traceId: TRACE_ID,
      instrumentationScopeName: LANGFUSE_TRACER_NAME,
    });
    processor.onStart(span, contextWithBaggageClaim(otherTrace));

    expect(span.attributes[LangfuseOtelSpanAttributes.IS_APP_ROOT]).toBe(true);
  });

  it("suppresses local children when matching baggage claim exists", () => {
    const parent = createTestSpan({
      traceId: TRACE_ID,
      instrumentationScopeName: "unknown.instrumentation",
    });
    processor.onStart(parent, contextWithBaggageClaim(TRACE_ID));

    const child = createTestSpan({
      traceId: TRACE_ID,
      parentSpanId: parent.spanContext().spanId,
      instrumentationScopeName: LANGFUSE_TRACER_NAME,
    });
    processor.onStart(child, contextWithBaggageClaim(TRACE_ID));

    expect(
      child.attributes[LangfuseOtelSpanAttributes.IS_APP_ROOT],
    ).toBeUndefined();
  });

  it("releases local span state after all tracked spans end", async () => {
    const parent = createTestSpan({
      traceId: TRACE_ID,
      instrumentationScopeName: LANGFUSE_TRACER_NAME,
    });
    processor.onStart(parent, ROOT_CONTEXT);

    const child = createTestSpan({
      traceId: TRACE_ID,
      parentSpanId: parent.spanContext().spanId,
      instrumentationScopeName: LANGFUSE_TRACER_NAME,
    });
    processor.onStart(child, ROOT_CONTEXT);

    processor.onEnd(child);
    processor.onEnd(parent);
    await processor.forceFlush();

    const internalSpans = (
      processor as unknown as {
        spanExportExpectationById: Map<string, unknown>;
      }
    ).spanExportExpectationById;
    expect(internalSpans.size).toBe(0);
  });

  it("marks a child started after its parent ended as an app root", async () => {
    const parent = createTestSpan({
      traceId: TRACE_ID,
      instrumentationScopeName: LANGFUSE_TRACER_NAME,
    });
    processor.onStart(parent, ROOT_CONTEXT);

    expect(parent.attributes[LangfuseOtelSpanAttributes.IS_APP_ROOT]).toBe(
      true,
    );

    processor.onEnd(parent);

    const child = createTestSpan({
      traceId: TRACE_ID,
      parentSpanId: parent.spanContext().spanId,
      instrumentationScopeName: LANGFUSE_TRACER_NAME,
    });
    processor.onStart(child, ROOT_CONTEXT);

    expect(child.attributes[LangfuseOtelSpanAttributes.IS_APP_ROOT]).toBe(true);

    processor.onEnd(child);
    await processor.forceFlush();
  });

  it("retains state for never-ended spans (documented best-effort gap)", () => {
    const parent = createTestSpan({
      traceId: TRACE_ID,
      instrumentationScopeName: LANGFUSE_TRACER_NAME,
    });
    processor.onStart(parent, ROOT_CONTEXT);

    const internalSpans = (
      processor as unknown as {
        spanExportExpectationById: Map<string, unknown>;
      }
    ).spanExportExpectationById;
    expect(internalSpans.has(parent.spanContext().spanId)).toBe(true);
  });

  it("keeps the start-time marker even when the end-time filter rejects the span", async () => {
    let calls = 0;
    const flipFilter = new LangfuseSpanProcessor({
      apiKey: "sea-team-test",
      baseUrl: "https://sea-traces.example.com",
      publicKey: "pk-lf-test",
      secretKey: "sk-lf-test",
      exporter: noopExporter,
      shouldExportSpan: () => {
        calls += 1;
        return calls === 1; // accept on start, reject on end
      },
    });

    const span = createTestSpan({
      traceId: TRACE_ID,
      instrumentationScopeName: "unknown.instrumentation",
    });
    flipFilter.onStart(span, ROOT_CONTEXT);

    expect(span.attributes[LangfuseOtelSpanAttributes.IS_APP_ROOT]).toBe(true);

    flipFilter.onEnd(span);
    await flipFilter.forceFlush();

    // V1 does not repair: the marker remains, but the span will not be exported.
    expect(span.attributes[LangfuseOtelSpanAttributes.IS_APP_ROOT]).toBe(true);
  });
});

describe("propagation: internal app-root baggage", () => {
  it("does not surface the internal trace-id baggage as user metadata", () => {
    const ctx = contextWithBaggageClaim(TRACE_ID);
    const propagated = getPropagatedAttributesFromContext(ctx);

    for (const key of Object.keys(propagated)) {
      expect(key).not.toContain("langfuse_trace_id");
    }
  });
});

describe("LangfuseSpanProcessor Sea Traces credentials", () => {
  afterEach(() => {
    clearSealangfuseCredentialsCache();
    vi.unstubAllEnvs();
    globalThis.fetch = originalFetch;
  });

  it("uses direct credentials without calling the resolver", async () => {
    const fetchMock = vi.fn(async (url: Parameters<typeof fetch>[0]) => {
      expect(String(url)).toBe(
        "https://upload-direct.example.com/api/public/projects",
      );

      return new Response(JSON.stringify({ data: [] }));
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const processor = new LangfuseSpanProcessor({
      publicKey: "pk-lf-direct",
      secretKey: "sk-lf-direct",
      baseUrl: "https://upload-direct.example.com",
      exporter: noopExporter,
    });
    const apiClient = (processor as unknown as { apiClient: LangfuseAPIClient })
      .apiClient;

    await apiClient.projects.get();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      (fetchMock.mock.calls[0] as unknown as FetchCall | undefined)?.[1]
        ?.headers,
    ).toMatchObject({
      Authorization: `Basic ${base64Encode("pk-lf-direct:sk-lf-direct")}`,
      "X-Langfuse-Public-Key": "pk-lf-direct",
    });
  });

  it("resolves gateway project and posts ingestion without auth", async () => {
    const fetchMock = vi.fn(
      async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
        if (
          String(url) === "https://gateway.example.com/hub/sea-traces-api-key"
        ) {
          expect(JSON.parse(String(init?.body))).toEqual({
            api_key: "sa-test",
            base_url: "https://gateway.example.com",
          });

          return new Response(
            JSON.stringify({
              project_id: "project-resolved",
              base_url: "https://upload.example.com",
            }),
          );
        }

        expect(String(url)).toBe(
          "https://upload.example.com/api/public/ingestion-noauth",
        );
        expect(JSON.parse(String(init?.body))).toMatchObject({
          project_id: "project-resolved",
          batch: [],
        });
        expect(init?.headers).not.toHaveProperty("Authorization");
        expect(init?.headers).not.toHaveProperty("X-Langfuse-Public-Key");

        return new Response(JSON.stringify({ successes: [], errors: [] }));
      },
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const processor = new LangfuseSpanProcessor({
      apiKey: "sa-test",
      baseUrl: "https://gateway.example.com",
      projectId: "project-test",
      exporter: noopExporter,
    });
    const apiClient = (processor as unknown as { apiClient: LangfuseAPIClient })
      .apiClient;

    await apiClient.ingestion.batch({ batch: [] });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("uses gateway env vars when constructor auth is omitted", async () => {
    vi.stubEnv("SEA_TRACES_API_KEY", "sea-traces-env");
    vi.stubEnv("SEA_TRACES_BASE_URL", "https://gateway.example.com");

    const fetchMock = vi.fn(async (url: Parameters<typeof fetch>[0]) => {
      if (
        String(url) === "https://gateway.example.com/hub/sea-traces-api-key"
      ) {
        return new Response(
          JSON.stringify({
            project_id: "project-env",
            base_url: "https://upload-env.example.com",
          }),
        );
      }

      expect(String(url)).toBe(
        "https://upload-env.example.com/api/public/ingestion-noauth",
      );

      return new Response(JSON.stringify({ successes: [], errors: [] }));
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const processor = new LangfuseSpanProcessor({ exporter: noopExporter });
    const apiClient = (processor as unknown as { apiClient: LangfuseAPIClient })
      .apiClient;

    await apiClient.ingestion.batch({ batch: [] });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("uses internal project env vars without calling the resolver", async () => {
    vi.stubEnv("SEATRACES_PROJECT_ID", "project-env");
    vi.stubEnv("SEATRACES_BASE_URL", "https://upload-env.example.com");

    const fetchMock = vi.fn(
      async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
        expect(String(url)).toBe(
          "https://upload-env.example.com/api/public/ingestion-noauth",
        );
        expect(JSON.parse(String(init?.body))).toMatchObject({
          project_id: "project-env",
        });
        expect(init?.headers).not.toHaveProperty("Authorization");

        return new Response(JSON.stringify({ successes: [], errors: [] }));
      },
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const processor = new LangfuseSpanProcessor({ exporter: noopExporter });
    const apiClient = (processor as unknown as { apiClient: LangfuseAPIClient })
      .apiClient;

    await apiClient.ingestion.batch({ batch: [] });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("default gateway exporter posts span batches through noauth ingestion", async () => {
    const fetchMock = vi.fn(
      async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
        if (
          String(url) === "https://gateway.example.com/hub/sea-traces-api-key"
        ) {
          expect(JSON.parse(String(init?.body))).toEqual({
            api_key: "sa-test",
            base_url: "https://gateway.example.com",
          });

          return new Response(
            JSON.stringify({
              project_id: "project-resolved",
              base_url: "https://upload.example.com",
            }),
          );
        }

        expect(String(url)).toBe(
          "https://upload.example.com/api/public/ingestion-noauth",
        );
        expect(JSON.parse(String(init?.body))).toMatchObject({
          project_id: "project-resolved",
          batch: [
            {
              type: "trace-create",
            },
            {
              type: "span-create",
            },
          ],
        });
        expect(init?.headers).not.toHaveProperty("Authorization");

        return new Response(JSON.stringify({ successes: [], errors: [] }));
      },
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const processor = new LangfuseSpanProcessor({
      apiKey: "sa-test",
      baseUrl: "https://gateway.example.com",
      exportMode: "immediate",
    });
    const span = createTestSpan({
      traceId: TRACE_ID,
      instrumentationScopeName: LANGFUSE_TRACER_NAME,
    });

    processor.onStart(span, ROOT_CONTEXT);
    processor.onEnd(span);
    await processor.forceFlush();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws when auth config is incomplete", () => {
    expect(
      () =>
        new LangfuseSpanProcessor({
          apiKey: "sa-test",
          exporter: noopExporter,
        }),
    ).toThrow("Sea Traces gateway authentication requires apiKey and baseUrl");
  });
});
