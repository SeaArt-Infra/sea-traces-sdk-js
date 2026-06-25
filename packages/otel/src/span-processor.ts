import { Context } from "@opentelemetry/api";
import { ExportResultCode, hrTimeToMilliseconds } from "@opentelemetry/core";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import {
  Span,
  BatchSpanProcessor,
  SimpleSpanProcessor,
  SpanExporter,
  ReadableSpan,
  SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import {
  Logger,
  LogLevel,
  getGlobalLogger,
  LangfuseAPIClient,
  IngestionEvent,
  LANGFUSE_SDK_VERSION,
  LangfuseOtelSpanAttributes,
  getEnv,
  base64Encode,
  getLangfuseTraceIdFromBaggage,
  getPropagatedAttributesFromContext,
  generateUUID,
  resolveSeaTracesAuth,
  type SeaTracesProject,
} from "@sea-traces/core";

import { MediaService } from "./MediaService.js";
import { isDefaultExportSpan } from "./span-filter.js";

/**
 * Function type for masking sensitive data in spans before export.
 *
 * @param params - Object containing the data to be masked
 * @param params.data - The data that should be masked
 * @returns The masked data, or a promise resolving to it
 *
 * @example
 * ```typescript
 * const maskFunction: MaskFunction = async ({ data }) => {
 *   if (typeof data === 'string') {
 *     return data.replace(/password=\w+/g, 'password=***');
 *   }
 *   return data;
 * };
 * ```
 *
 * @public
 */
export type MaskFunction = (params: { data: any }) => any | Promise<any>;

/**
 * Function type for determining whether a span should be exported to Langfuse.
 * If provided, this is treated as a full override of the default filtering behavior.
 * Langfuse may call this predicate both when a span starts for app-root classification
 * and when the span ends for export filtering. Prefer side-effect-free predicates; the
 * start-time call sees only attributes available at span creation, and end-time fields
 * such as duration may not be populated yet.
 *
 * @param params - Object containing the span to evaluate
 * @param params.otelSpan - The OpenTelemetry span to evaluate
 * @returns `true` if the span should be exported, `false` otherwise
 *
 * @example
 * ```typescript
 * const shouldExportSpan: ShouldExportSpan = ({ otelSpan }) => {
 *   // Only export spans that took longer than 100ms
 *   return otelSpan.duration[0] * 1000 + otelSpan.duration[1] / 1000000 > 100;
 * };
 * ```
 *
 * @public
 */
export type ShouldExportSpan = (params: { otelSpan: ReadableSpan }) => boolean;

/**
 * Configuration parameters for the LangfuseSpanProcessor.
 *
 * @public
 */
export interface LangfuseSpanProcessorParams {
  /**
   * Custom OpenTelemetry span exporter. If not provided, a default OTLP exporter will be used.
   */
  exporter?: SpanExporter;

  /**
   * Public upload key for direct Sea Traces ingestion.
   * Can also be set via SEATRACES_PUBLIC_KEY environment variable.
   */
  publicKey?: string;

  /**
   * Secret upload key for direct Sea Traces ingestion.
   * Can also be set via SEATRACES_SECRET_KEY environment variable.
   */
  secretKey?: string;

  /**
   * Sea Traces gateway API key used to resolve upload credentials.
   * Can also be set via SEA_TRACES_API_KEY environment variable.
   */
  apiKey?: string;

  /**
   * Sea Traces base URL.
   * In direct mode this is the upload URL and can also be set via
   * SEATRACES_BASE_URL. In gateway mode this is the gateway URL and can also
   * be set via SEA_TRACES_BASE_URL.
   */
  baseUrl?: string;

  /**
   * Sea Traces project ID for project-based noauth ingestion.
   * Can also be set via SEATRACES_PROJECT_ID environment variable.
   */
  projectId?: string;

  /**
   * Optional override for the Sea Traces credential resolver endpoint.
   */
  credentialsUrl?: string;

  /**
   * Number of spans to batch before flushing. Can also be set via LANGFUSE_FLUSH_AT environment variable.
   */
  flushAt?: number;

  /**
   * Flush interval in seconds. Can also be set via LANGFUSE_FLUSH_INTERVAL environment variable.
   */
  flushInterval?: number;

  /**
   * Function to mask sensitive data in spans before export.
   */
  mask?: MaskFunction;

  /**
   * Function to determine whether a span should be exported to Langfuse.
   * If not provided, a smart default filter is applied to export Langfuse spans,
   * spans with `gen_ai.` attributes, and spans from known LLM instrumentors.
   */
  shouldExportSpan?: ShouldExportSpan;

  /**
   * Environment identifier for the traces. Can also be set via LANGFUSE_TRACING_ENVIRONMENT environment variable.
   */
  environment?: string;

  /**
   * Release identifier for the traces. Can also be set via LANGFUSE_RELEASE environment variable.
   */
  release?: string;

  /**
   * Request timeout in seconds. Can also be set via LANGFUSE_TIMEOUT environment variable.
   * @defaultValue 5
   */
  timeout?: number;

  /**
   * Additional HTTP headers to include with requests.
   */
  additionalHeaders?: Record<string, string>;
  /**
   * Span export mode to use.
   *
   * - **batched**: Recommended for production environments with long-running processes.
   *   Spans are batched and exported in groups for optimal performance.
   * - **immediate**: Recommended for short-lived environments such as serverless functions.
   *   Spans are exported immediately to prevent data loss when the process terminates / is frozen.
   *
   * @defaultValue "batched"
   */
  exportMode?: "immediate" | "batched";
}

class SeaTracesNoauthSpanExporter implements SpanExporter {
  private apiClient?: LangfuseAPIClient;
  private apiClientPromise?: Promise<LangfuseAPIClient>;

  constructor(
    private readonly params: {
      project:
        | (() => Promise<SeaTracesProject>)
        | Promise<SeaTracesProject>
        | SeaTracesProject;
      timeoutSeconds: number;
      additionalHeaders?: Record<string, string>;
    },
  ) {}

  public export(
    spans: ReadableSpan[],
    resultCallback: (result: { code: ExportResultCode; error?: Error }) => void,
  ): void {
    void this.getApiClient()
      .then((apiClient) =>
        apiClient.ingestion.batch(
          {
            batch: spans.flatMap((span) => this.toIngestionEvents(span)),
          },
          {
            timeoutInSeconds: this.params.timeoutSeconds,
          },
        ),
      )
      .then(() => resultCallback({ code: ExportResultCode.SUCCESS }))
      .catch((error) =>
        resultCallback({
          code: ExportResultCode.FAILED,
          error: error instanceof Error ? error : new Error(String(error)),
        }),
      );
  }

  public async forceFlush(): Promise<void> {
    return;
  }

  public async shutdown(): Promise<void> {
    return;
  }

  private getApiClient(): Promise<LangfuseAPIClient> {
    if (this.apiClient) return Promise.resolve(this.apiClient);

    const project =
      typeof this.params.project === "function"
        ? this.params.project()
        : this.params.project;

    this.apiClientPromise ??= Promise.resolve(project).then((project) => {
      this.apiClient = new LangfuseAPIClient({
        baseUrl: project.baseUrl,
        projectId: project.projectId,
        xLangfuseSdkName: "javascript",
        xLangfuseSdkVersion: LANGFUSE_SDK_VERSION,
        environment: "",
        headers: this.params.additionalHeaders,
      });

      return this.apiClient;
    });

    return this.apiClientPromise;
  }

  private toIngestionEvents(span: ReadableSpan): IngestionEvent[] {
    const traceEvent = this.toTraceEvent(span);
    const observationEvent = this.toObservationEvent(span);

    return traceEvent ? [traceEvent, observationEvent] : [observationEvent];
  }

  private toTraceEvent(
    span: ReadableSpan,
  ): IngestionEvent.TraceCreate | undefined {
    const attributes = span.attributes;
    const isRoot =
      span.parentSpanContext?.spanId == null ||
      attributes[LangfuseOtelSpanAttributes.IS_APP_ROOT] === true;

    if (!isRoot) return undefined;

    return {
      id: generateUUID(),
      type: "trace-create",
      timestamp: new Date(hrTimeToMilliseconds(span.endTime)).toISOString(),
      body: {
        id: span.spanContext().traceId,
        timestamp: new Date(hrTimeToMilliseconds(span.startTime)).toISOString(),
        name:
          this.stringAttribute(
            attributes[LangfuseOtelSpanAttributes.TRACE_NAME],
          ) ?? span.name,
        userId: this.stringAttribute(
          attributes[LangfuseOtelSpanAttributes.TRACE_USER_ID],
        ),
        sessionId: this.stringAttribute(
          attributes[LangfuseOtelSpanAttributes.TRACE_SESSION_ID],
        ),
        input: this.jsonAttribute(
          attributes[LangfuseOtelSpanAttributes.TRACE_INPUT],
        ),
        output: this.jsonAttribute(
          attributes[LangfuseOtelSpanAttributes.TRACE_OUTPUT],
        ),
        metadata: this.metadataAttributes(attributes, "trace"),
        tags: this.stringArrayAttribute(
          attributes[LangfuseOtelSpanAttributes.TRACE_TAGS],
        ),
        release: this.stringAttribute(
          attributes[LangfuseOtelSpanAttributes.RELEASE],
        ),
        version: this.stringAttribute(
          attributes[LangfuseOtelSpanAttributes.VERSION],
        ),
        environment: this.stringAttribute(
          attributes[LangfuseOtelSpanAttributes.ENVIRONMENT],
        ),
        public: this.booleanAttribute(
          attributes[LangfuseOtelSpanAttributes.TRACE_PUBLIC],
        ),
      },
    };
  }

  private toObservationEvent(span: ReadableSpan): IngestionEvent {
    const attributes = span.attributes;
    const observationType =
      this.stringAttribute(
        attributes[LangfuseOtelSpanAttributes.OBSERVATION_TYPE],
      ) ?? "span";
    const commonBody = {
      id: span.spanContext().spanId,
      traceId: span.spanContext().traceId,
      name: span.name,
      startTime: new Date(hrTimeToMilliseconds(span.startTime)).toISOString(),
      endTime: new Date(hrTimeToMilliseconds(span.endTime)).toISOString(),
      metadata: this.metadataAttributes(attributes, "observation"),
      input: this.jsonAttribute(
        attributes[LangfuseOtelSpanAttributes.OBSERVATION_INPUT],
      ),
      output: this.jsonAttribute(
        attributes[LangfuseOtelSpanAttributes.OBSERVATION_OUTPUT],
      ),
      level: this.stringAttribute(
        attributes[LangfuseOtelSpanAttributes.OBSERVATION_LEVEL],
      ) as "DEBUG" | "DEFAULT" | "WARNING" | "ERROR" | undefined,
      statusMessage: this.stringAttribute(
        attributes[LangfuseOtelSpanAttributes.OBSERVATION_STATUS_MESSAGE],
      ),
      parentObservationId: span.parentSpanContext?.spanId,
      version: this.stringAttribute(
        attributes[LangfuseOtelSpanAttributes.VERSION],
      ),
      environment: this.stringAttribute(
        attributes[LangfuseOtelSpanAttributes.ENVIRONMENT],
      ),
    };

    if (observationType === "generation" || observationType === "embedding") {
      return {
        id: generateUUID(),
        type: "generation-create",
        timestamp: new Date(hrTimeToMilliseconds(span.endTime)).toISOString(),
        body: {
          ...commonBody,
          completionStartTime: this.dateAttribute(
            attributes[
              LangfuseOtelSpanAttributes.OBSERVATION_COMPLETION_START_TIME
            ],
          ),
          model: this.stringAttribute(
            attributes[LangfuseOtelSpanAttributes.OBSERVATION_MODEL],
          ),
          modelParameters: this.recordAttribute(
            attributes[LangfuseOtelSpanAttributes.OBSERVATION_MODEL_PARAMETERS],
          ),
          usageDetails: this.recordAttribute(
            attributes[LangfuseOtelSpanAttributes.OBSERVATION_USAGE_DETAILS],
          ),
          costDetails: this.numberRecordAttribute(
            attributes[LangfuseOtelSpanAttributes.OBSERVATION_COST_DETAILS],
          ),
          promptName: this.stringAttribute(
            attributes[LangfuseOtelSpanAttributes.OBSERVATION_PROMPT_NAME],
          ),
          promptVersion: this.numberAttribute(
            attributes[LangfuseOtelSpanAttributes.OBSERVATION_PROMPT_VERSION],
          ),
        },
      };
    }

    if (observationType === "event") {
      return {
        id: generateUUID(),
        type: "event-create",
        timestamp: new Date(hrTimeToMilliseconds(span.endTime)).toISOString(),
        body: commonBody,
      };
    }

    return {
      id: generateUUID(),
      type: "span-create",
      timestamp: new Date(hrTimeToMilliseconds(span.endTime)).toISOString(),
      body: commonBody,
    };
  }

  private stringAttribute(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
  }

  private booleanAttribute(value: unknown): boolean | undefined {
    return typeof value === "boolean" ? value : undefined;
  }

  private numberAttribute(value: unknown): number | undefined {
    return typeof value === "number" ? value : undefined;
  }

  private dateAttribute(value: unknown): string | undefined {
    if (value instanceof Date) return value.toISOString();
    if (typeof value === "string") return value;

    return undefined;
  }

  private stringArrayAttribute(value: unknown): string[] | undefined {
    if (Array.isArray(value)) {
      return value.filter((item): item is string => typeof item === "string");
    }

    if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed)
          ? parsed.filter((item): item is string => typeof item === "string")
          : undefined;
      } catch {
        return [value];
      }
    }

    return undefined;
  }

  private jsonAttribute(value: unknown): unknown {
    if (typeof value !== "string") return value;

    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  private recordAttribute(value: unknown): Record<string, any> | undefined {
    const parsed = this.jsonAttribute(value);

    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, any>;
    }

    return undefined;
  }

  private numberRecordAttribute(
    value: unknown,
  ): Record<string, number> | undefined {
    const parsed = this.recordAttribute(value);
    if (!parsed) return undefined;

    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, number] => typeof entry[1] === "number",
      ),
    );
  }

  private metadataAttributes(
    attributes: ReadableSpan["attributes"],
    type: "observation" | "trace",
  ): unknown {
    const prefix =
      type === "observation"
        ? LangfuseOtelSpanAttributes.OBSERVATION_METADATA
        : LangfuseOtelSpanAttributes.TRACE_METADATA;
    const direct = this.jsonAttribute(attributes[prefix]);
    const flattened = Object.fromEntries(
      Object.entries(attributes)
        .filter(([key]) => key.startsWith(`${prefix}.`))
        .map(([key, value]) => [key.slice(prefix.length + 1), value]),
    );

    if (Object.keys(flattened).length === 0) return direct;

    return {
      ...(direct && typeof direct === "object" && !Array.isArray(direct)
        ? direct
        : {}),
      ...flattened,
    };
  }
}

