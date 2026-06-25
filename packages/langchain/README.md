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

For external gateway authentication, set these values before using the callback
handler, or pass `apiKey` and `baseUrl` where the integration accepts SDK
configuration.

```bash
SEA_TRACES_API_KEY=sea-traces-api-key
SEA_TRACES_BASE_URL=https://your-sea-traces.example.com
```

Internal project-based ingestion:

```bash
SEATRACES_PROJECT_ID=project-id
SEATRACES_BASE_URL=https://upload.sea-traces.example.com
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
