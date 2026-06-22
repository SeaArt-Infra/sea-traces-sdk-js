import {
  LangfuseAPIClient,
  LANGFUSE_SDK_VERSION,
  getGlobalLogger,
  getEnv,
  resolveSealangfuseCredentials,
} from "@sea-traces/core";

import { DatasetManager } from "./dataset/index.js";
import { ExperimentManager } from "./experiment/ExperimentManager.js";
import { MediaManager } from "./media/index.js";
import { PromptManager } from "./prompt/index.js";
import { ScoreManager } from "./score/index.js";

/**
 * Configuration parameters for initializing a LangfuseClient instance.
 *
 * @public
 */
export interface LangfuseClientParams {
  /**
   * Public API key for authentication with Langfuse.
   * Can also be provided via LANGFUSE_PUBLIC_KEY environment variable.
   */
  publicKey?: string;

  /**
   * Secret API key for authentication with Langfuse.
   * Can also be provided via LANGFUSE_SECRET_KEY environment variable.
   */
  secretKey?: string;

  /**
   * Required Sea Traces team key used to resolve Langfuse project credentials.
   * Can also be provided via SEA_TEAM_KEY environment variable.
   */
  apiKey?: string;

  /**
   * Required Sea Traces base URL.
   * Can also be provided via SEA_TRACES_BASE_URL environment variable.
   */
  baseUrl?: string;

  /**
   * Optional override for the Sealangfuse credential resolver endpoint.
   * Can also be provided via SEALANGFUSE_CREDENTIALS_URL environment variable.
   */
  credentialsUrl?: string;

  /**
   * Request timeout in seconds.
   * Can also be provided via LANGFUSE_TIMEOUT environment variable.
   *
   * @defaultValue 5
   */
  timeout?: number;

  /**
   * Additional HTTP headers to include with API requests.
   */
  additionalHeaders?: Record<string, string>;
}

/**
 * Main client for interacting with the Sea Traces API.
 *
 * The LangfuseClient provides access to Sea Traces functionality including:
 * - Prompt management and retrieval
 * - Dataset operations
 * - Score creation and management
 * - Media upload and handling
 * - Direct API access for advanced use cases
 *
 * @example
 * ```typescript
 * // Initialize with explicit credentials
 * const langfuse = new LangfuseClient({
 *   apiKey: "sea-team-key",
 *   baseUrl: "https://your-sea-traces.example.com"
 * });
 *
 * // Or use environment variables
 * const langfuse = new LangfuseClient();
 *
 * // Use the client
 * const prompt = await langfuse.prompt.get("my-prompt");
 * const compiledPrompt = prompt.compile({ variable: "value" });
 * ```
 *
 * @public
 */
function getRequiredConfig(value: string | undefined): string | undefined {
  const trimmed = value?.trim();

  return trimmed ? trimmed : undefined;
}

export class LangfuseClient {
  /**
   * Direct access to the underlying Langfuse API client.
   * Use this for advanced API operations not covered by the high-level managers.
   */
  public api: LangfuseAPIClient;

  /**
   * Manager for prompt operations including creation, retrieval, and caching.
   */
  public prompt: PromptManager;

  /**
   * Manager for dataset operations including retrieval and item linking.
   */
  public dataset: DatasetManager;

  /**
   * Manager for score creation and batch processing.
   */
  public score: ScoreManager;

  /**
   * Manager for media upload and reference resolution.
   */
  public media: MediaManager;

  /**
   * Manager for running experiments on datasets and data items.
   *
   * The experiment manager provides comprehensive functionality for:
   * - Running tasks on datasets or custom data arrays
   * - Evaluating outputs with custom or pre-built evaluators
   * - Tracking experiment runs with automatic tracing
   * - Generating formatted result summaries
   * - Integrating with AutoEvals library evaluators
   *
   * @example Basic experiment execution
   * ```typescript
   * const langfuse = new LangfuseClient({
   *   apiKey: "sea-team-key",
   *   baseUrl: "https://your-sea-traces.example.com"
   * });
   *
   * const result = await langfuse.experiment.run({
   *   name: "Model Evaluation",
   *   description: "Testing model performance on Q&A tasks",
   *   data: [
   *     { input: "What is 2+2?", expectedOutput: "4" },
   *     { input: "What is the capital of France?", expectedOutput: "Paris" }
   *   ],
   *   task: async ({ input }) => {
   *     // Your model/task implementation
   *     const response = await myModel.generate(input);
   *     return response;
   *   },
   *   evaluators: [
   *     async ({ output, expectedOutput }) => ({
   *       name: "exact_match",
   *       value: output.trim().toLowerCase() === expectedOutput.toLowerCase() ? 1 : 0
   *     })
   *   ]
   * });
   *
   * console.log(await result.format());
   * ```
   *
   * @example Using with datasets
   * ```typescript
   * const dataset = await langfuse.dataset.get("my-test-dataset");
   * const result = await dataset.runExperiment({
   *   name: "Production Readiness Test",
   *   task: myTask,
   *   evaluators: [accuracyEvaluator, latencyEvaluator],
   *   runEvaluators: [overallQualityEvaluator]
   * });
   * ```
   *
   * @see {@link ExperimentManager} for detailed API documentation
   * @see {@link ExperimentParams} for configuration options
   * @see {@link ExperimentResult} for result structure
   * @public
   * @since 4.0.0
   */
  public experiment: ExperimentManager;