function getNoauthProject(
  auth: ReturnType<typeof resolveSeaTracesAuth>,
):
  | SeaTracesProject
  | Promise<SeaTracesProject>
  | (() => Promise<SeaTracesProject>) {
  if (auth.mode === "gateway") return auth.project;
  if (auth.mode === "project") {
    return {
      projectId: auth.projectId,
      baseUrl: auth.baseUrl,
    };
  }

  throw new Error("Sea Traces noauth export requires project configuration.");
}

/**
 * OpenTelemetry span processor for sending spans to Langfuse.
 *
 * This processor extends the standard BatchSpanProcessor to provide:
 * - Automatic batching and flushing of spans to Langfuse
 * - Media content extraction and upload from base64 data URIs
 * - Data masking capabilities for sensitive information
 * - Conditional span export based on custom logic
 *   (or default smart filtering when no custom filter is provided)
 * - Environment and release tagging
 *
 * @example
 * ```typescript
 * import { NodeSDK } from '@opentelemetry/sdk-node';
 * import { LangfuseSpanProcessor } from '@sea-traces/otel';
 *
 * const sdk = new NodeSDK({
 *   spanProcessors: [
 *     new LangfuseSpanProcessor({
 *       apiKey: 'sea-traces-api-key',
 *       baseUrl: 'https://your-sea-traces.example.com',
 *       projectId: 'project-id',
 *       environment: 'production',
 *       mask: ({ data }) => {
 *         // Mask sensitive data
 *         return data.replace(/api_key=\w+/g, 'api_key=***');
 *       }
 *     })
 *   ]
 * });
 *
 * sdk.start();
 * ```
 *
 * @public
 */
