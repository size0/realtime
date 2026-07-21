import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetConnectionRateLimitForTests } from "@/lib/rate-limit";
import { POST } from "@/app/api/realtime/connect/route";

const VALID_SDP = "v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n";

function makeRequest(options?: { origin?: string; body?: string; voice?: string; ip?: string }) {
  const voice = options?.voice ?? "Tina";
  return new Request(`http://localhost:3000/api/realtime/connect?voice=${voice}`, {
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
    clearEnvironment();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearEnvironment();
  });

  it("rejects cross-origin requests before reading credentials", async () => {
    const response = await POST(makeRequest({ origin: "https://attacker.example" }));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "INVALID_ORIGIN" } });
  });

  it("returns clear errors when required server configuration is missing", async () => {
    const missingKey = await POST(makeRequest());
    expect(missingKey.status).toBe(503);
    await expect(missingKey.json()).resolves.toMatchObject({ error: { code: "MISSING_API_KEY" } });

    process.env.DASHSCOPE_API_KEY = "sk-test-secret";
    const missingWorkspace = await POST(makeRequest({ ip: "127.0.0.2" }));
    expect(missingWorkspace.status).toBe(503);
    await expect(missingWorkspace.json()).resolves.toMatchObject({
      error: { code: "MISSING_WORKSPACE_ID" },
    });
  });

  it("rejects malformed SDP and unsupported voices", async () => {
    configureQwen();
    const badSdp = await POST(makeRequest({ body: "not-sdp", ip: "127.0.0.2" }));
    expect(badSdp.status).toBe(400);
    const badVoice = await POST(makeRequest({ voice: "unknown", ip: "127.0.0.3" }));
    expect(badVoice.status).toBe(400);
  });

  it("proxies raw SDP to Qwen and never exposes the server key", async () => {
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
    expect(response.headers.get("content-type")).toContain("application/sdp");
    expect(answer).toContain("a=setup:active");
    expect(answer).not.toContain("sk-test-secret");

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(
      "https://llm-testworkspace.cn-beijing.maas.aliyuncs.com/api/v1/webrtc/realtime?model=qwen3.5-omni-plus-realtime",
    );
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({
      Authorization: "Bearer sk-test-secret",
      "Content-Type": "application/sdp",
    });
    expect(init?.body).toBe(VALID_SDP);
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

  it("rate limits repeated connection creation", async () => {
    configureQwen();
    fetchMock.mockImplementation(() => Promise.resolve(new Response(VALID_SDP, { status: 200 })));
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const response = await POST(makeRequest());
      expect(response.status).toBe(200);
    }
    const limited = await POST(makeRequest());
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBeTruthy();
  });
});
