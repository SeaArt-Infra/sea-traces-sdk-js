<img width="2400" height="600" alt="hero-b" src="https://github.com/user-attachments/assets/0d06e77e-6f4a-4ae3-8aee-7d3463a6f98c" />

# Sea Traces JS/TS SDK

[![MIT License](https://img.shields.io/badge/License-MIT-red.svg?style=flat-square)](https://opensource.org/licenses/MIT)

Modular mono repo for the Sea Traces JavaScript and TypeScript SDK packages. The SDK keeps the existing Langfuse tracing/export pipeline internally while exposing Sea Traces package names and configuration.

## Packages

| Package                                       | Description                                                 | Environments |
| --------------------------------------------- | ----------------------------------------------------------- | ------------ |
| [@sea-traces/client](./packages/client)       | Sea Traces API client for universal JavaScript environments | Universal JS |
| [@sea-traces/tracing](./packages/tracing)     | Sea Traces instrumentation methods based on OpenTelemetry   | Node.js 20+  |
| [@sea-traces/otel](./packages/otel)           | Sea Traces OpenTelemetry export helpers                     | Node.js 20+  |
| [@sea-traces/openai](./packages/openai)       | Sea Traces integration for OpenAI SDK                       | Universal JS |
| [@sea-traces/langchain](./packages/langchain) | Sea Traces integration for LangChain                        | Universal JS |

## Configuration

The SDK requires both values at initialization time:

```bash
SEA_TEAM_KEY=sea-team-key
SEA_TRACES_BASE_URL=https://your-sea-traces.example.com
```

Equivalent constructor fields are supported:

```ts
import { LangfuseClient } from "@sea-traces/client";

const client = new LangfuseClient({
  apiKey: "sea-team-key",
  baseUrl: "https://your-sea-traces.example.com",
});
```

Legacy `SEALANGFUSE_API_KEY`, `LANGFUSE_BASE_URL`, and Langfuse Cloud defaults do not enable the renamed SDK by themselves.

## Development

This is a monorepo managed with pnpm. See [CONTRIBUTING.md](./CONTRIBUTING.md) for development instructions.

```bash
pnpm install
pnpm build
pnpm test
pnpm ci
```

## License

[MIT](LICENSE)
