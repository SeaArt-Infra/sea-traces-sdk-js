---
name: sea-traces-sdk-js
description: Use the Sea Traces JavaScript SDK for gateway-authenticated tracing, project management, trace queries, and batch ingestion.
type: slash_command
tags:
  - javascript
  - typescript
  - sea-traces
  - sdk
  - tracing
---

# Sea Traces JavaScript SDK Complete Reference

Use this skill for JavaScript or TypeScript integrations that need tracing,
project management, trace lookup, or ingestion through the Sea Traces gateway.

**Trigger scenarios:** tracing setup, project management, trace lookup, batch
ingestion, response inspection, or SDK troubleshooting.

**Processing rules:**

1. Use `SeaTracesApiClient` for project and trace APIs.
2. Use the tracing and OpenTelemetry packages for application instrumentation.
3. Handle rejected promises and never print bearer tokens.
4. Use the inspection examples when a user asks to view, copy, or save data.

**Output format:** Provide runnable JavaScript or TypeScript and a short
explanation. Prefer ESM imports.

## Install and configure

```bash
pnpm add @sea-traces/client
```

```ts
const api = new SeaTracesApiClient({
  baseUrl: "https://gateway.example.com",
  token: "token",
});
```

The client sends `Authorization: Bearer <token>` on every request.

## Project and trace APIs

```ts
const projects = await api.listProjects();
const project = await api.createProject("checkout");
await api.updateProject(project.id, "checkout-v2");
await api.ingest(project.id, [
  { type: "trace-create", body: { id: "trace-1", name: "checkout" } },
]);
const result = await api.listTraces(project.id, { traceId: "trace-1" });
```

`listTraces` also accepts `fromTimestamp`, `toTimestamp`, `page`, and `limit`.
Handle rejected promises and never log the bearer token.

## Inspect, save, and copy results

```ts
const result = await api.listTraces(project.id, { limit: 10 });
for (const trace of result.data) {
  console.log(trace.id, trace.name, trace.timestamp);
}

await Bun.write("traces.json", JSON.stringify(result, null, 2));
console.log("Copy this trace ID:", result.data[0]?.id);
```

In Node.js, use `writeFile` from `node:fs/promises` instead of `Bun.write`.
Only save trace data to a trusted location.
