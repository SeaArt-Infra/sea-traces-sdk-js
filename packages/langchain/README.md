# @sea-traces/langchain

LangChain integration for Sea Traces.

## Packages

| Package                               | Description                         | Environments |
| ------------------------------------- | ----------------------------------- | ------------ |
| [@sea-traces/client](../client)       | Sea Traces API client               | Universal JS |
| [@sea-traces/tracing](../tracing)     | OpenTelemetry-based tracing helpers | Node.js 20+  |
| [@sea-traces/otel](../otel)           | OpenTelemetry export helpers        | Node.js 20+  |
| [@sea-traces/openai](../openai)       | OpenAI SDK integration              | Universal JS |
| [@sea-traces/langchain](../langchain) | LangChain integration               | Universal JS |

## Required Configuration

Set both values before using the callback handler, or pass them as `apiKey` and
`baseUrl` options where the integration accepts SDK configuration.

```bash
SEA_TEAM_KEY=sea-team-key
SEA_TRACES_BASE_URL=https://your-sea-traces.example.com
```

## 文档

- 根 README: ../../README.md
- 配置说明: ../../README.md#推荐配置

## License

[MIT](LICENSE)