export class LangfuseSpanProcessor implements SpanProcessor {
  private pendingEndedSpans: Set<Promise<void>> = new Set();

  private publicKey?: string;
  private baseUrl?: string;
  private environment?: string;
  private release?: string;
  private mask?: MaskFunction;
  private shouldExportSpan: ShouldExportSpan;
  private apiClient: LangfuseAPIClient;
  private processor: SpanProcessor;
  private mediaService: MediaService;
  private spanExportExpectationById: Map<string, boolean> = new Map();

  /**
   * Creates a new LangfuseSpanProcessor instance.
   *
   * @param params - Configuration parameters for the processor
   *
   * @example
   * ```typescript
   * const processor = new LangfuseSpanProcessor({
   *   apiKey: 'sea-traces-api-key',
   *   baseUrl: 'https://your-sea-traces.example.com',
   *   projectId: 'project-id',
   *   environment: 'staging',
   *   flushAt: 10,
   *   flushInterval: 2,
   *   mask: ({ data }) => {
   *     // Custom masking logic
   *     return typeof data === 'string'
   *       ? data.replace(/secret_\w+/g, 'secret_***')
   *       : data;
   *   },
   *   shouldExportSpan: ({ otelSpan }) => {
   *     // Full override of default filtering:
   *     // export only spans from specific services
   *     return otelSpan.name.startsWith("my-service");
   *   }
   * });
   * ```
   */
  constructor(params?: LangfuseSpanProcessorParams) {
    const logger = getGlobalLogger();

    const flushAt = params?.flushAt ?? getEnv("LANGFUSE_FLUSH_AT");
    const flushIntervalSeconds =
      params?.flushInterval ?? getEnv("LANGFUSE_FLUSH_INTERVAL");

    const timeoutSeconds =
      params?.timeout ?? Number(getEnv("LANGFUSE_TIMEOUT") ?? 5);
    const auth = resolveSeaTracesAuth({
      publicKey: params?.publicKey,
      secretKey: params?.secretKey,
      baseUrl: params?.baseUrl,
      apiKey: params?.apiKey,
      projectId: params?.projectId,
      credentialsUrl: params?.credentialsUrl,
      timeoutSeconds,
    });
    const resolvedBaseUrl =
      auth.mode === "gateway"
        ? () => auth.project().then((value) => value.baseUrl)
        : auth.baseUrl;
    const resolvedProjectId =
      auth.mode === "gateway" ? auth.projectId : auth.projectId;

    const exporter =
      params?.exporter ??
      (auth.mode === "direct" || auth.mode === "legacy-direct"
        ? new OTLPTraceExporter({
            url: `${auth.baseUrl}/api/public/otel/v1/traces`,
            headers: {
              Authorization: `Basic ${base64Encode(
                `${auth.publicKey}:${auth.secretKey}`,
              )}`,
              "x-langfuse-sdk-name": "javascript",
              "x-langfuse-sdk-version": LANGFUSE_SDK_VERSION,
              "x-langfuse-public-key": auth.publicKey,
              ...params?.additionalHeaders,
            },
            timeoutMillis: timeoutSeconds * 1_000,
          })
        : new SeaTracesNoauthSpanExporter({
            project: getNoauthProject(auth),
            timeoutSeconds,
            additionalHeaders: params?.additionalHeaders,
          }));

    this.processor =
      params?.exportMode === "immediate"
        ? new SimpleSpanProcessor(exporter)
        : new BatchSpanProcessor(exporter, {
            maxExportBatchSize: flushAt ? Number(flushAt) : undefined,
            scheduledDelayMillis: flushIntervalSeconds
              ? Number(flushIntervalSeconds) * 1_000
              : undefined,
          });

    this.publicKey =
      auth.mode === "direct" || auth.mode === "legacy-direct"
        ? auth.publicKey
        : undefined;
    this.baseUrl = auth.baseUrl;
    this.environment =
      params?.environment ?? getEnv("LANGFUSE_TRACING_ENVIRONMENT");
    this.release = params?.release ?? getEnv("LANGFUSE_RELEASE");
    this.mask = params?.mask;
    this.shouldExportSpan =
      params?.shouldExportSpan ??
      (({ otelSpan }) => isDefaultExportSpan(otelSpan));
    this.apiClient = new LangfuseAPIClient({
      baseUrl: resolvedBaseUrl,
      username: auth.publicKey,
      password: auth.secretKey,
      xLangfusePublicKey: auth.publicKey,
      projectId: resolvedProjectId,
      xLangfuseSdkVersion: LANGFUSE_SDK_VERSION,
      xLangfuseSdkName: "javascript",
      environment: "", // noop as baseUrl is set
      headers: params?.additionalHeaders,
    });

    this.mediaService = new MediaService({ apiClient: this.apiClient });

    logger.debug("Initialized LangfuseSpanProcessor with params:", {
      authMode: auth.mode,
      baseUrl: auth.baseUrl,
      environment: this.environment,
      release: this.release,
      timeoutSeconds,
      flushAt,
      flushIntervalSeconds,
    });
  }

