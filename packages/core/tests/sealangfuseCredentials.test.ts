import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearSealangfuseCredentialsCache,
  getSealangfuseCredentialsUrl,
  resolveSealangfuseCredentials,
} from "../src/sealangfuseCredentials.js";

const originalFetch = globalThis.fetch;

describe("Sealangfuse credential resolver", () => {
  afterEach(() => {
    clearSealangfuseCredentialsCache();
    vi.unstubAllEnvs();
    globalThis.fetch = originalFetch;
  });

  it("derives credentials URL from base URL", () => {
    expect(
      getSealangfuseCredentialsUrl({
        baseUrl: "https://sealangfuse.example.com/",
      }),
    ).toBe(
      "https://sealangfuse.example.com/api/public/sea-project-api-credentials",
    );
  });

  it("uses explicit credentials URL override", () => {
    expect(
      getSealangfuseCredentialsUrl({
        baseUrl: "https://ignored.example.com",
        credentialsUrl: "https://resolver.example.com/credentials",
      }),
    ).toBe("https://resolver.example.com/credentials");
  });

  it("resolves active credentials", async () => {
    const fetchMock = vi.fn(async (url: URL | RequestInfo) => {
      expect(String(url)).toBe(
        "https://sealangfuse.example.com/api/public/sea-project-api-credentials?key=sa-test",
      );

      return new Response(
        JSON.stringify({
          publicKey: "pk-lf-test",
          secretKey: "sk-lf-test",
          baseUrl: "https://sealangfuse.example.com",
          status: "ACTIVE",
        }),
      );
    });
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(
      resolveSealangfuseCredentials({
        apiKey: "sa-test",
        baseUrl: "https://sealangfuse.example.com",
      }),
    ).resolves.toEqual({
      publicKey: "pk-lf-test",
      secretKey: "sk-lf-test",
      baseUrl: "https://sealangfuse.example.com",
      status: "ACTIVE",
    });
  });

  it("rejects inactive credentials", async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          publicKey: "pk-lf-test",
          secretKey: "sk-lf-test",
          baseUrl: "https://sealangfuse.example.com",
          status: "INACTIVE",
        }),
      );
    }) as typeof fetch;

    await expect(
      resolveSealangfuseCredentials({
        apiKey: "sa-test",
        baseUrl: "https://sealangfuse.example.com",
      }),
    ).rejects.toThrow("Invalid Sealangfuse credentials response");
  });

  it("deduplicates concurrent resolution for the same key and URL", async () => {
    let resolveResponse: (response: Response) => void = () => undefined;
    const responsePromise = new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    });
    const fetchMock = vi.fn(() => responsePromise);
    globalThis.fetch = fetchMock as typeof fetch;

    const first = resolveSealangfuseCredentials({
      apiKey: "sa-test",
      baseUrl: "https://sealangfuse.example.com",
    });
    const second = resolveSealangfuseCredentials({
      apiKey: "sa-test",
      baseUrl: "https://sealangfuse.example.com",
    });

    resolveResponse(
      new Response(
        JSON.stringify({
          publicKey: "pk-lf-test",
          secretKey: "sk-lf-test",
          baseUrl: "https://sealangfuse.example.com",
          status: "ACTIVE",
        }),
      ),
    );

    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await resolveSealangfuseCredentials({
      apiKey: "sa-test",
      baseUrl: "https://sealangfuse.example.com",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("includes credentials URL in the cache key", async () => {
    const fetchMock = vi.fn(async (url: URL | RequestInfo) => {
      return new Response(
        JSON.stringify({
          publicKey: String(url).includes("resolver-a") ? "pk-lf-a" : "pk-lf-b",
          secretKey: "sk-lf-test",
          baseUrl: "https://sealangfuse.example.com",
          status: "ACTIVE",
        }),
      );
    });
    globalThis.fetch = fetchMock as typeof fetch;

    await resolveSealangfuseCredentials({
      apiKey: "sa-test",
      baseUrl: "https://sealangfuse.example.com",
      credentialsUrl: "https://resolver-a.example.com/credentials",
    });
    await resolveSealangfuseCredentials({
      apiKey: "sa-test",
      baseUrl: "https://sealangfuse.example.com",
      credentialsUrl: "https://resolver-b.example.com/credentials",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
