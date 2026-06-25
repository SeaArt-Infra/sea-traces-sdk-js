import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearSealangfuseCredentialsCache,
  getSealangfuseCredentialsUrl,
  resolveSeaTracesAuth,
  resolveSealangfuseCredentials,
} from "../src/sealangfuseCredentials.js";

const originalFetch = globalThis.fetch;
type FetchCall = [URL | RequestInfo, RequestInit | undefined];

describe("Sea Traces credential resolver", () => {
  afterEach(() => {
    clearSealangfuseCredentialsCache();
    vi.unstubAllEnvs();
    globalThis.fetch = originalFetch;
  });

  it("derives credentials URL from gateway base URL", () => {
    expect(
      getSealangfuseCredentialsUrl({
        baseUrl: "https://sea-traces.example.com/",
      }),
    ).toBe("https://sea-traces.example.com/hub/sea-traces-api-key");
  });

  it("uses explicit credentials URL override", () => {
    expect(
      getSealangfuseCredentialsUrl({
        baseUrl: "https://ignored.example.com",
        credentialsUrl: "https://resolver.example.com/credentials",
      }),
    ).toBe("https://resolver.example.com/credentials");
  });

  it("resolves credentials with POST JSON body", async () => {
    const fetchMock = vi.fn(
      async (url: URL | RequestInfo, init?: RequestInit) => {
        expect(String(url)).toBe(
          "https://sea-traces.example.com/hub/sea-traces-api-key",
        );
        expect(init).toMatchObject({
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
        });
        expect(JSON.parse(String(init?.body))).toEqual({
          api_key: "sa-test",
          base_url: "https://sea-traces.example.com",
        });

        return new Response(
          JSON.stringify({
            project_id: "project-resolved",
            base_url: "https://upload.example.com",
          }),
        );
      },
    );
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(
      resolveSealangfuseCredentials({
        apiKey: "sa-test",
        baseUrl: "https://sea-traces.example.com",
      }),
    ).resolves.toEqual({
      projectId: "project-resolved",
      baseUrl: "https://upload.example.com",
    });
  });

  it("rejects malformed credentials", async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          project_id: "project-test",
          baseUrl: "https://upload.example.com",
        }),
      );
    }) as typeof fetch;

    await expect(
      resolveSealangfuseCredentials({
        apiKey: "sa-test",
        baseUrl: "https://sea-traces.example.com",
      }),
    ).rejects.toThrow("Invalid Sea Traces credentials response");
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
      baseUrl: "https://sea-traces.example.com",
    });
    const second = resolveSealangfuseCredentials({
      apiKey: "sa-test",
      baseUrl: "https://sea-traces.example.com",
    });

    resolveResponse(
      new Response(
        JSON.stringify({
          project_id: "project-test",
          base_url: "https://upload.example.com",
        }),
      ),
    );

    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await resolveSealangfuseCredentials({
      apiKey: "sa-test",
      baseUrl: "https://sea-traces.example.com",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("includes credentials URL in the cache key", async () => {
    const fetchMock = vi.fn(async (url: URL | RequestInfo) => {
      return new Response(
        JSON.stringify({
          project_id: String(url).includes("resolver-a")
            ? "project-a"
            : "project-b",
          base_url: "https://upload.example.com",
        }),
      );
    });
    globalThis.fetch = fetchMock as typeof fetch;

    await resolveSealangfuseCredentials({
      apiKey: "sa-test",
      baseUrl: "https://sea-traces.example.com",
      credentialsUrl: "https://resolver-a.example.com/credentials",
    });
    await resolveSealangfuseCredentials({
      apiKey: "sa-test",
      baseUrl: "https://sea-traces.example.com",
      credentialsUrl: "https://resolver-b.example.com/credentials",
    });
    await resolveSealangfuseCredentials({
      apiKey: "sa-other",
      baseUrl: "https://sea-traces.example.com",
      credentialsUrl: "https://resolver-b.example.com/credentials",
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("prefers direct constructor config over gateway config", () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;

    const auth = resolveSeaTracesAuth({
      publicKey: "pk-lf-direct",
      secretKey: "sk-lf-direct",
      baseUrl: "https://upload.example.com",
      apiKey: "sa-test",
      projectId: "project-test",
    });

    expect(auth).toMatchObject({
      mode: "direct",
      publicKey: "pk-lf-direct",
      secretKey: "sk-lf-direct",
      baseUrl: "https://upload.example.com",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses direct env config before gateway config", () => {
    vi.stubEnv("SEATRACES_PUBLIC_KEY", "pk-lf-env");
    vi.stubEnv("SEATRACES_SECRET_KEY", "sk-lf-env");
    vi.stubEnv("SEATRACES_BASE_URL", "https://upload-env.example.com");

    const auth = resolveSeaTracesAuth({
      apiKey: "sa-test",
      baseUrl: "https://gateway.example.com",
      projectId: "project-test",
    });

    expect(auth).toMatchObject({
      mode: "direct",
      publicKey: "pk-lf-env",
      secretKey: "sk-lf-env",
      baseUrl: "https://upload-env.example.com",
    });
  });

  it("does not mix incomplete direct env with gateway credentials", async () => {
    vi.stubEnv("SEATRACES_PUBLIC_KEY", "pk-lf-stale");
    vi.stubEnv("SEA_TRACES_API_KEY", "sa-env");
    vi.stubEnv("SEA_TRACES_BASE_URL", "https://gateway.example.com");

    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          project_id: "project-resolved",
          base_url: "https://upload.example.com",
        }),
      );
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const auth = resolveSeaTracesAuth();

    expect(auth.mode).toBe("gateway");
    if (auth.mode !== "gateway") throw new Error("Expected gateway auth");

    await expect(auth.projectId()).resolves.toBe("project-resolved");
    expect(fetchMock.mock.calls[0] as FetchCall).toBeDefined();
  });

  it("uses legacy Langfuse env only as complete direct fallback", () => {
    vi.stubEnv("LANGFUSE_PUBLIC_KEY", "pk-lf-legacy");
    vi.stubEnv("LANGFUSE_SECRET_KEY", "sk-lf-legacy");
    vi.stubEnv("LANGFUSE_BASE_URL", "https://legacy.example.com");

    const auth = resolveSeaTracesAuth();

    expect(auth).toMatchObject({
      mode: "legacy-direct",
      publicKey: "pk-lf-legacy",
      secretKey: "sk-lf-legacy",
      baseUrl: "https://legacy.example.com",
    });
  });

  it("does not fall back to legacy env when gateway env is incomplete", () => {
    vi.stubEnv("SEA_TRACES_API_KEY", "sa-env");
    vi.stubEnv("LANGFUSE_PUBLIC_KEY", "pk-lf-legacy");
    vi.stubEnv("LANGFUSE_SECRET_KEY", "sk-lf-legacy");
    vi.stubEnv("LANGFUSE_BASE_URL", "https://legacy.example.com");

    expect(() => resolveSeaTracesAuth()).toThrow(
      "Sea Traces gateway authentication requires apiKey and baseUrl",
    );
  });

  it("uses internal project config when provided", () => {
    const auth = resolveSeaTracesAuth({
      projectId: "project-test",
      baseUrl: "https://upload.example.com",
    });

    expect(auth).toMatchObject({
      mode: "project",
      projectId: "project-test",
      baseUrl: "https://upload.example.com",
    });
  });

  it("explicit apiKey and projectId still uses gateway mode", () => {
    const auth = resolveSeaTracesAuth({
      apiKey: "sa-test",
      projectId: "project-test",
      baseUrl: "https://gateway.example.com",
    });

    expect(auth.mode).toBe("gateway");
  });

  it("throws when gateway config is incomplete", () => {
    expect(() =>
      resolveSeaTracesAuth({
        apiKey: "sa-test",
      }),
    ).toThrow("Sea Traces gateway authentication requires apiKey and baseUrl");
  });
});
