import { base64Encode, clearSealangfuseCredentialsCache } from "@langfuse/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LangfuseClient } from "./LangfuseClient.js";

const originalFetch = globalThis.fetch;
type FetchCall = [URL | RequestInfo, RequestInit | undefined];

describe("LangfuseClient Sealangfuse credentials", () => {
  afterEach(() => {
    clearSealangfuseCredentialsCache();
    vi.unstubAllEnvs();
    globalThis.fetch = originalFetch;
  });

  it("uses direct credentials without calling the resolver", async () => {
    const fetchMock = vi.fn(
      async (url: URL | RequestInfo, init?: RequestInit) => {
        expect(String(url)).toBe(
          "https://langfuse.example.com/api/public/projects",
        );

        return new Response(JSON.stringify({ data: [] }));
      },
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const client = new LangfuseClient({
      publicKey: "pk-lf-direct",
      secretKey: "sk-lf-direct",
      baseUrl: "https://langfuse.example.com",
    });

    await client.api.projects.get();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      (fetchMock.mock.calls[0] as FetchCall | undefined)?.[1]?.headers,
    ).toMatchObject({
      Authorization: `Basic ${base64Encode("pk-lf-direct:sk-lf-direct")}`,
      "X-Langfuse-Public-Key": "pk-lf-direct",
    });
  });

  it("resolves credentials from apiKey and preserves the configured base URL", async () => {
    const fetchMock = vi.fn(
      async (url: URL | RequestInfo, init?: RequestInit) => {
        if (
          String(url) ===
          "https://langfuse.example.com/api/public/sea-project-api-credentials?key=sa-test"
        ) {
          return new Response(
            JSON.stringify({
              publicKey: "pk-lf-resolved",
              secretKey: "sk-lf-resolved",
              baseUrl: "https://resolver-response.example.com",
              status: "ACTIVE",
            }),
          );
        }

        expect(String(url)).toBe(
          "https://langfuse.example.com/api/public/projects",
        );

        return new Response(JSON.stringify({ data: [] }));
      },
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const client = new LangfuseClient({
      apiKey: "sa-test",
      baseUrl: "https://langfuse.example.com",
    });

    await client.api.projects.get();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      (fetchMock.mock.calls[1] as FetchCall | undefined)?.[1]?.headers,
    ).toMatchObject({
      Authorization: `Basic ${base64Encode("pk-lf-resolved:sk-lf-resolved")}`,
      "X-Langfuse-Public-Key": "pk-lf-resolved",
    });
  });

  it("requires baseUrl when apiKey is used", () => {
    expect(() => new LangfuseClient({ apiKey: "sa-test" })).toThrow(
      "LANGFUSE_BASE_URL or baseUrl is required",
    );
  });
});
