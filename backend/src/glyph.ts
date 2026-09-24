import crypto from "node:crypto";

export interface SlotConfig {
  provider: string;
  baseUrl: string;
  apiKey?: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  disableReasoning?: boolean;
}

export interface GlyphResult {
  code: string;
  rawReply: string;
  latencyMs: number;
  promptTokens: number | null;
  completionTokens: number | null;
  reasoningTokens: number | null;
  sha256: string;
  extractionPath: string;
  error?: string;
}

export const SYSTEM_PROMPT = "You are a precise assistant. Answer the user's request directly.";

function nonce(): string {
  return crypto.randomBytes(4).toString("hex");
}

export function extractCode(reply: string): { code: string; path: string } | null {
  const fence = reply.match(/```(?:js|javascript|node)?\s*\n([\s\S]*?)```/i);
  if (fence) return { code: fence[1].trim(), path: "fence" };
  if (reply.includes("process.stdout.write") || reply.includes("\u001b[") || reply.includes("\\x1b[")) {
    // strip any stray fences anyway
    return { code: reply.replace(/```\w*\n?/g, "").trim(), path: "heuristic" };
  }
  return null;
}

export async function callModel(slot: SlotConfig, userPrompt: string): Promise<GlyphResult> {
  const t0 = Date.now();
  // fresh nonce per call — defeats response caches; assert zero prompt reuse
  const promptWithNonce = `${userPrompt}\n\n<!-- nonce:${nonce()} -->`;
  let maxTokens = slot.maxTokens ?? 1600;
  const body: any = {
    model: slot.model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: promptWithNonce },
    ],
    temperature: slot.temperature ?? 0,
    max_tokens: maxTokens,
  };
  // Only Particle deepseek slots get chat_template_kwargs
  if (slot.provider === "Particle.ai" && slot.model.startsWith("deepseek-")) {
    if (slot.disableReasoning) body.chat_template_kwargs = { enable_thinking: false };
  }
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (slot.apiKey) headers.Authorization = `Bearer ${slot.apiKey}`;

  const url = slot.baseUrl.replace(/\/$/, "") + "/chat/completions";
  for (let attempt = 0; attempt < 2; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
    } catch (e: any) {
      throw new Error(`Cannot reach ${slot.baseUrl} — is ${slot.provider} running? ${e?.message ?? e}`);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`${slot.provider} error ${res.status}: ${text.slice(0, 500)}`);
    }
    const json: any = await res.json();
    const msg = json?.choices?.[0]?.message ?? {};
    let content: string = typeof msg.content === "string" ? msg.content : "";
    // STRIP reasoning_content — never log/store/display
    // (deliberately not copied anywhere)
    const usage = json?.usage ?? {};
    const reasoningTokens =
      usage?.completion_tokens_details?.reasoning_tokens ?? null;
    if (!content.trim()) {
      // hidden CoT ate the budget — retry once with double, cap 4000
      if (attempt === 0) {
        maxTokens = Math.min(maxTokens * 2, 4000);
        body.max_tokens = maxTokens;
        continue;
      }
      return {
        code: "", rawReply: "", latencyMs: Date.now() - t0,
        promptTokens: usage.prompt_tokens ?? null,
        completionTokens: usage.completion_tokens ?? null,
        reasoningTokens,
        sha256: "", extractionPath: "empty",
        error: "Empty content after retry (budget doubled).",
      };
    }
    const found = extractCode(content);
    if (!found) {
      return {
        code: "", rawReply: content.slice(0, 4000), latencyMs: Date.now() - t0,
        promptTokens: usage.prompt_tokens ?? null,
        completionTokens: usage.completion_tokens ?? null,
        reasoningTokens,
        sha256: "", extractionPath: "none",
        error: "No extractable code (no fence, no process.stdout.write).",
      };
    }
    const sha256 = crypto.createHash("sha256").update(found.code).digest("hex");
    return {
      code: found.code,
      rawReply: content.slice(0, 8000),
      latencyMs: Date.now() - t0,
      promptTokens: usage.prompt_tokens ?? null,
      completionTokens: usage.completion_tokens ?? null,
      reasoningTokens,
      sha256,
      extractionPath: found.path,
    };
  }
  throw new Error("unreachable");
}
