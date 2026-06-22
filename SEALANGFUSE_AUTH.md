# Sea Traces JS/TS SDK Auth Guide

The Sea Traces JavaScript/TypeScript SDK uses a team key plus a Sea Traces base URL. Users do not pass Langfuse public and secret keys directly for normal SDK initialization. The SDK resolves project credentials once, then reuses the existing Langfuse ingestion/export pipeline internally.

## Required configuration

```bash
export SEA_TEAM_KEY="sea-team-key"
export SEA_TRACES_BASE_URL="https://sea-traces.example.com"
```

Optional resolver override:

```bash
export SEALANGFUSE_CREDENTIALS_URL="https://sea-traces.example.com/api/public/sea-project-api-credentials"
```

The default resolver request is:

```text
GET {SEA_TRACES_BASE_URL}/api/public/sea-project-api-credentials?key={SEA_TEAM_KEY}
```

`SEALANGFUSE_API_KEY`, `LANGFUSE_BASE_URL`, `LANGFUSE_BASEURL`, and the default Langfuse Cloud URL do not enable the renamed SDK by themselves.

## Client usage

```ts
import { LangfuseClient } from "@sea-traces/client";

const client = new LangfuseClient({
  apiKey: "sea-team-key",
  baseUrl: "https://sea-traces.example.com",
});

const project = await client.api.projects.get();
```

Environment-based initialization is equivalent:

```ts
import { LangfuseClient } from "@sea-traces/client";

const client = new LangfuseClient();
```

## OpenTelemetry usage

```ts
import { LangfuseSpanProcessor } from "@sea-traces/otel";

const processor = new LangfuseSpanProcessor({
  apiKey: "sea-team-key",
  baseUrl: "https://sea-traces.example.com",
});
```

## Internal flow

1. Read `apiKey` or `SEA_TEAM_KEY`.
2. Read `baseUrl` or `SEA_TRACES_BASE_URL`.
3. Fail initialization if either value is missing or blank.
4. Resolve credentials from `{baseUrl}/api/public/sea-project-api-credentials`, unless `credentialsUrl` or `SEALANGFUSE_CREDENTIALS_URL` overrides it.
5. Require `status == "ACTIVE"` and non-empty `publicKey`, `secretKey`, and `baseUrl` in the response.
6. Use the resolved public/secret key for the existing API client or OTLP exporter.
7. Keep the user-provided `baseUrl` as the final ingest/export base URL.

The resolver response `baseUrl` is validated but does not override the user-provided Sea Traces base URL.

## Cache and concurrency

Credential resolution is cached in-process by `(team_key, credentials_url)`. Concurrent callers for the same cache key share one in-flight resolver request.

## Safety

Do not commit `SEA_TEAM_KEY` or `.env` files. Do not log full team keys, resolved `secretKey`, or raw credential responses.