  private baseUrl: string;
  private projectId: string | null = null;

  /**
   * @deprecated Use prompt.get instead
   */
  public getPrompt: typeof PromptManager.prototype.get;
  /**
   * @deprecated Use prompt.create instead
   */
  public createPrompt: typeof PromptManager.prototype.create;
  /**
   * @deprecated Use prompt.update instead
   */
  public updatePrompt: typeof PromptManager.prototype.update;
  /**
   * @deprecated Use dataset.get instead
   */
  public getDataset: typeof DatasetManager.prototype.get;
  /**
   * @deprecated Use api.trace.get instead
   */
  public fetchTrace: typeof LangfuseAPIClient.prototype.trace.get;
  /**
   * @deprecated Use api.trace.list instead
   */
  public fetchTraces: typeof LangfuseAPIClient.prototype.trace.list;
  /**
   * @deprecated Use api.observations.get instead
   */
  public fetchObservation: typeof LangfuseAPIClient.prototype.legacy.observationsV1.get;
  /**
   * @deprecated Use api.observations.list instead
   */
  public fetchObservations: typeof LangfuseAPIClient.prototype.observations.getMany;
  /**
   * @deprecated Use api.sessions.get instead
   */
  public fetchSessions: typeof LangfuseAPIClient.prototype.sessions.get;
  /**
   * @deprecated Use api.datasets.getRun instead
   */
  public getDatasetRun: typeof LangfuseAPIClient.prototype.datasets.getRun;
  /**
   * @deprecated Use api.datasets.getRuns instead
   */
  public getDatasetRuns: typeof LangfuseAPIClient.prototype.datasets.getRuns;
  /**
   * @deprecated Use api.datasets.create instead
   */
  public createDataset: typeof LangfuseAPIClient.prototype.datasets.create;
  /**
   * @deprecated Use api.datasetItems.get instead
   */
  public getDatasetItem: typeof LangfuseAPIClient.prototype.datasetItems.get;
  /**
   * @deprecated Use api.datasetItems.create instead
   */
  public createDatasetItem: typeof LangfuseAPIClient.prototype.datasetItems.create;
  /**
   * @deprecated Use api.media.get instead
   */
  public fetchMedia: typeof LangfuseAPIClient.prototype.media.get;
  /**
   * @deprecated Use media.resolveReferences instead
   */
  public resolveMediaReferences: typeof MediaManager.prototype.resolveReferences;

