import { getEnv } from "./utils.js";

export interface SealangfuseCredentials {
  publicKey: string;
  secretKey: string;
  baseUrl: string;
}

export interface SeaTracesProject {
  projectId: string;
  baseUrl: string;
}

export interface ResolveSealangfuseCredentialsParams {
  apiKey: string;
  baseUrl: string;
  credentialsUrl?: string;
  timeoutSeconds?: number;
}

export interface ResolveSeaTracesAuthParams {
  publicKey?: string;
  secretKey?: string;
  baseUrl?: string;
  apiKey?: string;
  projectId?: string;
  credentialsUrl?: string;
  timeoutSeconds?: number;
}

export type SeaTracesAuth =
  | {
      mode: "direct" | "legacy-direct";
      publicKey: string;
      secretKey: string;
      baseUrl: string;
      projectId?: undefined;
      project?: undefined;
      credentials?: undefined;
    }
  | {
      mode: "project";
      baseUrl: string;
      projectId: string;
      publicKey?: undefined;
      secretKey?: undefined;
      project?: undefined;
      credentials?: undefined;
    }
  | {
      mode: "gateway";
      projectId: () => Promise<string>;
      baseUrl: string;
      project: () => Promise<SeaTracesProject>;
      publicKey?: undefined;
      secretKey?: undefined;
      credentials?: undefined;
    };

const credentialsCache = new Map<string, SeaTracesProject>();
const credentialsInflight = new Map<string, Promise<SeaTracesProject>>();

function maskApiKey(apiKey: string): string {
  if (apiKey.length <= 10) return "<masked>";

  return `${apiKey.slice(0, 6)}...${apiKey.slice(-4)}`;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function getRequiredConfig(value: string | undefined): string | undefined {
  const trimmed = value?.trim();

  return trimmed ? trimmed : undefined;
}

function hasCompleteDirectConfig(params: {
  publicKey?: string;
  secretKey?: string;
  baseUrl?: string;
}): params is {
  publicKey: string;
  secretKey: string;
  baseUrl: string;
} {
  return Boolean(params.publicKey && params.secretKey && params.baseUrl);
}

function hasAnyDirectConfig(params: {
  publicKey?: string;
  secretKey?: string;
  baseUrl?: string;
}): boolean {
  return Boolean(params.publicKey || params.secretKey || params.baseUrl);
}

function hasCompleteGatewayConfig(params: {
  apiKey?: string;
  baseUrl?: string;
}): params is {
  apiKey: string;
  baseUrl: string;
} {
  return Boolean(params.apiKey && params.baseUrl);
}

function hasAnyGatewayConfig(params: {
  apiKey?: string;
  baseUrl?: string;
  projectId?: string;
}): boolean {
  return Boolean(params.apiKey);
}

function incompleteGatewayConfigError(): Error {
  return new Error(
    "Sea Traces gateway authentication requires apiKey and baseUrl " +
      "or SEA_TRACES_API_KEY and SEA_TRACES_BASE_URL.",
  );
}

export function getSealangfuseCredentialsUrl(params: {
  baseUrl: string;
  credentialsUrl?: string;
}): string {
  if (params.credentialsUrl) return params.credentialsUrl;

  return `${trimTrailingSlash(params.baseUrl)}/hub/sea-traces-api-key`;
}

function getCacheKey(params: {
  apiKey: string;
  credentialsUrl: string;
}): string {
  return `${params.credentialsUrl}\n${params.apiKey}`;
}

function createLazyProjectResolver(
  params: ResolveSealangfuseCredentialsParams,
): () => Promise<SeaTracesProject> {
  let project: Promise<SeaTracesProject> | undefined;

  return () => {
    project ??= resolveSealangfuseCredentials(params);

    return project;
  };
}

async function fetchSealangfuseCredentials(
  params: ResolveSealangfuseCredentialsParams,
): Promise<SeaTracesProject> {
  const credentialsUrl = getSealangfuseCredentialsUrl(params);
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    (params.timeoutSeconds ?? 5) * 1_000,
  );
  timeout.unref?.();

  let response: Response;
  try {
    response = await fetch(credentialsUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        api_key: params.apiKey,
        base_url: params.baseUrl,
      }),
      signal: controller.signal,
    });
  } catch (error) {
    const message = `Failed to resolve Sea Traces credentials from ${credentialsUrl} for key ${maskApiKey(
      params.apiKey,
    )}: ${error instanceof Error ? error.message : String(error)}`;
    throw new Error(message);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const message = `Failed to resolve Sea Traces credentials from ${credentialsUrl} for key ${maskApiKey(
      params.apiKey,
    )}: HTTP ${response.status}`;
    throw new Error(message);
  }

  let body: { project_id?: string; base_url?: string };
  try {
    body = (await response.json()) as {
      project_id?: string;
      base_url?: string;
    };
  } catch (error) {
    const message = `Invalid Sea Traces credentials response from ${credentialsUrl} for key ${maskApiKey(
      params.apiKey,
    )}: ${error instanceof Error ? error.message : String(error)}`;
    throw new Error(message);
  }

  const projectId = getRequiredConfig(body.project_id);
  const baseUrl = getRequiredConfig(body.base_url);

  if (!projectId || !baseUrl) {
    const message = `Invalid Sea Traces credentials response from ${credentialsUrl} for key ${maskApiKey(
      params.apiKey,
    )}`;
    throw new Error(message);
  }

  return {
    projectId,
    baseUrl,
  };
}

