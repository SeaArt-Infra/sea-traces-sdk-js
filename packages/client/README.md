# @sea-traces/client

Sea Traces API client for universal JavaScript environments. It contains the
main abstraction around prompts, datasets, and scores.

## Packages

| Package                               | Description                         | Environments |
| ------------------------------------- | ----------------------------------- | ------------ |
| [@sea-traces/client](../client)       | Sea Traces API client               | Universal JS |
| [@sea-traces/tracing](../tracing)     | OpenTelemetry-based tracing helpers | Node.js 20+  |
| [@sea-traces/otel](../otel)           | OpenTelemetry export helpers        | Node.js 20+  |
| [@sea-traces/openai](../openai)       | OpenAI SDK integration              | Universal JS |
| [@sea-traces/langchain](../langchain) | LangChain integration               | Universal JS |

## Required Configuration

For external gateway authentication, set:

```bash
SEA_TRACES_API_KEY=sea-traces-api-key
SEA_TRACES_BASE_URL=https://your-sea-traces.example.com
```

For internal project-based ingestion, set:

```bash
SEATRACES_PROJECT_ID=project-id
SEATRACES_BASE_URL=https://upload.sea-traces.example.com
```

## Unified gateway API

Use `SeaTracesApiClient` with a gateway URL and token. Every request includes
`Authorization: Bearer <token>`.

```ts
const api = new SeaTracesApiClient({
  baseUrl: "https://gateway.example.com",
  token: "token",
});
const projects = await api.listProjects();
const project = await api.createProject("checkout");
await api.updateProject(project.id, "checkout-v2");
await api.ingest(project.id, [
  { type: "trace-create", body: { id: "trace-1", name: "checkout" } },
]);
const traces = await api.listTraces(project.id, { traceId: "trace-1" });
```

For legacy direct upload authentication, set:

```bash
SEATRACES_PUBLIC_KEY=public-upload-key
SEATRACES_SECRET_KEY=secret-upload-key
SEATRACES_BASE_URL=https://upload.sea-traces.example.com
```

## 文档

- 根 README: ../../README.md
- 配置说明: ../../README.md#推荐配置

## License

[MIT](LICENSE)