  private get logger(): Logger {
    return getGlobalLogger();
  }

  /**
   * Called when a span is started. Adds environment, release, and propagated attributes to the span.
   *
   * @param span - The span that was started
   * @param parentContext - The parent context
   *
   * @override
   */
  public onStart(span: Span, parentContext: Context): void {
    // Set propagated attributes, environment and release attributes
    span.setAttributes({
      [LangfuseOtelSpanAttributes.ENVIRONMENT]: this.environment,
      [LangfuseOtelSpanAttributes.RELEASE]: this.release,
      ...getPropagatedAttributesFromContext(parentContext),
    });

    try {
      this.markAppRootCandidate(span, parentContext);
    } catch (err) {
      this.logger.debug(
        "App-root start-time check failed. Span will not be marked as app root.",
        { spanName: span.name },
        err,
      );
    }

    return this.processor.onStart(span, parentContext);
  }

  /**
   * Called when a span ends. Processes the span for export to Langfuse.
   *
   * This method:
   * 1. Checks if the span should be exported using shouldExportSpan
   *    (custom override or default smart filter)
   * 2. Applies data masking to sensitive attributes
   * 3. Handles media content extraction and upload
   * 4. Logs span details in debug mode
   * 5. Passes the span to the parent processor for export
   *
   * @param span - The span that ended
   *
   * @override
   */
  public onEnd(span: ReadableSpan): void {
    this.spanExportExpectationById.delete(span.spanContext().spanId);

    const processEndedSpanPromise = this.processEndedSpan(span).catch((err) => {
      this.logger.error(err);
    });

    // Enqueue this export to the pending list so it can be flushed by the user.
    this.pendingEndedSpans.add(processEndedSpanPromise);

    void processEndedSpanPromise.finally(() =>
      this.pendingEndedSpans.delete(processEndedSpanPromise),
    );
  }

