import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetConnectionRateLimitForTests } from "@/lib/rate-limit";

const authMocks = vi.hoisted(() => ({
  getRequestSession: vi.fn(),
  recordUsage: vi.fn(),
  usageAllowance: vi.fn(),
}));

vi.mock("@/lib/auth-session", () => ({ getRequestSession: authMocks.getRequestSession }));
vi.mock("@/lib/auth-store", () => ({
  recordUsage: authMocks.recordUsage,
  usageAllowance: authMocks.usageAllowance,
}));

import { POST } from "@/app/api/realtime/connect/route";

const VALID_SDP = "v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n";

function makeRequest(options?: { origin?: string; body?: string; ip?: string; voice?: string }) {
  const voice = options?.voice ? `?voice=${encodeURIComponent(options.voice)}` : "";
  return new Request(`http://localhost:3000/api/realtime/connect${voice}`, {
    method: "POST",
    headers: {
      Origin: options?.origin ?? "http://localhost:3000",
      Host: "localhost:3000",
      "Content-Type": "application/sdp",
      "X-Forwarded-For": options?.ip ?? "127.0.0.1",
    },
    body: options?.body ?? VALID_SDP,
  });
}

function configureQwen() {
  process.env.DASHSCOPE_API_KEY = "sk-test-secret";
  process.env.DASHSCOPE_WORKSPACE_ID = "llm-testworkspace";
}

function clearEnvironment() {
  delete process.env.DASHSCOPE_API_KEY;
  delete process.env.DASHSCOPE_WORKSPACE_ID;
  delete process.env.DASHSCOPE_REALTIME_MODEL;
  delete process.env.DASHSCOPE_REGION;
  delete process.env.APP_ORIGIN;
}

describe("POST /api/realtime/connect", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    resetConnectionRateLimitForTests();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    authMocks.getRequestSession.mockResolvedValue({
      user: { id: "user-test" },
      csrfToken: "csrf-test",
    });
    authMocks.recordUsage.mockResolvedValue(undefined);
    authMocks.usageAllowance.mockReturnValue({ allowed: true, limit: null, used: 0 });
    clearEnvironment();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearEnvironment();
  });

  it("rejects cross-origin and unauthenticated requests", async () => {
    const crossOrigin = await POST(makeRequest({ origin: "https://attacker.example" }));
    expect(crossOrigin.status).toBe(403);

    authMocks.getRequestSession.mockResolvedValueOnce(null);
    const unauthenticated = await POST(makeRequest());
    expect(unauthenticated.status).toBe(401);
  });

  it("returns clear errors when required server configuration is missing", async () => {
    const missingKey = await POST(makeRequest());
    expect(missingKey.status).toBe(503);
    await expect(missingKey.json()).resolves.toMatchObject({ error: { code: "MISSING_API_KEY" } });

    process.env.DASHSCOPE_API_KEY = "sk-test-secret";
    const missingWorkspace = await POST(makeRequest({ ip: "127.0.0.2" }));
    expect(missingWorkspace.status).toBe(503);
  });

  it("rejects malformed SDP", async () => {
    configureQwen();
    const response = await POST(makeRequest({ body: "not-sdp" }));
    expect(response.status).toBe(400);
  });

  it("accepts only the supported voice whitelist", async () => {
    configureQwen();
    const response = await POST(makeRequest({ voice: "unsupported-voice" }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "INVALID_VOICE" } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stops a guest at the persistent daily connection limit", async () => {
    configureQwen();
    authMocks.usageAllowance.mockReturnValueOnce({ allowed: false, limit: 10, used: 10 });
    const response = await POST(makeRequest());
    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "GUEST_DAILY_LIMIT" } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("proxies raw SDP to Qwen, records usage and never exposes the server key", async () => {
    configureQwen();
    fetchMock.mockResolvedValue(
      new Response(`${VALID_SDP}a=setup:active\r\n`, {
        status: 200,
        headers: { "Content-Type": "application/sdp" },
      }),
    );

    const response = await POST(makeRequest());
    const answer = await response.text();
    expect(response.status).toBe(200);
    expect(answer).toContain("a=setup:active");
    expect(answer).not.toContain("sk-test-secret");
    expect(authMocks.recordUsage).toHaveBeenCalledWith("user-test", "realtimeConnections");

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(
      "https://llm-testworkspace.cn-beijing.maas.aliyuncs.com/api/v1/webrtc/realtime?model=qwen3.5-omni-flash-realtime",
    );
    expect(init?.headers).toEqual({
      Authorization: "Bearer sk-test-secret",
      "Content-Type": "application/sdp",
    });
  });

  it.each([
    [401, 502, "QWEN_AUTH"],
    [403, 502, "QWEN_ACCESS"],
    [404, 502, "QWEN_WORKSPACE"],
    [429, 429, "RATE_LIMITED"],
    [500, 502, "QWEN_UNAVAILABLE"],
  ])("maps upstream %i without leaking response details", async (upstreamStatus, status, code) => {
    configureQwen();
    fetchMock.mockResolvedValue(
      new Response("upstream included secret sk-upstream", { status: upstreamStatus }),
    );
    const response = await POST(makeRequest({ ip: `127.0.0.${upstreamStatus}` }));
    const body = await response.text();
    expect(response.status).toBe(status);
    expect(body).toContain(code);
    expect(body).not.toContain("sk-test-secret");
    expect(body).not.toContain("sk-upstream");
  });

  it("rate limits repeated connection creation per authenticated user", async () => {
    configureQwen();
    fetchMock.mockImplementation(() => Promise.resolve(new Response(VALID_SDP, { status: 200 })));
    for (let attempt = 0; attempt < 6; attempt += 1) {
      expect((await POST(makeRequest())).status).toBe(200);
    }
    const limited = await POST(makeRequest());
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBeTruthy();
  });
});
