// DAYMATE assistant — AI provider adapters.
// The rest of the app only ever talks to `complete()`. To switch provider, change the
// AI_PROVIDER / AI_MODEL / AI_API_KEY secrets — no app code changes.
//   gemini            (default)  secret GEMINI_API_KEY or AI_API_KEY
//   anthropic                    secret ANTHROPIC_API_KEY or AI_API_KEY
//   openai-compatible            secret AI_API_KEY, optional AI_BASE_URL (OpenAI, OpenRouter, Groq, local servers…)
import { RESPONSE_SCHEMA, RESPONSE_SCHEMA_WITH_MEMORY } from "./logic.ts";

export type Msg = { role: "user" | "assistant"; content: string };
export type CompleteArgs = { system: string; messages: Msg[]; signal?: AbortSignal; withMemory?: boolean };
export type Provider = { name: string; model: string; complete: (a: CompleteArgs) => Promise<string> };
export class ProviderError extends Error {
  status: number; retryable: boolean;
  constructor(message: string, status = 0, retryable = false) { super(message); this.status = status; this.retryable = retryable; }
}

type Env = { get: (k: string) => string | undefined };

async function post(url: string, headers: Record<string, string>, body: unknown, signal?: AbortSignal) {
  let res: Response;
  try { res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body), signal }); }
  catch (e) { throw new ProviderError(`network: ${(e as Error).message}`, 0, true); }
  if (!res.ok) {
    const txt = (await res.text().catch(() => "")).slice(0, 300);   // never logged with user content
    throw new ProviderError(`provider ${res.status}: ${txt}`, res.status, res.status === 429 || res.status >= 500);
  }
  return res.json();
}

function gemini(key: string, model: string): Provider {
  return {
    name: "gemini", model,
    async complete({ system, messages, signal, withMemory }) {
      const j = await post(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        { "x-goog-api-key": key },
        {
          systemInstruction: { parts: [{ text: system }] },
          contents: messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
          generationConfig: { responseMimeType: "application/json", responseSchema: withMemory ? RESPONSE_SCHEMA_WITH_MEMORY : RESPONSE_SCHEMA, temperature: 0.3, maxOutputTokens: 2000 },
        }, signal);
      const text = j?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
      if (!text) throw new ProviderError(`empty response (${j?.candidates?.[0]?.finishReason ?? j?.promptFeedback?.blockReason ?? "unknown"})`, 200, false);
      return text;
    },
  };
}

function anthropic(key: string, model: string): Provider {
  return {
    name: "anthropic", model,
    async complete({ system, messages, signal }) {
      const j = await post("https://api.anthropic.com/v1/messages",
        { "x-api-key": key, "anthropic-version": "2023-06-01" },
        { model, max_tokens: 1200, temperature: 0.3, system: `${system}\n\nRespond with a single JSON object only: {"reply": string, "proposals": [...], "memory_suggestions": [...]}.`, messages }, signal);
      const text = (j?.content ?? []).map((c: { text?: string }) => c.text ?? "").join("");
      if (!text) throw new ProviderError("empty response", 200, false);
      return text;
    },
  };
}

function openaiCompatible(key: string, model: string, base: string): Provider {
  return {
    name: "openai-compatible", model,
    async complete({ system, messages, signal }) {
      const j = await post(`${base.replace(/\/+$/, "")}/chat/completions`, { Authorization: `Bearer ${key}` },
        { model, temperature: 0.3, max_tokens: 1200, response_format: { type: "json_object" },
          messages: [{ role: "system", content: `${system}\n\nRespond with a single JSON object only: {"reply": string, "proposals": [...]}.` }, ...messages] }, signal);
      const text = j?.choices?.[0]?.message?.content ?? "";
      if (!text) throw new ProviderError("empty response", 200, false);
      return text;
    },
  };
}

export const DEFAULT_MODELS: Record<string, string> = {
  gemini: "gemini-3.5-flash-lite",
  anthropic: "claude-haiku-4-5",
  "openai-compatible": "gpt-4o-mini",
};

/** Returns null when no key is configured (the function then reports "AI not set up yet"). */
export function getProvider(env: Env): Provider | null {
  const name = (env.get("AI_PROVIDER") || "gemini").toLowerCase();
  const model = env.get("AI_MODEL") || DEFAULT_MODELS[name] || "";
  if (name === "gemini") { const k = env.get("GEMINI_API_KEY") || env.get("AI_API_KEY"); return k ? gemini(k, model) : null; }
  if (name === "anthropic") { const k = env.get("ANTHROPIC_API_KEY") || env.get("AI_API_KEY"); return k ? anthropic(k, model) : null; }
  if (name === "openai-compatible") { const k = env.get("AI_API_KEY"); return k ? openaiCompatible(k, model, env.get("AI_BASE_URL") || "https://api.openai.com/v1") : null; }
  return null;
}
