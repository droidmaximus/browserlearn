import { expect, it, vi } from "vitest";
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
