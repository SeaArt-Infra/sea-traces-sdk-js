# Sealangfuse API Key 使用指南

本文档说明如何在 JavaScript/TypeScript SDK 中使用 `sa-xxx` 形式的 Sealangfuse API Key 上报数据。用户不需要再传 `LANGFUSE_PUBLIC_KEY` 和 `LANGFUSE_SECRET_KEY`，SDK 会在初始化或首次导出时根据 `sa key` 和 `baseUrl` 自动解析出 Langfuse 项目凭证。

## 适用包

本文档覆盖以下包：

- `@langfuse/client`
- `@langfuse/otel`
- `@langfuse/tracing`
- `@langfuse/core`

其中 `@langfuse/client` 用于平台 API、prompt、dataset、score 等能力；`@langfuse/otel` 和 `@langfuse/tracing` 用于 trace、span、generation 等观测数据上报。

## 推荐配置

生产和测试环境都必须显式传入 `LANGFUSE_BASE_URL`。不要只传 `sa key`，因为同一个 `sa key` 可能在测试环境和生产环境中相同，SDK 需要根据 `baseUrl` 判断要向哪个 Sealangfuse 服务解析凭证并上报数据。

```bash
export SEALANGFUSE_API_KEY="sa-xxx"
export LANGFUSE_BASE_URL="https://sealangfuse-web.example.com"
```

如果部署环境的凭证查询接口不是默认路径，可以额外指定：

```bash
export SEALANGFUSE_CREDENTIALS_URL="https://sealangfuse-web.example.com/api/public/sea-project-api-credentials"
```

默认情况下 SDK 会请求：

```text
GET {LANGFUSE_BASE_URL}/api/public/sea-project-api-credentials?key={SEALANGFUSE_API_KEY}
```

## OpenTelemetry 上报示例

```ts
import { NodeSDK } from "@opentelemetry/sdk-node";
import { trace } from "@opentelemetry/api";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import { propagateAttributes, startActiveObservation } from "@langfuse/tracing";

const spanProcessor = new LangfuseSpanProcessor({
  exportMode: "immediate",
  timeout: 15,
});

const sdk = new NodeSDK({
  spanProcessors: [spanProcessor],
  instrumentations: [],
});

sdk.start();

await propagateAttributes(
  {
    traceName: "js-sdk-demo",
    userId: "user-123",
    sessionId: "session-123",
    tags: ["demo", "sealangfuse"],
    metadata: { source: "sealangfuse-auth-demo" },
  },
  async () => {
    await startActiveObservation("root-span", async (span) => {
      span.update({
        input: { prompt: "ping" },
        output: { answer: "pong" },
      });
    });
  },
);

await spanProcessor.forceFlush();
await sdk.shutdown();
trace.disable();
```

`LangfuseSpanProcessor` 会从环境变量读取 `SEALANGFUSE_API_KEY` 和 `LANGFUSE_BASE_URL`。在没有显式传 `publicKey` 和 `secretKey` 时，它会解析项目凭证并创建真正的 OTLP exporter。

## 显式传参

如果不想依赖环境变量，可以传入 `apiKey` 和 `baseUrl`：

```ts
import { LangfuseSpanProcessor } from "@langfuse/otel";

const spanProcessor = new LangfuseSpanProcessor({
  apiKey: "sa-xxx",
  baseUrl: "https://sealangfuse-web.example.com",
  exportMode: "batched",
});
```

如果 resolver 地址需要覆盖：

```ts
const spanProcessor = new LangfuseSpanProcessor({
  apiKey: "sa-xxx",
  baseUrl: "https://sealangfuse-web.example.com",
  credentialsUrl:
    "https://sealangfuse-web.example.com/api/public/sea-project-api-credentials",
});
```

## 使用 LangfuseClient

`LangfuseClient` 也支持 `apiKey`，适合调用 prompt、dataset、score、media 等 API。

```ts
import { LangfuseClient } from "@langfuse/client";

const langfuse = new LangfuseClient({
  apiKey: "sa-xxx",
  baseUrl: "https://sealangfuse-web.example.com",
});

const prompts = await langfuse.api.prompts.list();
```

也可以完全依赖环境变量：

```ts
import { LangfuseClient } from "@langfuse/client";

const langfuse = new LangfuseClient();
const project = await langfuse.api.projects.get();
```

## 查询服务端数据

如果业务中需要直接使用底层 API client，可以通过 `@langfuse/core` 的 resolver 获取临时项目凭证：

```ts
import {
  LangfuseAPIClient,
  resolveSealangfuseCredentials,
} from "@langfuse/core";

const baseUrl = process.env.LANGFUSE_BASE_URL!;
const credentials = await resolveSealangfuseCredentials({
  apiKey: process.env.SEALANGFUSE_API_KEY!,
  baseUrl,
});

const apiClient = new LangfuseAPIClient({
  baseUrl,
  username: credentials.publicKey,
  password: credentials.secretKey,
  xLangfusePublicKey: credentials.publicKey,
  xLangfuseSdkName: "javascript",
  xLangfuseSdkVersion: "custom",
  environment: "",
});

const traces = await apiClient.trace.list({ limit: 10 });
```

