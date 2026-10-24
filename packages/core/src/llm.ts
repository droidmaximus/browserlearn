export interface LlmClient {
  complete(system: string, user: string): Promise<string>;
}

export interface OpenAiCompatibleOptions {
  baseUrl: string;
  model: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}

export function openAiCompatibleClient(opts: OpenAiCompatibleOptions): LlmClient {
  const doFetch = opts.fetchImpl ?? fetch;
  const url = `${opts.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  return {
    async complete(system, user) {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (opts.apiKey) headers.authorization = `Bearer ${opts.apiKey}`;
      const res = await doFetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: opts.model,
          temperature: 0,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
      });
      if (!res.ok) throw new Error(`LLM request failed: ${res.status}`);
      const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const content = json.choices?.[0]?.message?.content;
      if (typeof content !== "string") throw new Error("LLM response had no message content");
      return content;
    },
  };
}