  private async flush(): Promise<void> {
    await Promise.all(Array.from(this.pendingEndedSpans));
    await this.mediaService.flush();
  }

  /**
   * Forces an immediate flush of all pending spans and media uploads.
   *
   * @returns Promise that resolves when all pending operations are complete
   *
   * @override
   */
  public async forceFlush(): Promise<void> {
    await this.flush();

    return this.processor.forceFlush();
  }

  /**
   * Gracefully shuts down the processor, ensuring all pending operations are completed.
   *
   * @returns Promise that resolves when shutdown is complete
   *
   * @override
   */
  public async shutdown(): Promise<void> {
    await this.flush();

    return this.processor.shutdown();
  }

  private async processEndedSpan(span: ReadableSpan) {
    try {
      if (this.shouldExportSpan({ otelSpan: span }) === false) {
        this.logger.debug("Dropped span due to shouldExportSpan filter.", {
          spanName: span.name,
          instrumentationScope: span.instrumentationScope.name,
        });

        return;
      }
    } catch (err) {
      this.logger.error(
        "shouldExportSpan failed with error. Dropping span.",
        {
          spanName: span.name,
          instrumentationScope: span.instrumentationScope.name,
        },
        err,
      );

      return;
    }

    await this.applyMaskInPlace(span);
    await this.mediaService.process(span);

    if (this.logger.isLevelEnabled(LogLevel.DEBUG)) {
      this.logger.debug(
        `Processed span:\n${JSON.stringify(
          {
            name: span.name,
            traceId: span.spanContext().traceId,
            spanId: span.spanContext().spanId,
            parentSpanId: span.parentSpanContext?.spanId ?? null,
            attributes: span.attributes,
            startTime: new Date(hrTimeToMilliseconds(span.startTime)),
            endTime: new Date(hrTimeToMilliseconds(span.endTime)),
            durationMs: hrTimeToMilliseconds(span.duration),
            kind: span.kind,
            status: span.status,
            resource: span.resource.attributes,
            instrumentationScope: span.instrumentationScope,
          },
          null,
          2,
        )}`,
      );
    }

    this.processor.onEnd(span);
  }

