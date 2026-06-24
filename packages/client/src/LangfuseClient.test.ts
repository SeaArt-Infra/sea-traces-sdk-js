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

  it("resolves gateway credentials and uses the resolved upload base URL", async () => {
    const fetchMock = vi.fn(
      async (url: URL | RequestInfo, init?: RequestInit) => {
        if (
          String(url) === "https://gateway.example.com/hub/sea-traces-api-key"
        ) {
          expect(JSON.parse(String(init?.body))).toEqual({
            api_key: "sa-test",
            base_url: "https://gateway.example.com",
            project_id: "project-test",
          });

          return new Response(
            JSON.stringify({
              publicKey: "pk-lf-resolved",
              secretKey: "sk-lf-resolved",
              baseUrl: "https://upload.example.com",
            }),
          );
        }

        expect(String(url)).toBe(
          "https://upload.example.com/api/public/projects",
        );

        return new Response(JSON.stringify({ data: [] }));
      },
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const client = new LangfuseClient({
      apiKey: "sa-test",
      baseUrl: "https://gateway.example.com",
      projectId: "project-test",
    });

    await client.api.projects.get();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      (fetchMock.mock.calls[1] as unknown as FetchCall | undefined)?.[1]
        ?.headers,
    ).toMatchObject({
      Authorization: `Basic ${base64Encode("pk-lf-resolved:sk-lf-resolved")}`,
      "X-Langfuse-Public-Key": "pk-lf-resolved",
    });
  });

  it("requires complete direct or gateway credentials", () => {
    expect(
      () => new LangfuseClient({ baseUrl: "https://sea-traces.example.com" }),
    ).toThrow(
      "Sea Traces gateway authentication requires apiKey, baseUrl, and projectId",
    );
  });

  it("does not use legacy SEALANGFUSE_API_KEY as gateway auth", () => {
    vi.stubEnv("SEALANGFUSE_API_KEY", "sa-legacy");
    vi.stubEnv("LANGFUSE_BASE_URL", "https://legacy.example.com");

    expect(() => new LangfuseClient()).toThrow(
      "Sea Traces authentication requires complete direct credentials",
    );
  });

  it("uses SEA_TRACES_API_KEY, SEA_TRACES_BASE_URL, and SEA_TRACES_PROJECT_ID env vars", async () => {
    vi.stubEnv("SEA_TRACES_API_KEY", "sea-traces-env");
    vi.stubEnv("SEA_TRACES_BASE_URL", "https://gateway.example.com");
    vi.stubEnv("SEA_TRACES_PROJECT_ID", "project-env");

    const fetchMock = vi.fn(async (url: URL | RequestInfo) => {
      if (
        String(url) === "https://gateway.example.com/hub/sea-traces-api-key"
      ) {
        return new Response(
          JSON.stringify({
            publicKey: "pk-lf-env",
            secretKey: "sk-lf-env",
            baseUrl: "https://upload-env.example.com",
          }),
        );
      }

      expect(String(url)).toBe(
        "https://upload-env.example.com/api/public/projects",
      );

      return new Response(JSON.stringify({ data: [] }));
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const client = new LangfuseClient();

    await client.api.projects.get();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("uses SEATRACES direct env vars without calling the resolver", async () => {
    vi.stubEnv("SEATRACES_PUBLIC_KEY", "pk-lf-env-direct");
    vi.stubEnv("SEATRACES_SECRET_KEY", "sk-lf-env-direct");
    vi.stubEnv("SEATRACES_BASE_URL", "https://upload-direct.example.com");
    vi.stubEnv("SEA_TRACES_API_KEY", "sea-traces-env");
    vi.stubEnv("SEA_TRACES_BASE_URL", "https://gateway.example.com");
    vi.stubEnv("SEA_TRACES_PROJECT_ID", "project-env");

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
