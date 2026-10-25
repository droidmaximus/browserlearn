import { describe, expect, it, vi } from "vitest";
import { openAiCompatibleClient } from "../src/llm.js";

it("posts a chat completion and returns the message content", async () => {
  const fetchImpl = vi.fn(
    async (_url: string, _init: RequestInit) =>
      new Response(JSON.stringify({ choices: [{ message: { content: "hi" } }] }), { status: 200 }),
  );
  const client = openAiCompatibleClient({
    baseUrl: "http://localhost:11434/v1/",
    apiKey: "k",
    model: "m",
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
  expect(await client.complete("s", "u")).toBe("hi");
  const [url, init] = fetchImpl.mock.calls[0];
  expect(url).toBe("http://localhost:11434/v1/chat/completions");
  expect(JSON.parse(init.body as string)).toEqual({
    model: "m",
    temperature: 0,
    messages: [
      { role: "system", content: "s" },
      { role: "user", content: "u" },
    ],
  });
  expect((init.headers as Record<string, string>).authorization).toBe("Bearer k");
});

it("omits the auth header when there is no key (local models)", async () => {
  const fetchImpl = vi.fn(
    async (_url: string, _init: RequestInit) =>
      new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 }),
  );
  const client = openAiCompatibleClient({ baseUrl: "http://x/v1", model: "m", fetchImpl: fetchImpl as unknown as typeof fetch });
  await client.complete("s", "u");
  expect((fetchImpl.mock.calls[0][1].headers as Record<string, string>).authorization).toBeUndefined();
});

it("throws on HTTP errors", async () => {
  const fetchImpl = async () => new Response("nope", { status: 401 });
  const client = openAiCompatibleClient({ baseUrl: "http://x/v1", model: "m", fetchImpl: fetchImpl as typeof fetch });
  await expect(client.complete("s", "u")).rejects.toThrow(/LLM request failed: 401/);
});

it.each([-1, Number.NaN])("rejects timeoutMs %s from complete(), never at construction", async (timeoutMs) => {
  const fetchImpl = vi.fn(async () => new Response("{}"));
  let client!: ReturnType<typeof openAiCompatibleClient>;
  expect(() => {
    client = openAiCompatibleClient({ baseUrl: "http://x/v1", model: "m", timeoutMs, fetchImpl: fetchImpl as typeof fetch });
  }).not.toThrow();
  await expect(client.complete("s", "u")).rejects.toThrow("timeoutMs must be a positive finite number");
  expect(fetchImpl).not.toHaveBeenCalled();
});

it("times out a request that never answers", async () => {
  const fetchImpl = ((_url: string, init: RequestInit) =>
    new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
    })) as unknown as typeof fetch;
  const client = openAiCompatibleClient({ baseUrl: "http://x/v1", model: "m", timeoutMs: 20, fetchImpl });
  await expect(client.complete("s", "u")).rejects.toThrow(/timed out after 20ms/);
});

describe("openAiCompatibleClient hardening", () => {
  it("rejects zero and infinite timeouts when a request is made", async () => {
    const fetchImpl = (async () => {
      throw new Error("must not fetch");
    }) as unknown as typeof fetch;
    for (const timeoutMs of [0, Infinity]) {
      const client = openAiCompatibleClient({ baseUrl: "http://llm.test", model: "m", timeoutMs, fetchImpl });
      await expect(client.complete("s", "u")).rejects.toThrow(/timeoutMs/);
    }
  });

  it("includes the provider's error body in the error", async () => {
    const fetchImpl = (async () => new Response("rate limited", { status: 429 })) as unknown as typeof fetch;
    const client = openAiCompatibleClient({ baseUrl: "http://llm.test", model: "m", fetchImpl });
    await expect(client.complete("s", "u")).rejects.toThrow("LLM request failed: 429 rate limited");
  });
});
