/**
 * Claude API 共通ユーティリティ
 * 529 (Overloaded) エラー時の指数バックオフリトライを実装
 */

export interface ClaudeMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ClaudeRequestParams {
  model?: string;
  max_tokens?: number;
  temperature?: number;
  system?: string;
  messages: ClaudeMessage[];
}

export interface ClaudeResponse {
  content: Array<{ type: string; text: string }>;
  stop_reason?: string;
  usage?: { input_tokens: number; output_tokens: number };
}

const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
const MAX_RETRIES = 3;
// Exponential backoff: 2s, 4s, 8s
const BACKOFF_BASE_MS = 2000;

/**
 * Claude API を呼び出す。529 Overloaded 時は指数バックオフでリトライ。
 */
export async function callClaudeWithRetry(
  params: ClaudeRequestParams,
  apiKey?: string,
  maxRetries = MAX_RETRIES
): Promise<ClaudeResponse> {
  const key = apiKey || process.env.ANTHROPIC_API_KEY || "";

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const res = await fetch(CLAUDE_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: params.model || DEFAULT_MODEL,
        max_tokens: params.max_tokens ?? 1024,
        temperature: params.temperature ?? 0,
        ...(params.system ? { system: params.system } : {}),
        messages: params.messages,
      }),
    });

    // 529: Overloaded — retry with exponential backoff
    if (res.status === 529) {
      const waitMs = BACKOFF_BASE_MS * Math.pow(2, attempt);
      console.warn(
        `[claude] ただいまAIが混雑しています。自動で再試行中... (${attempt + 1}/${maxRetries}) — ${waitMs / 1000}秒後に再試行`
      );
      if (attempt < maxRetries - 1) {
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
      throw new Error(
        `Claude API overloaded (529) after ${maxRetries} attempts`
      );
    }

    // 429: Rate limit — also retry with longer wait
    if (res.status === 429) {
      const waitMs = BACKOFF_BASE_MS * Math.pow(2, attempt + 1); // longer wait
      console.warn(
        `[claude] レート制限に達しました。再試行中... (${attempt + 1}/${maxRetries}) — ${waitMs / 1000}秒後に再試行`
      );
      if (attempt < maxRetries - 1) {
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
      throw new Error(`Claude API rate limited (429) after ${maxRetries} attempts`);
    }

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      throw new Error(`Claude API error ${res.status}: ${errBody}`);
    }

    return (await res.json()) as ClaudeResponse;
  }

  throw new Error("callClaudeWithRetry: unexpected exit");
}

/**
 * レスポンスからテキストを取り出すヘルパー
 */
export function extractText(response: ClaudeResponse): string {
  return response.content
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("")
    .trim();
}
