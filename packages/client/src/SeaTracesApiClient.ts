export type Project = { id: string; name: string };
export type Trace = {
  id: string;
  projectId: string;
  timestamp: string;
  name: string | null;
  input: unknown;
  output: unknown;
  userId: string | null;
  sessionId: string | null;
};
export type IngestionEvent = {
  id?: string;
  timestamp?: string;
  type: string;
  body: unknown;
};
export type TraceQuery = {
  traceId?: string;
  fromTimestamp?: string | Date;
  toTimestamp?: string | Date;
  page?: number;
  limit?: number;
};

export class SeaTracesApiClient {
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(config: { baseUrl: string; token: string }) {
    if (!config.baseUrl?.trim() || !config.token?.trim())
      throw new Error("baseUrl and token are required");
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.token = config.token;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.token}`,
        ...init.headers,
      },
    });
    const body = await response.json().catch(() => null);
    if (!response.ok)
      throw new Error(
        `Sea Traces API request failed (${response.status}): ${JSON.stringify(body)}`,
      );
    return body as T;
  }

  listProjects(): Promise<{ data: Project[] }> {
    return this.request("/api/internal/projects");
  }
  createProject(name: string): Promise<Project> {
    return this.request("/api/internal/projects", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
  }
  updateProject(projectId: string, name: string): Promise<Project> {
    return this.request(
      `/api/internal/projects/${encodeURIComponent(projectId)}`,
      { method: "PATCH", body: JSON.stringify({ name }) },
    );
  }
  ingest(
    projectId: string,
    batch: IngestionEvent[],
  ): Promise<{ successes: unknown[]; errors: unknown[] }> {
    return this.request(
      `/api/internal/projects/${encodeURIComponent(projectId)}/ingestion`,
      { method: "POST", body: JSON.stringify({ batch }) },
    );
  }
  listTraces(
    projectId: string,
    query: TraceQuery = {},
  ): Promise<{ data: Trace[]; meta: Record<string, number> }> {
    const params = new URLSearchParams();
    params.set("page", String(query.page ?? 1));
    params.set("limit", String(query.limit ?? 50));
    if (query.traceId) params.set("traceId", query.traceId);
    if (query.fromTimestamp)
      params.set(
        "fromTimestamp",
        query.fromTimestamp instanceof Date
          ? query.fromTimestamp.toISOString()
          : query.fromTimestamp,
      );
    if (query.toTimestamp)
      params.set(
        "toTimestamp",
        query.toTimestamp instanceof Date
          ? query.toTimestamp.toISOString()
          : query.toTimestamp,
      );
    return this.request(
      `/api/internal/projects/${encodeURIComponent(projectId)}/traces?${params}`,
    );
  }
}
