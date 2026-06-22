# @sea-traces/core

Core utilities and generated API client used by the Sea Traces JavaScript SDK
packages.

## Packages

| Package                               | Description                         | Environments |
| ------------------------------------- | ----------------------------------- | ------------ |
| [@sea-traces/client](../client)       | Sea Traces API client               | Universal JS |
| [@sea-traces/tracing](../tracing)     | OpenTelemetry-based tracing helpers | Node.js 20+  |
| [@sea-traces/otel](../otel)           | OpenTelemetry export helpers        | Node.js 20+  |
| [@sea-traces/openai](../openai)       | OpenAI SDK integration              | Universal JS |
| [@sea-traces/langchain](../langchain) | LangChain integration               | Universal JS |

## Required Configuration

User-facing packages require both `SEA_TEAM_KEY` and `SEA_TRACES_BASE_URL`, or
equivalent constructor options `apiKey` and `baseUrl`.

## Documentation

- Root README: ../../README.md
- Auth guide: ../../SEALANGFUSE_AUTH.md

## License

[MIT](LICENSE)
