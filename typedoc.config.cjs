/** @type {import('typedoc').TypeDocOptions} */
module.exports = {
  entryPoints: [
    "./packages/core",
    "./packages/client",
    "./packages/langchain",
    "./packages/openai",
    "./packages/otel",
    "./packages/tracing",
  ],
  entryPointStrategy: "packages",
  name: "Sea Traces JS/TS SDKs",
  navigationLinks: {
    GitHub: "http://github.com/langfuse/sea-traces-js",
    Docs: "https://langfuse.com/docs/sdk/typescript",
  },
};
