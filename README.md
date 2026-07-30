# Sea Traces JavaScript SDK

The Sea Traces JavaScript/TypeScript monorepo provides tracing, OpenTelemetry
export, integrations, and a gateway-authenticated project API client.

## Packages

| Package                 | Purpose                                |
| ----------------------- | -------------------------------------- |
| `@sea-traces/client`    | Universal client and project/trace API |
| `@sea-traces/tracing`   | OpenTelemetry tracing helpers          |
| `@sea-traces/otel`      | OpenTelemetry exporter                 |
| `@sea-traces/openai`    | OpenAI integration                     |
| `@sea-traces/langchain` | LangChain integration                  |

## Gateway API

```ts
import { SeaTracesApiClient } from "@sea-traces/client";

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

All requests use `Authorization: Bearer <token>`. Trace queries accept
`traceId`, `fromTimestamp`, `toTimestamp`, `page`, and `limit`. Without a time
range, the server queries the most recent 24 hours.

## Development

```bash
pnpm install
pnpm build
pnpm test
pnpm lint
```

Do not commit or log bearer tokens. See
[`docs/sea-traces-sdk-js-skill.md`](docs/sea-traces-sdk-js-skill.md) for
agent-assisted usage guidance.

## License

[MIT](LICENSE)