export function resolveSealangfuseCredentials(
  params: ResolveSealangfuseCredentialsParams,
): Promise<SeaTracesProject> {
  const credentialsUrl = getSealangfuseCredentialsUrl(params);
  const cacheKey = getCacheKey({
    apiKey: params.apiKey,
    credentialsUrl,
  });
  const cached = credentialsCache.get(cacheKey);

  if (cached) return Promise.resolve(cached);

  const inflight = credentialsInflight.get(cacheKey);
  if (inflight) return inflight;

  const promise = fetchSealangfuseCredentials({
    ...params,
    credentialsUrl,
  })
    .then((credentials) => {
      credentialsCache.set(cacheKey, credentials);
      return credentials;
    })
    .finally(() => credentialsInflight.delete(cacheKey));

  credentialsInflight.set(cacheKey, promise);

  return promise;
}

export function resolveSeaTracesAuth(
  params: ResolveSeaTracesAuthParams = {},
): SeaTracesAuth {
  const directConfig = {
    publicKey: getRequiredConfig(params.publicKey),
    secretKey: getRequiredConfig(params.secretKey),
    baseUrl: getRequiredConfig(params.baseUrl),
  };

  if (hasCompleteDirectConfig(directConfig)) {
    return {
      mode: "direct",
      publicKey: directConfig.publicKey,
      secretKey: directConfig.secretKey,
      baseUrl: directConfig.baseUrl,
    };
  }

  const directEnvConfig = {
    publicKey: getRequiredConfig(getEnv("SEATRACES_PUBLIC_KEY")),
    secretKey: getRequiredConfig(getEnv("SEATRACES_SECRET_KEY")),
    baseUrl: getRequiredConfig(getEnv("SEATRACES_BASE_URL")),
  };

  if (hasCompleteDirectConfig(directEnvConfig)) {
    return {
      mode: "direct",
      publicKey: directEnvConfig.publicKey,
      secretKey: directEnvConfig.secretKey,
      baseUrl: directEnvConfig.baseUrl,
    };
  }

  const gatewayConfig = {
    apiKey: getRequiredConfig(params.apiKey),
    baseUrl: getRequiredConfig(params.baseUrl),
  };

  if (
    hasAnyGatewayConfig(gatewayConfig) &&
    !hasCompleteGatewayConfig(gatewayConfig)
  ) {
    throw incompleteGatewayConfigError();
  }

  if (hasCompleteGatewayConfig(gatewayConfig)) {
    const project = createLazyProjectResolver({
      apiKey: gatewayConfig.apiKey,
      baseUrl: gatewayConfig.baseUrl,
      credentialsUrl: params.credentialsUrl,
      timeoutSeconds: params.timeoutSeconds,
    });

    return {
      mode: "gateway",
      projectId: () => project().then((value) => value.projectId),
      baseUrl: gatewayConfig.baseUrl,
      project,
    };
  }

  const projectConfig = {
    projectId: getRequiredConfig(params.projectId),
    baseUrl: getRequiredConfig(params.baseUrl),
  };

  if (projectConfig.projectId && projectConfig.baseUrl) {
    return {
      mode: "project",
      projectId: projectConfig.projectId,
      baseUrl: projectConfig.baseUrl,
    };
  }

  const projectEnvConfig = {
    projectId: getRequiredConfig(getEnv("SEATRACES_PROJECT_ID")),
    baseUrl: getRequiredConfig(getEnv("SEATRACES_BASE_URL")),
  };

  if (projectEnvConfig.projectId && projectEnvConfig.baseUrl) {
    return {
      mode: "project",
      projectId: projectEnvConfig.projectId,
      baseUrl: projectEnvConfig.baseUrl,
    };
  }

  const gatewayEnvConfig = {
    apiKey: getRequiredConfig(getEnv("SEA_TRACES_API_KEY")),
    baseUrl: getRequiredConfig(getEnv("SEA_TRACES_BASE_URL")),
  };

  if (
    hasAnyGatewayConfig(gatewayEnvConfig) &&
    !hasCompleteGatewayConfig(gatewayEnvConfig)
  ) {
    throw incompleteGatewayConfigError();
  }

  if (hasCompleteGatewayConfig(gatewayEnvConfig)) {
    const project = createLazyProjectResolver({
      apiKey: gatewayEnvConfig.apiKey,
      baseUrl: gatewayEnvConfig.baseUrl,
      credentialsUrl: params.credentialsUrl,
      timeoutSeconds: params.timeoutSeconds,
    });

    return {
      mode: "gateway",
      projectId: () => project().then((value) => value.projectId),
      baseUrl: gatewayEnvConfig.baseUrl,
      project,
    };
  }

  const legacyDirectEnvConfig = {
    publicKey: getRequiredConfig(getEnv("LANGFUSE_PUBLIC_KEY")),
    secretKey: getRequiredConfig(getEnv("LANGFUSE_SECRET_KEY")),
    baseUrl: getRequiredConfig(
      getEnv("LANGFUSE_BASE_URL") ?? getEnv("LANGFUSE_BASEURL"),
    ),
  };

  if (
    !hasAnyDirectConfig(directConfig) &&
    !hasAnyDirectConfig(directEnvConfig) &&
    hasCompleteDirectConfig(legacyDirectEnvConfig)
  ) {
    return {
      mode: "legacy-direct",
      publicKey: legacyDirectEnvConfig.publicKey,
      secretKey: legacyDirectEnvConfig.secretKey,
      baseUrl: legacyDirectEnvConfig.baseUrl,
    };
  }

  throw new Error(
    "Sea Traces authentication requires complete direct credentials " +
      "(publicKey, secretKey, baseUrl or SEATRACES_PUBLIC_KEY, " +
      "SEATRACES_SECRET_KEY, SEATRACES_BASE_URL), internal project " +
      "configuration (projectId, baseUrl or SEATRACES_PROJECT_ID, " +
      "SEATRACES_BASE_URL), or gateway credentials (apiKey, baseUrl or " +
      "SEA_TRACES_API_KEY, SEA_TRACES_BASE_URL).",
  );
}

export function clearSealangfuseCredentialsCache(): void {
  credentialsCache.clear();
  credentialsInflight.clear();
}