  private markAppRootCandidate(span: Span, parentContext: Context): void {
    const traceId = span.spanContext().traceId;
    const spanId = span.spanContext().spanId;
    const parentSpanId = span.parentSpanContext?.spanId;

    const expectedExportedAtStart = this.isExpectedExportedAtStart(span);
    const propagatedClaim = getLangfuseTraceIdFromBaggage(parentContext);

    const isParentExpectedExported =
      parentSpanId !== undefined
        ? this.spanExportExpectationById.get(parentSpanId) === true
        : false;
    const suppressedByParentClaim = propagatedClaim === traceId;

    this.spanExportExpectationById.set(spanId, expectedExportedAtStart);

    const markAppRoot =
      expectedExportedAtStart &&
      !isParentExpectedExported &&
      !suppressedByParentClaim;

    if (markAppRoot) {
      span.setAttribute(LangfuseOtelSpanAttributes.IS_APP_ROOT, true);
    }
  }

  private isExpectedExportedAtStart(span: Span): boolean {
    // Span (from sdk-trace-base) already implements ReadableSpan, so the cast
    // is safe and avoids depending on private OTel APIs.
    const readable = span as unknown as ReadableSpan;

    try {
      return this.shouldExportSpan({ otelSpan: readable }) === true;
    } catch (err) {
      this.logger.debug(
        "shouldExportSpan threw during app-root start-time check. " +
          "Span will not be marked as app root.",
        {
          spanName: span.name,
          instrumentationScope: readable.instrumentationScope.name,
        },
        err,
      );

      return false;
    }
  }

  private async applyMaskInPlace(span: ReadableSpan): Promise<void> {
    const maskCandidates = [
      LangfuseOtelSpanAttributes.OBSERVATION_INPUT,
      LangfuseOtelSpanAttributes.TRACE_INPUT,
      LangfuseOtelSpanAttributes.OBSERVATION_OUTPUT,
      LangfuseOtelSpanAttributes.TRACE_OUTPUT,
      LangfuseOtelSpanAttributes.OBSERVATION_METADATA,
      LangfuseOtelSpanAttributes.TRACE_METADATA,
    ];

    for (const maskCandidate of maskCandidates) {
      if (maskCandidate in span.attributes) {
        span.attributes[maskCandidate] = await this.applyMask(
          span.attributes[maskCandidate],
        );
      }
    }
  }

  private async applyMask<T>(data: T): Promise<T | string> {
    if (!this.mask) return data;

    try {
      return await this.mask({ data });
    } catch (err) {
      this.logger.warn(
        `Applying mask function failed due to error, fully masking property. Error: ${err}`,
      );

      return "<fully masked due to failed mask function>";
    }
  }
}
