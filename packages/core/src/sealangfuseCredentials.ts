import { getEnv } from "./utils.js";

export interface SealangfuseCredentials {
  publicKey: string;
  secretKey: string;
  baseUrl: string;
}

export interface ResolveSealangfuseCredentialsParams {
  apiKey: string;
  baseUrl: string;
  projectId: string;
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
      credentials?: undefined;
    }
  | {
      mode: "gateway";
      publicKey: () => Promise<string>;
      secretKey: () => Promise<string>;
      baseUrl: string;
      credentials: Promise<SealangfuseCredentials>;
    };

const credentialsCache = new Map<string, SealangfuseCredentials>();
const credentialsInflight = new Map<string, Promise<SealangfuseCredentials>>();

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
  projectId?: string;
}): params is {
  apiKey: string;
  baseUrl: string;
  projectId: string;
} {
  return Boolean(params.apiKey && params.baseUrl && params.projectId);
}

function hasAnyGatewayConfig(params: {
  apiKey?: string;
  baseUrl?: string;
  projectId?: string;
}): boolean {
  return Boolean(params.apiKey || params.baseUrl || params.projectId);
}

function incompleteGatewayConfigError(): Error {
  return new Error(
    "Sea Traces gateway authentication requires apiKey, baseUrl, and projectId " +
      "or SEA_TRACES_API_KEY, SEA_TRACES_BASE_URL, and SEA_TRACES_PROJECT_ID.",
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
  projectId: string;
  credentialsUrl: string;
}): string {
  return `${params.credentialsUrl}\n${params.projectId}\n${params.apiKey}`;
}

async function fetchSealangfuseCredentials(
  params: ResolveSealangfuseCredentialsParams,
): Promise<SealangfuseCredentials> {
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
      },
      body: JSON.stringify({
        api_key: params.apiKey,
        base_url: params.baseUrl,
        project_id: params.projectId,
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

  let body: Partial<SealangfuseCredentials>;
  try {
    body = (await response.json()) as Partial<SealangfuseCredentials>;
  } catch (error) {
    const message = `Invalid Sea Traces credentials response from ${credentialsUrl} for key ${maskApiKey(
      params.apiKey,
    )}: ${error instanceof Error ? error.message : String(error)}`;
    throw new Error(message);
  }

  if (!body.publicKey || !body.secretKey || !body.baseUrl) {
    const message = `Invalid Sea Traces credentials response from ${credentialsUrl} for key ${maskApiKey(
      params.apiKey,
    )}`;
    throw new Error(message);
  }

  return {
    publicKey: body.publicKey,
    secretKey: body.secretKey,
    baseUrl: body.baseUrl,
  };
}

export function resolveSealangfuseCredentials(
  params: ResolveSealangfuseCredentialsParams,
): Promise<SealangfuseCredentials> {
  const credentialsUrl = getSealangfuseCredentialsUrl(params);
  const cacheKey = getCacheKey({
    apiKey: params.apiKey,
    projectId: params.projectId,
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
    projectId: getRequiredConfig(params.projectId),
  };

  if (
    hasAnyGatewayConfig(gatewayConfig) &&
    !hasCompleteGatewayConfig(gatewayConfig)
  ) {
    throw incompleteGatewayConfigError();
  }

  if (hasCompleteGatewayConfig(gatewayConfig)) {
    const credentials = resolveSealangfuseCredentials({
      apiKey: gatewayConfig.apiKey,
      baseUrl: gatewayConfig.baseUrl,
      projectId: gatewayConfig.projectId,
      credentialsUrl: params.credentialsUrl,
      timeoutSeconds: params.timeoutSeconds,
    });

    return {
      mode: "gateway",
      publicKey: () => credentials.then((value) => value.publicKey),
      secretKey: () => credentials.then((value) => value.secretKey),
      baseUrl: gatewayConfig.baseUrl,
      credentials,
    };
  }

  const gatewayEnvConfig = {
    apiKey: getRequiredConfig(getEnv("SEA_TRACES_API_KEY")),
    baseUrl: getRequiredConfig(getEnv("SEA_TRACES_BASE_URL")),
    projectId: getRequiredConfig(getEnv("SEA_TRACES_PROJECT_ID")),
  };

  if (
    hasAnyGatewayConfig(gatewayEnvConfig) &&
    !hasCompleteGatewayConfig(gatewayEnvConfig)
  ) {
    throw incompleteGatewayConfigError();
  }

  if (hasCompleteGatewayConfig(gatewayEnvConfig)) {
    const credentials = resolveSealangfuseCredentials({
      apiKey: gatewayEnvConfig.apiKey,
      baseUrl: gatewayEnvConfig.baseUrl,
      projectId: gatewayEnvConfig.projectId,
      credentialsUrl: params.credentialsUrl,
      timeoutSeconds: params.timeoutSeconds,
    });

    return {
      mode: "gateway",
      publicKey: () => credentials.then((value) => value.publicKey),
      secretKey: () => credentials.then((value) => value.secretKey),
      baseUrl: gatewayEnvConfig.baseUrl,
      credentials,
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
      "SEATRACES_SECRET_KEY, SEATRACES_BASE_URL) or complete gateway " +
      "credentials (apiKey, baseUrl, projectId or SEA_TRACES_API_KEY, " +
      "SEA_TRACES_BASE_URL, SEA_TRACES_PROJECT_ID).",
  );
}

export function clearSealangfuseCredentialsCache(): void {
  credentialsCache.clear();
  credentialsInflight.clear();
}
