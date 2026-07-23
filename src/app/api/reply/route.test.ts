import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetReplyRateLimitForTests } from "@/lib/rate-limit";

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

import { POST } from "@/app/api/reply/route";

function makeRequest(body: unknown = { question: "怎么自然地介绍自己？", history: [] }) {
  return new Request("http://localhost:3000/api/reply", {
    method: "POST",
    headers: {
      Origin: "http://localhost:3000",
      Host: "localhost:3000",
      "Content-Type": "application/json",
      "X-Forwarded-For": "127.0.0.1",
    },
    body: JSON.stringify(body),
  });
}

function configure() {
  process.env.REASONING_API_KEY = "sk-test-secret";
  process.env.REASONING_BASE_URL = "https://api.reasoning.test/v1/";
  process.env.REASONING_MODEL = "gpt-5.5";
  process.env.REASONING_FALLBACK_MODEL = "gpt-5.4";
}

function completion(content: string) {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("POST /api/reply", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    resetReplyRateLimitForTests();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    authMocks.getRequestSession.mockResolvedValue({
      user: { id: "user-test" },
      csrfToken: "csrf-test",
    });
    authMocks.recordUsage.mockResolvedValue(undefined);
    authMocks.usageAllowance.mockReturnValue({ allowed: true, limit: null, used: 0 });
    configure();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete process.env.REASONING_API_KEY;
    delete process.env.REASONING_BASE_URL;
    delete process.env.REASONING_MODEL;
    delete process.env.REASONING_FALLBACK_MODEL;
    delete process.env.DASHSCOPE_API_KEY;
    delete process.env.DASHSCOPE_WORKSPACE_ID;
    delete process.env.DASHSCOPE_REASONING_MODEL;
    delete process.env.DASHSCOPE_REASONING_FALLBACK_MODEL;
    delete process.env.DASHSCOPE_TEXT_BASE_URL;
    delete process.env.ECONOMY_REASONING_API_KEY;
    delete process.env.ECONOMY_REASONING_BASE_URL;
    delete process.env.ECONOMY_REASONING_MODEL;
    delete process.env.ECONOMY_REASONING_FALLBACK_MODEL;
    delete process.env.STRONG_REASONING_API_KEY;
    delete process.env.STRONG_REASONING_BASE_URL;
    delete process.env.STRONG_REASONING_MODEL;
    delete process.env.STRONG_REASONING_FALLBACK_MODEL;
  });

  it("requires a valid login", async () => {
    authMocks.getRequestSession.mockResolvedValueOnce(null);
    const response = await POST(makeRequest());
    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stops a guest at the persistent daily reply limit", async () => {
    authMocks.usageAllowance.mockReturnValueOnce({ allowed: false, limit: 50, used: 50 });
    const response = await POST(makeRequest());
    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "GUEST_DAILY_LIMIT" } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses the configured GPT-5.5 provider and returns only the generated reply", async () => {
    fetchMock.mockResolvedValue(completion("自然一点介绍就好。"));
    const response = await POST(makeRequest());
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(body).toContain("自然一点介绍就好。");
    expect(body).not.toContain("sk-test-secret");
    expect(authMocks.recordUsage).toHaveBeenCalledWith("user-test", "replies");

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://api.reasoning.test/v1/chat/completions");
    const requestBody = JSON.parse(String(init?.body)) as {
      model: string;
      enable_thinking?: boolean;
    };
    expect(requestBody.model).toBe("gpt-5.5");
    expect(requestBody.enable_thinking).toBeUndefined();
  });

  it("falls back to the configured secondary model when GPT-5.5 is unavailable", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("temporary", { status: 500 }))
      .mockResolvedValueOnce(completion("回退成功"));
    const response = await POST(makeRequest());
    expect(response.status).toBe(200);
    const secondBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as { model: string };
    expect(secondBody.model).toBe("gpt-5.4");
  });

  it("keeps the legacy DashScope configuration as a backward-compatible fallback", async () => {
    delete process.env.REASONING_API_KEY;
    delete process.env.REASONING_BASE_URL;
    delete process.env.REASONING_MODEL;
    delete process.env.REASONING_FALLBACK_MODEL;
    process.env.DASHSCOPE_API_KEY = "sk-dashscope-test";
    process.env.DASHSCOPE_WORKSPACE_ID = "llm-testworkspace";
    fetchMock.mockResolvedValue(completion("兼容成功"));

    const response = await POST(makeRequest());
    expect(response.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(
      "https://llm-testworkspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions",
    );
    const requestBody = JSON.parse(String(init?.body)) as {
      model: string;
      enable_thinking?: boolean;
    };
    expect(requestBody.model).toBe("qwen3.5-flash");
    expect(requestBody.enable_thinking).toBe(false);
    await expect(response.clone().json()).resolves.toMatchObject({ tier: "economy" });
  });

  it("routes complex questions to the configured strong GPT provider", async () => {
    process.env.DASHSCOPE_API_KEY = "sk-dashscope-test";
    process.env.DASHSCOPE_WORKSPACE_ID = "llm-testworkspace";
    fetchMock.mockResolvedValue(completion("这是复杂问题的回答。"));

    const response = await POST(
      makeRequest({
        question: "请比较三种数据库架构的利弊，并给出完整迁移方案和故障恢复步骤",
        history: [],
      }),
    );
    const payload = (await response.json()) as { tier: string; model: string };
    expect(response.status).toBe(200);
    expect(payload).toMatchObject({ tier: "strong", model: "gpt-5.5" });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://api.reasoning.test/v1/chat/completions",
    );
  });

  it("maps authentication errors without exposing upstream details", async () => {
    fetchMock.mockResolvedValue(new Response("secret upstream details", { status: 401 }));
    const response = await POST(makeRequest());
    const body = await response.text();
    expect(response.status).toBe(502);
    expect(body).toContain("REASONING_AUTH");
    expect(body).not.toContain("secret upstream details");
    expect(body).not.toContain("sk-test-secret");
  });

  it("times out a stalled model request", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation((_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      }),
    );
    const pending = POST(makeRequest());
    await vi.advanceTimersByTimeAsync(20_001);
    const response = await pending;
    expect(response.status).toBe(504);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "REPLY_TIMEOUT" } });
  });

  it("falls back to the economy provider when the strong provider times out", async () => {
    vi.useFakeTimers();
    process.env.DASHSCOPE_API_KEY = "sk-dashscope-test";
    process.env.DASHSCOPE_WORKSPACE_ID = "llm-testworkspace";
    fetchMock
      .mockImplementationOnce((_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
      )
      .mockResolvedValueOnce(completion("已自动降级并返回。"));

    const pending = POST(
      makeRequest({
        question: "请详细分析一个高并发数据库架构的完整实施方案。",
        history: [],
      }),
    );
    await vi.advanceTimersByTimeAsync(20_001);
    const response = await pending;
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      tier: "economy",
      requestedTier: "strong",
      fallback: true,
      model: "qwen3.5-flash",
    });
  });

  it("rejects malformed body before calling the model", async () => {
    const response = await POST(makeRequest({ question: "", history: [] }));
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
