# Sea Traces JS/TS SDK

[MIT License](https://opensource.org/licenses/MIT)

Sea Traces JavaScript / TypeScript SDK monorepo，提供统一的 trace 采集和导出能力，对外暴露 Sea Traces 包名、客户端和配置方式。

## 安装

当前 Sea Traces JS/TS 包只能通过 GitHub 仓库地址安装，暂不从 npm registry
安装。由于仓库内部包之间使用 `workspace:^` 依赖，业务项目需要在 `package.json`
里用 `pnpm.overrides` 把内部依赖也指向同一个 GitHub 仓库。

主客户端包：

```json
{
  "dependencies": {
    "@sea-traces/client": "git+https://github.com/SeaArt-Infra/sea-traces-sdk-js.git#path:/packages/client"
  },
  "pnpm": {
    "overrides": {
      "@sea-traces/core": "git+https://github.com/SeaArt-Infra/sea-traces-sdk-js.git#path:/packages/core",
      "@sea-traces/tracing": "git+https://github.com/SeaArt-Infra/sea-traces-sdk-js.git#path:/packages/tracing"
    }
  }
}
```

OpenTelemetry 导出辅助包：

```json
{
  "dependencies": {
    "@sea-traces/otel": "git+https://github.com/SeaArt-Infra/sea-traces-sdk-js.git#path:/packages/otel"
  },
  "pnpm": {
    "overrides": {
      "@sea-traces/core": "git+https://github.com/SeaArt-Infra/sea-traces-sdk-js.git#path:/packages/core"
    }
  }
}
```

集成包需要同时安装对应 integration package 和它依赖的 Sea Traces 内部包：

```json
{
  "dependencies": {
    "@sea-traces/openai": "git+https://github.com/SeaArt-Infra/sea-traces-sdk-js.git#path:/packages/openai"
  },
  "pnpm": {
    "overrides": {
      "@sea-traces/core": "git+https://github.com/SeaArt-Infra/sea-traces-sdk-js.git#path:/packages/core",
      "@sea-traces/tracing": "git+https://github.com/SeaArt-Infra/sea-traces-sdk-js.git#path:/packages/tracing"
    }
  }
}
```

LangChain 集成：

```json
{
  "dependencies": {
    "@sea-traces/langchain": "git+https://github.com/SeaArt-Infra/sea-traces-sdk-js.git#path:/packages/langchain"
  },
  "pnpm": {
    "overrides": {
      "@sea-traces/core": "git+https://github.com/SeaArt-Infra/sea-traces-sdk-js.git#path:/packages/core",
      "@sea-traces/tracing": "git+https://github.com/SeaArt-Infra/sea-traces-sdk-js.git#path:/packages/tracing"
    }
  }
}
```

配置完成后执行：

```bash
pnpm install
```

## 包列表

| Package                                       | 说明                                               | 运行环境     |
| --------------------------------------------- | -------------------------------------------------- | ------------ |
| [@sea-traces/client](./packages/client)       | 适用于通用 JavaScript 环境的 Sea Traces API 客户端 | Universal JS |
| [@sea-traces/tracing](./packages/tracing)     | 基于 OpenTelemetry 的 Sea Traces tracing 方法      | Node.js 20+  |
| [@sea-traces/otel](./packages/otel)           | Sea Traces OpenTelemetry 导出辅助包                | Node.js 20+  |
| [@sea-traces/openai](./packages/openai)       | OpenAI SDK 集成                                    | Universal JS |
| [@sea-traces/langchain](./packages/langchain) | LangChain 集成                                     | Universal JS |

## 适用版本

支持以下配置的 SDK 版本可使用本文档中的方式：

- 环境变量：`SEA_TEAM_KEY`、`SEA_TRACES_BASE_URL`
- 构造参数：`apiKey`、`baseUrl`

这两个参数是必填项。没有配置时，SDK 不能正常初始化，也不会上报 trace、span、
score、prompt 等数据。

## 推荐配置

生产和测试环境都必须显式配置 `SEA_TRACES_BASE_URL`。不要只配置 Team Key，
因为同一个 Team Key 可能同时用于不同环境，SDK 需要根据 Sea Traces 服务地址
解析项目凭证并确定最终上报地址。

```bash
export SEA_TEAM_KEY="sea-team-key"
export SEA_TRACES_BASE_URL="https://your-sea-traces.example.com"
```

## 快速开始

下面的代码会从环境变量读取 `SEA_TEAM_KEY` 和 `SEA_TRACES_BASE_URL`。SDK
初始化时会解析一次项目凭证，后续调用继续走 SDK 原有上报链路。

```ts
import { SeaTracesClient } from "@sea-traces/client";

const client = new SeaTracesClient();

const project = await client.api.projects.get();
```

如果配置来自配置中心或运行时上下文，可以在构造函数中传入：

```ts
import { SeaTracesClient } from "@sea-traces/client";

const client = new SeaTracesClient({
  apiKey: "sea-team-key",
  baseUrl: "https://your-sea-traces.example.com",
});
```

显式传参和环境变量等价，且显式传参优先级更高。

## OpenTelemetry 使用

```ts
import { SeaTracesSpanProcessor } from "@sea-traces/otel";

const processor = new SeaTracesSpanProcessor({
  apiKey: "sea-team-key",
  baseUrl: "https://your-sea-traces.example.com",
});
```

## 配置优先级

SDK 按以下顺序选择 Sea Traces 配置：

1. 显式传入 `apiKey`、`baseUrl`
2. 环境变量 `SEA_TEAM_KEY`、`SEA_TRACES_BASE_URL`

## 错误处理

常见错误和处理方式：

| 错误                       | 原因                                | 处理                                                   |
| -------------------------- | ----------------------------------- | ------------------------------------------------------ |
| `SEA_TEAM_KEY` 缺失        | 未配置 Team Key                     | 设置 `SEA_TEAM_KEY` 或显式传 `apiKey`                  |
| `SEA_TRACES_BASE_URL` 缺失 | 未指定 Sea Traces 服务地址          | 设置 `SEA_TRACES_BASE_URL` 或显式传 `baseUrl`          |
| resolver 返回非 2xx        | 凭证查询接口不可达或服务异常        | 检查 `SEA_TRACES_BASE_URL`、网络和 Sea Traces 服务状态 |
| `status` 不是 `ACTIVE`     | Team Key 未启用或映射不可用         | 检查 Team Key 和项目凭证状态                           |
| 查询不到 trace             | 数据未 flush 或服务地址指向错误环境 | 调用 flush/shutdown，确认 `SEA_TRACES_BASE_URL`        |

日志和异常信息不会输出完整 Team Key、`publicKey`、`secretKey` 或原始凭证响应。

## 从旧配置迁移

旧方式通常需要直接配置 public key 和 secret key。迁移后只需要配置：

```bash
export SEA_TEAM_KEY="sea-team-key"
export SEA_TRACES_BASE_URL="https://your-sea-traces.example.com"
```

如果代码里原来显式传入底层项目凭证，可以改为：

```ts
const client = new SeaTracesClient({
  apiKey: "sea-team-key",
  baseUrl: "https://your-sea-traces.example.com",
});
```

## 安全建议

- 不要把 `SEA_TEAM_KEY` 提交到 Git。
- 不要提交 `.env` 文件。
- 不要在日志里打印完整 Team Key、`publicKey` 或 `secretKey`。
- 测试环境和生产环境都显式配置 `SEA_TRACES_BASE_URL`。
- 容器或函数计算环境中，在启动时注入环境变量，避免在代码中硬编码。
