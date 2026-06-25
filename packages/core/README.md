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

User-facing packages require one of:

- internal project configuration (`SEATRACES_PROJECT_ID`,
  `SEATRACES_BASE_URL`)
- gateway credentials (`SEA_TRACES_API_KEY`, `SEA_TRACES_BASE_URL`)
- legacy direct upload credentials (`SEATRACES_PUBLIC_KEY`,
  `SEATRACES_SECRET_KEY`, `SEATRACES_BASE_URL`)

## 文档

- 根 README: ../../README.md
- 配置说明: ../../README.md#推荐配置

## License

[MIT](LICENSE)
