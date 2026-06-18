import { getEnv } from "./utils.js";

export interface SealangfuseCredentials {
  publicKey: string;
  secretKey: string;
  baseUrl: string;
  status: string;
}

export interface ResolveSealangfuseCredentialsParams {
  apiKey: string;
  baseUrl: string;
  credentialsUrl?: string;
  timeoutSeconds?: number;
}

const credentialsCache = new Map<string, SealangfuseCredentials>();
const credentialsInflight = new Map<string, Promise<SealangfuseCredentials>>();

function maskApiKey(apiKey: string): string {
  if (apiKey.length <= 10) return "<masked>";

  return `${apiKey.slice(0, 6)}...${apiKey.slice(-4)}`;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export function getSealangfuseCredentialsUrl(params: {
  baseUrl: string;
  credentialsUrl?: string;
}): string {
  const credentialsUrl =
    params.credentialsUrl ?? getEnv("SEALANGFUSE_CREDENTIALS_URL");

  if (credentialsUrl) return credentialsUrl;

  return `${trimTrailingSlash(params.baseUrl)}/api/public/sea-project-api-credentials`;
}

function getCacheKey(apiKey: string, credentialsUrl: string): string {
  return `${credentialsUrl}\n${apiKey}`;
}

async function fetchSealangfuseCredentials(
  params: ResolveSealangfuseCredentialsParams,
): Promise<SealangfuseCredentials> {
  const credentialsUrl = getSealangfuseCredentialsUrl(params);
  const url = new URL(credentialsUrl);
  url.searchParams.set("key", params.apiKey);

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    (params.timeoutSeconds ?? 5) * 1_000,
  );
  timeout.unref?.();

  let response: Response;
  try {
    response = await fetch(url, { signal: controller.signal });
  } catch (error) {
    const message = `Failed to resolve Sealangfuse credentials from ${credentialsUrl} for key ${maskApiKey(
      params.apiKey,
    )}: ${error instanceof Error ? error.message : String(error)}`;
    throw new Error(message);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const message = `Failed to resolve Sealangfuse credentials from ${credentialsUrl} for key ${maskApiKey(
      params.apiKey,
    )}: HTTP ${response.status}`;
    throw new Error(message);
  }

  const body = (await response.json()) as Partial<SealangfuseCredentials>;

  if (
    body.status !== "ACTIVE" ||
    !body.publicKey ||
    !body.secretKey ||
    !body.baseUrl
  ) {
    const message = `Invalid Sealangfuse credentials response from ${credentialsUrl} for key ${maskApiKey(
      params.apiKey,
    )}`;
    throw new Error(message);
  }

  return {
    publicKey: body.publicKey,
    secretKey: body.secretKey,
    baseUrl: body.baseUrl,
    status: body.status,
  };
}

export function resolveSealangfuseCredentials(
  params: ResolveSealangfuseCredentialsParams,
): Promise<SealangfuseCredentials> {
  const credentialsUrl = getSealangfuseCredentialsUrl(params);
  const cacheKey = getCacheKey(params.apiKey, credentialsUrl);
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

export function clearSealangfuseCredentialsCache(): void {
  credentialsCache.clear();
  credentialsInflight.clear();
}