  /**
   * Creates a new LangfuseClient instance.
   *
   * @param params - Configuration parameters. If not provided, will use environment variables.
   *
   * @throws When apiKey/SEA_TEAM_KEY or baseUrl/SEA_TRACES_BASE_URL is missing.
   *
   * @example
   * ```typescript
   * // With explicit configuration
   * const client = new LangfuseClient({
   *   apiKey: "sea-team-key",
   *   baseUrl: "https://your-sea-traces.example.com"
   * });
   *
   * // Using environment variables
   * // SEA_TEAM_KEY and SEA_TRACES_BASE_URL must both be set.
   * const client = new LangfuseClient();
   * ```
   */
  constructor(params?: LangfuseClientParams) {
    const logger = getGlobalLogger();

    const publicKey = params?.publicKey ?? getEnv("LANGFUSE_PUBLIC_KEY");
    const secretKey = params?.secretKey ?? getEnv("LANGFUSE_SECRET_KEY");
    const apiKey = getRequiredConfig(params?.apiKey ?? getEnv("SEA_TEAM_KEY"));
    const configuredBaseUrl = getRequiredConfig(
      params?.baseUrl ?? getEnv("SEA_TRACES_BASE_URL"),
    );

    if (!apiKey) {
      throw new Error("SEA_TEAM_KEY or apiKey is required.");
    }

    if (!configuredBaseUrl) {
      throw new Error("SEA_TRACES_BASE_URL or baseUrl is required.");
    }

    this.baseUrl = configuredBaseUrl;

    const timeoutSeconds =
      params?.timeout ?? Number(getEnv("LANGFUSE_TIMEOUT") ?? 5);

    const resolvedCredentials =
      publicKey && secretKey
        ? undefined
        : resolveSealangfuseCredentials({
            apiKey,
            baseUrl: this.baseUrl,
            credentialsUrl: params?.credentialsUrl,
            timeoutSeconds,
          });

    const resolvedPublicKey =
      publicKey ??
      (() => resolvedCredentials?.then((value) => value.publicKey));
    const resolvedSecretKey =
      secretKey ??
      (() => resolvedCredentials?.then((value) => value.secretKey));

    this.api = new LangfuseAPIClient({
      baseUrl: this.baseUrl,
      username: resolvedPublicKey,
      password: resolvedSecretKey,
      xLangfusePublicKey: resolvedPublicKey,
      xLangfuseSdkVersion: LANGFUSE_SDK_VERSION,
      xLangfuseSdkName: "javascript",
      environment: "", // noop as baseUrl is set
      headers: params?.additionalHeaders,
    });

    logger.debug("Initialized LangfuseClient with params:", {
      publicKey,
      hasApiKey: true,
      baseUrl: this.baseUrl,
      timeoutSeconds,
    });

    this.prompt = new PromptManager({ apiClient: this.api });
    this.dataset = new DatasetManager({ langfuseClient: this });
    this.score = new ScoreManager({ apiClient: this.api });
    this.media = new MediaManager({ apiClient: this.api });
    this.experiment = new ExperimentManager({ langfuseClient: this });

    // Keep v3 compat by exposing old interface
    this.getPrompt = this.prompt.get.bind(this.prompt); // keep correct this context for cache access
    this.createPrompt = this.prompt.create.bind(this.prompt);
    this.updatePrompt = this.prompt.update.bind(this.prompt);
    this.getDataset = this.dataset.get;
    this.fetchTrace = this.api.trace.get;
    this.fetchTraces = this.api.trace.list;
    this.fetchObservation = this.api.legacy.observationsV1.get;
    this.fetchObservations = this.api.observations.getMany;
    this.fetchSessions = this.api.sessions.get;
    this.getDatasetRun = this.api.datasets.getRun;
    this.getDatasetRuns = this.api.datasets.getRuns;
    this.createDataset = this.api.datasets.create;
    this.getDatasetItem = this.api.datasetItems.get;
    this.createDatasetItem = this.api.datasetItems.create;
    this.fetchMedia = this.api.media.get;
    this.resolveMediaReferences = this.media.resolveReferences;
  }

  /**
   * Flushes any pending score events to the Langfuse API.
   *
   * This method ensures all queued scores are sent immediately rather than
   * waiting for the automatic flush interval or batch size threshold.
   *
   * @returns Promise that resolves when all pending scores have been sent
   *
   * @example
   * ```typescript
   * langfuse.score.create({ name: "quality", value: 0.8 });
   * await langfuse.flush(); // Ensures the score is sent immediately
   * ```
   */
  public async flush() {
    return this.score.flush();
  }

  /**
   * Gracefully shuts down the client by flushing all pending data.
   *
   * This method should be called before your application exits to ensure
   * all data is sent to Langfuse.
   *
   * @returns Promise that resolves when shutdown is complete
   *
   * @example
   * ```typescript
   * // Before application exit
   * await langfuse.shutdown();
   * ```
   */
  public async shutdown() {
    return this.score.shutdown();
  }

  /**
   * Generates a URL to view a specific trace in the Langfuse UI.
   *
   * @param traceId - The ID of the trace to generate a URL for
   * @returns Promise that resolves to the trace URL
   *
   * @example
   * ```typescript
   * const traceId = "trace-123";
   * const url = await langfuse.getTraceUrl(traceId);
   * console.log(`View trace at: ${url}`);
   * ```
   */
  public async getTraceUrl(traceId: string) {
    let projectId = this.projectId;

    if (!projectId) {
      projectId = (await this.api.projects.get()).data[0].id;
      this.projectId = projectId;
    }

    const traceUrl = `${this.baseUrl}/project/${projectId}/traces/${traceId}`;

    return traceUrl;
  }
}