不要把解析出的 `secretKey` 打到日志里。

## 配置优先级

SDK 按以下顺序选择认证方式：

1. 显式传入 `publicKey`、`secretKey`、`baseUrl`
2. 环境变量 `LANGFUSE_PUBLIC_KEY`、`LANGFUSE_SECRET_KEY`、`LANGFUSE_BASE_URL`
3. 显式传入 `apiKey`、`baseUrl`
4. 环境变量 `SEALANGFUSE_API_KEY`、`LANGFUSE_BASE_URL`

只要 public key 和 secret key 已经存在，SDK 不会调用 Sealangfuse 凭证查询接口。

## SDK 内部流程

`@langfuse/client` 的构造函数保持同步。进入 sa key 路径时，SDK 会把凭证解析 Promise 作为 API client 的 header supplier，真正发请求前等待解析结果。

`@langfuse/otel` 的 `LangfuseSpanProcessor` 会创建一个 lazy exporter。第一次导出 span 时，它会等待凭证解析，然后创建并复用真正的 `OTLPTraceExporter`。如果没有任何 span 被导出，`forceFlush()` 和 `shutdown()` 不会额外请求 resolver。

解析流程如下：

1. 读取 `apiKey` 或 `SEALANGFUSE_API_KEY`
2. 读取 `baseUrl` 或 `LANGFUSE_BASE_URL`
3. 拼出默认 resolver 地址，或使用 `credentialsUrl` / `SEALANGFUSE_CREDENTIALS_URL`
4. 请求 resolver 获取 `publicKey`、`secretKey`、`baseUrl`、`status`
5. 校验 `status == "ACTIVE"`，并要求 `publicKey`、`secretKey`、`baseUrl` 非空
6. 使用解析出的 `publicKey` 和 `secretKey` 初始化原有 Langfuse API client 或 OTEL exporter
7. 最终上报地址仍使用用户传入的 `baseUrl`

resolver 返回的 `baseUrl` 只用于校验，不会覆盖用户传入的 `baseUrl`。

## 缓存和并发

SDK 不会每次上报都查询 resolver。凭证只会在初始化或首次导出阶段解析，并且有进程内缓存。

缓存 key 为：

```text
(sa_key, credentials_url)
```

同一进程内多个客户端并发使用相同 `sa key` 和 resolver 地址时，SDK 会复用同一个 Promise，只有第一个调用实际访问 resolver，其他调用等待同一个结果。

## 错误处理

常见错误和处理方式：

| 错误                       | 原因                                  | 处理                                                       |
| -------------------------- | ------------------------------------- | ---------------------------------------------------------- |
| `SEALANGFUSE_API_KEY` 缺失 | 未配置 sa key                         | 设置 `SEALANGFUSE_API_KEY` 或显式传 `apiKey`               |
| `LANGFUSE_BASE_URL` 缺失   | 使用 sa key 时没有指定环境            | 设置 `LANGFUSE_BASE_URL` 或显式传 `baseUrl`                |
| resolver 返回非 2xx        | 凭证查询接口不可达或服务异常          | 检查 `LANGFUSE_BASE_URL`、网络和 Sealangfuse 服务状态      |
| `status` 不是 `ACTIVE`     | sa key 未启用或映射不可用             | 检查 Sealangfuse 项目凭证状态                              |
| 查询不到 trace             | 数据未 flush 或 base URL 指向错误环境 | 调用 `forceFlush()`/`shutdown()`，确认 `LANGFUSE_BASE_URL` |

日志和异常信息会对 `sa key` 做脱敏处理，不会输出完整 `sa key` 或 `secretKey`。

## 从旧配置迁移

旧方式：

```bash
export LANGFUSE_PUBLIC_KEY="pk-lf-xxx"
export LANGFUSE_SECRET_KEY="sk-lf-xxx"
export LANGFUSE_BASE_URL="https://sealangfuse-web.example.com"
```

新方式：

```bash
export SEALANGFUSE_API_KEY="sa-xxx"
export LANGFUSE_BASE_URL="https://sealangfuse-web.example.com"
```

旧代码中如果显式传了 public key 和 secret key：

```ts
new LangfuseSpanProcessor({
  publicKey: "pk-lf-xxx",
  secretKey: "sk-lf-xxx",
  baseUrl: "https://sealangfuse-web.example.com",
});
```

可以改成：

```ts
new LangfuseSpanProcessor({
  apiKey: "sa-xxx",
  baseUrl: "https://sealangfuse-web.example.com",
});
```

## 安全建议

- 不要把 `SEALANGFUSE_API_KEY` 提交到 Git。
- 不要在日志里打印完整 `sa key`、`publicKey`、`secretKey`。
- 测试环境和生产环境都显式配置 `LANGFUSE_BASE_URL`。
- 浏览器环境不要暴露 server-side `sa key`；在服务端完成上报或通过后端代理转发。
