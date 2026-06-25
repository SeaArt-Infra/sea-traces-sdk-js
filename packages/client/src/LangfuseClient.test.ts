import {
  base64Encode,
  clearSealangfuseCredentialsCache,
} from "@sea-traces/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LangfuseClient } from "./LangfuseClient.js";

const originalFetch = globalThis.fetch;
type FetchCall = [Parameters<typeof fetch>[0], Parameters<typeof fetch>[1]?];

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
      apiKey: "sea-traces-api-key",
      projectId: "project-test",
    });

    await client.api.projects.get();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      (fetchMock.mock.calls[0] as unknown as FetchCall | undefined)?.[1]
        ?.headers,
    ).toMatchObject({
      Authorization: `Basic ${base64Encode("pk-lf-direct:sk-lf-direct")}`,
      "X-Langfuse-Public-Key": "pk-lf-direct",
    });
  });

  it("resolves gateway project and posts ingestion without auth", async () => {
    const fetchMock = vi.fn(
      async (url: URL | RequestInfo, init?: RequestInit) => {
        if (
          String(url) === "https://gateway.example.com/hub/sea-traces-api-key"
        ) {
          expect(JSON.parse(String(init?.body))).toEqual({
            api_key: "sa-test",
            base_url: "https://gateway.example.com",
          });

          return new Response(
            JSON.stringify({
              project_id: "project-resolved",
              base_url: "https://upload.example.com",
            }),
          );
        }

        expect(String(url)).toBe(
          "https://upload.example.com/api/public/ingestion-noauth",
        );
        expect(JSON.parse(String(init?.body))).toMatchObject({
          project_id: "project-resolved",
          batch: [
            {
              type: "score-create",
            },
          ],
        });
        expect(init?.headers).not.toHaveProperty("Authorization");
        expect(init?.headers).not.toHaveProperty("X-Langfuse-Public-Key");

        return new Response(JSON.stringify({ successes: [], errors: [] }));
      },
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const client = new LangfuseClient({
      apiKey: "sa-test",
      baseUrl: "https://gateway.example.com",
      projectId: "project-test",
    });

    client.score.create({ traceId: "trace-test", name: "quality", value: 1 });
    await client.flush();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("requires complete auth credentials", () => {
    expect(
      () => new LangfuseClient({ baseUrl: "https://sea-traces.example.com" }),
    ).toThrow("Sea Traces authentication requires complete direct credentials");
  });

  it("does not use legacy SEALANGFUSE_API_KEY as gateway auth", () => {
    vi.stubEnv("SEALANGFUSE_API_KEY", "sa-legacy");
    vi.stubEnv("LANGFUSE_BASE_URL", "https://legacy.example.com");

    expect(() => new LangfuseClient()).toThrow(
      "Sea Traces authentication requires complete direct credentials",
    );
  });

  it("uses SEA_TRACES_API_KEY and SEA_TRACES_BASE_URL env vars", async () => {
    vi.stubEnv("SEA_TRACES_API_KEY", "sea-traces-env");
    vi.stubEnv("SEA_TRACES_BASE_URL", "https://gateway.example.com");

    const fetchMock = vi.fn(async (url: URL | RequestInfo) => {
      if (
        String(url) === "https://gateway.example.com/hub/sea-traces-api-key"
      ) {
        return new Response(
          JSON.stringify({
            project_id: "project-env",
            base_url: "https://upload-env.example.com",
          }),
        );
      }

      expect(String(url)).toBe(
        "https://upload-env.example.com/api/public/ingestion-noauth",
      );

      return new Response(JSON.stringify({ successes: [], errors: [] }));
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const client = new LangfuseClient();

    client.score.create({ traceId: "trace-test", name: "quality", value: 1 });
    await client.flush();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("uses internal SEATRACES project env vars without calling the resolver", async () => {
    vi.stubEnv("SEATRACES_PROJECT_ID", "project-env");
    vi.stubEnv("SEATRACES_BASE_URL", "https://upload-env.example.com");

    const fetchMock = vi.fn(
      async (url: URL | RequestInfo, init?: RequestInit) => {
        expect(String(url)).toBe(
          "https://upload-env.example.com/api/public/ingestion-noauth",
        );
        expect(JSON.parse(String(init?.body))).toMatchObject({
          project_id: "project-env",
        });
        expect(init?.headers).not.toHaveProperty("Authorization");

        return new Response(JSON.stringify({ successes: [], errors: [] }));
      },
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const client = new LangfuseClient();

    client.score.create({ traceId: "trace-test", name: "quality", value: 1 });
    await client.flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("strips auth headers case-insensitively for noauth ingestion", async () => {
    vi.stubEnv("SEATRACES_PROJECT_ID", "project-env");
    vi.stubEnv("SEATRACES_BASE_URL", "https://upload-env.example.com");

    const fetchMock = vi.fn(
      async (url: URL | RequestInfo, init?: RequestInit) => {
        expect(String(url)).toBe(
          "https://upload-env.example.com/api/public/ingestion-noauth",
        );

        const normalizedHeaderNames = Object.keys(
          init?.headers as Record<string, unknown>,
        ).map((header) => header.toLowerCase());

        expect(normalizedHeaderNames).not.toContain("authorization");
        expect(normalizedHeaderNames).not.toContain("x-langfuse-public-key");

        return new Response(JSON.stringify({ successes: [], errors: [] }));
      },
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const client = new LangfuseClient({
      additionalHeaders: {
        AUTHORIZATION: "Bearer should-not-be-sent",
        "x-Langfuse-public-key": "pk-should-not-be-sent",
      },
    });

    await client.api.ingestion.batch(
      { batch: [] },
      {
        headers: {
          Authorization: "Basic should-not-be-sent",
          "X-Langfuse-Public-Key": "pk-should-not-be-sent",
        },
      },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uses SEATRACES direct env vars without calling the resolver", async () => {
    vi.stubEnv("SEATRACES_PUBLIC_KEY", "pk-lf-env-direct");
    vi.stubEnv("SEATRACES_SECRET_KEY", "sk-lf-env-direct");
    vi.stubEnv("SEATRACES_BASE_URL", "https://upload-direct.example.com");
    vi.stubEnv("SEA_TRACES_API_KEY", "sea-traces-env");
    vi.stubEnv("SEA_TRACES_BASE_URL", "https://gateway.example.com");

    const fetchMock = vi.fn(async (url: URL | RequestInfo) => {
      expect(String(url)).toBe(
        "https://upload-direct.example.com/api/public/projects",
      );

      return new Response(JSON.stringify({ data: [] }));
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const client = new LangfuseClient();

    await client.api.projects.get();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      (fetchMock.mock.calls[0] as unknown as FetchCall | undefined)?.[1]
        ?.headers,
    ).toMatchObject({
      Authorization: `Basic ${base64Encode(
        "pk-lf-env-direct:sk-lf-env-direct",
      )}`,
      "X-Langfuse-Public-Key": "pk-lf-env-direct",
    });
  });
});
