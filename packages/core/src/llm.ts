export interface LlmClient {
  complete(system: string, user: string): Promise<string>;
}

export interface OpenAiCompatibleOptions {
  baseUrl: string;
  model: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  /** Default 30000. */
  timeoutMs?: number;
}

export function openAiCompatibleClient(opts: OpenAiCompatibleOptions): LlmClient {
  const doFetch = opts.fetchImpl ?? fetch;
  const url = `${opts.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const timeoutMs = opts.timeoutMs ?? 30000;
  return {
    async complete(system, user) {
      if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("timeoutMs must be a positive finite number");
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (opts.apiKey) headers.authorization = `Bearer ${opts.apiKey}`;
      const signal = AbortSignal.timeout(timeoutMs);
      let json: { choices?: { message?: { content?: string } }[] };
      try {
        const res = await doFetch(url, {
          method: "POST",
          headers,
          signal,
          body: JSON.stringify({
            model: opts.model,
            temperature: 0,
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
          }),
        });
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          throw new Error(`LLM request failed: ${res.status} ${body.slice(0, 500)}`.trim());
        }
        json = (await res.json()) as typeof json;
      } catch (err) {
        if (signal.aborted) throw new Error(`LLM request timed out after ${timeoutMs}ms`);
        throw err;
      }
      const content = json.choices?.[0]?.message?.content;
      if (typeof content !== "string") throw new Error("LLM response had no message content");
      return content;
    },
  };
}
