import type { LlmProvider } from "./types.js";

export function anthropicProvider(apiKey: string, fetchImpl: typeof fetch = fetch, model = "claude-haiku-4-5-20251001"): LlmProvider {
  return {
    async complete(system, user) {
      const res = await fetchImpl("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: 2048,
          temperature: 0,
          system,
          messages: [{ role: "user", content: user }],
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`Anthropic ${res.status}: ${t.slice(0, 200)}`);
      }
      const json = (await res.json()) as { content?: { type: string; text?: string }[] };
      const text = json.content?.find((c) => c.type === "text")?.text;
      if (typeof text !== "string") throw new Error("Anthropic response missing text");
      return text;
    },
  };
}
