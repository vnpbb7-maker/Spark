import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

// Extend Vercel timeout (Pro: 300s, Hobby: 60s)
export const maxDuration = 60;

const SYSTEM_PROMPT = `あなたはプロダクトのグロース専門家です。
プロダクトの説明から、今まさに困っている日本人ユーザーを3パターン特定し、
各パターンについて以下をJSON形式で出力してください。

【重要】
- 有効なJSONのみを返すこと。マークダウン、説明文、コードブロック（\`\`\`）は一切不要。
- 全てのキーワード、シグナル、ツイート例は必ず日本語で書くこと。英語キーワードは使わない。
- 日本のSNS（X/Twitter日本語圏、note、はてブ等）で実際に検索できるフレーズにすること。
- discovery_signalsは日本語で、実際にSNSで検索して見つかるような具体的なフレーズにすること。

出力形式:
{
  "personas": [
    {
      "label": "ペルソナ名（例：0→1に詰まってる個人開発者）",
      "pain_scene": "今まさにどんな状況で困っているか（具体的な場面で1文）",
      "current_workaround": "今どうやって乗り越えようとしているか、その不満",
      "reddit_communities": ["r/XXX", "r/YYY", "r/ZZZ"],
      "twitter_keywords": ["日本語キーワード1", "日本語キーワード2", "日本語キーワード3", "日本語キーワード4", "日本語キーワード5"],
      "real_tweet_example": "この人が実際に投稿しそうな愚痴ツイートの例文（必ず日本語で）",
      "message_angle": "このペルソナに刺さるアプローチの角度（何を解決できると言えば反応するか）",
      "avoid_phrases": ["警戒されるフレーズ1", "警戒されるフレーズ2"],
      "discovery_signals": ["日本語の発見シグナル1", "日本語の発見シグナル2", "日本語の発見シグナル3"]
    }
  ],
  "recommended_platforms": ["reddit", "twitter"],
  "positioning": "競合との差別化（1文）"
}`;

async function fetchPageContent(url: string): Promise<string> {
  try {
    const jinaUrl = `https://r.jina.ai/${url}`;
    const res = await fetch(jinaUrl, {
      headers: { Accept: "text/plain" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return "";
    const text = await res.text();
    return text.slice(0, 2000);
  } catch {
    return "";
  }
}

async function callClaude(input: string, retryCount = 0): Promise<Record<string, unknown>> {
  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  const isRetry = retryCount > 0;
  const model = "claude-haiku-4-5-20251001";
  const timeoutMs = isRetry ? 20000 : 45000;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  // Explicit JSON-only instruction appended to system prompt
  const jsonSystemPrompt = SYSTEM_PROMPT + `\n\n【最重要ルール】\nあなたの返答はJSONオブジェクトのみです。\n最初の文字は { で、最後の文字は } でなければなりません。\nマークダウン、コードブロック（\`\`\`）、説明文は一切含めないでください。`;

  let message;
  try {
    message = await client.messages.create(
      {
        model,
        max_tokens: 1200,
        temperature: 0,
        system: jsonSystemPrompt,
        messages: [
          {
            role: "user",
            content: isRetry
              ? `簡潔に分析してください（各項目は短く）:\n\n${input.slice(0, 1000)}`
              : `以下のプロダクトを分析してください:\n\n${input}`,
          },
        ],
      },
      { signal: controller.signal }
    );
    clearTimeout(timeout);
  } catch (apiError) {
    clearTimeout(timeout);
    const msg = apiError instanceof Error ? apiError.message : String(apiError);
    console.error(`[analyze] Claude API call failed (attempt ${retryCount + 1}):`, msg);

    if (retryCount < 2) {
      console.log("[analyze] Retrying...");
      return callClaude(input, retryCount + 1);
    }
    throw new Error(`Claude API error: ${msg}`);
  }

  const textBlock = message.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    if (retryCount < 2) return callClaude(input, retryCount + 1);
    throw new Error("No text response from Claude");
  }

  const rawText = textBlock.text.trim();
  console.log(`[analyze] Raw response (attempt ${retryCount + 1}, ${rawText.length} chars):`, rawText.substring(0, 500));

  // Try parsing
  const parsed = tryParseJSON(rawText);
  if (parsed) return parsed;

  // All parse strategies failed — retry
  if (retryCount < 2) {
    console.log(`[analyze] Parse failed, retrying (attempt ${retryCount + 2})...`);
    return callClaude(input, retryCount + 1);
  }

  console.error("[analyze] FULL raw response dump:", rawText);
  throw new Error("Failed to parse Claude response as JSON after retries");
}

function tryParseJSON(rawText: string): Record<string, unknown> | null {
  // Strategy 1: Direct parse
  try {
    const obj = JSON.parse(rawText);
    if (typeof obj === "object" && obj !== null && !Array.isArray(obj)) {
      console.log("[analyze] Parse OK: Strategy 1 (direct)");
      return obj;
    }
  } catch { /* continue */ }

  // Strategy 2: Extract between first { and last }
  const result = extractAndParse(rawText);
  if (result) {
    console.log("[analyze] Parse OK: Strategy 2 (brace extraction)");
    return result;
  }

  // Strategy 3: Code block extraction
  const codeBlockMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    const cbResult = extractAndParse(codeBlockMatch[1].trim());
    if (cbResult) {
      console.log("[analyze] Parse OK: Strategy 3 (code block)");
      return cbResult;
    }
  }

  // Strategy 4: Line-by-line strip (remove lines before first { and after last })
  const lines = rawText.split("\n");
  const startLine = lines.findIndex(l => l.trim().startsWith("{"));
  const endLine = lines.length - 1 - [...lines].reverse().findIndex(l => l.trim().endsWith("}"));
  if (startLine >= 0 && endLine >= startLine) {
    const stripped = lines.slice(startLine, endLine + 1).join("\n");
    const s4 = extractAndParse(stripped);
    if (s4) {
      console.log("[analyze] Parse OK: Strategy 4 (line strip)");
      return s4;
    }
  }

  console.error("[analyze] All 4 parse strategies failed for:", rawText.substring(0, 300));
  return null;
}

function extractAndParse(text: string): Record<string, unknown> | null {
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || firstBrace >= lastBrace) return null;

  let jsonStr = text.substring(firstBrace, lastBrace + 1);

  // Fix common issues
  // 1. Remove trailing commas before } or ]
  jsonStr = jsonStr.replace(/,\s*([}\]])/g, "$1");
  // 2. Fix unescaped newlines inside strings (conservative approach)
  jsonStr = fixUnescapedNewlines(jsonStr);

  try {
    const obj = JSON.parse(jsonStr);
    if (typeof obj === "object" && obj !== null) return obj;
  } catch {
    // Try removing control characters
    try {
      const cleaned = jsonStr.replace(/[\x00-\x1F\x7F]/g, (ch) => {
        if (ch === "\n" || ch === "\r" || ch === "\t") return " ";
        return "";
      });
      const obj = JSON.parse(cleaned);
      if (typeof obj === "object" && obj !== null) return obj;
    } catch { /* give up */ }
  }
  return null;
}

function fixUnescapedNewlines(json: string): string {
  // Replace newlines that appear inside string values
  let inString = false;
  let escaped = false;
  let result = "";
  for (let i = 0; i < json.length; i++) {
    const ch = json[i];
    if (escaped) { result += ch; escaped = false; continue; }
    if (ch === "\\") { result += ch; escaped = true; continue; }
    if (ch === '"') { inString = !inString; result += ch; continue; }
    if (inString && ch === "\n") { result += "\\n"; continue; }
    if (inString && ch === "\r") { continue; }
    result += ch;
  }
  return result;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { url, description } = body;

    if (!url && !description) {
      return NextResponse.json(
        { error: "URLまたは説明文が必要です" },
        { status: 400 }
      );
    }

    let userMessage: string;
    if (url) {
      const pageContent = await fetchPageContent(url);
      userMessage = pageContent
        ? `URL: ${url}\n\nページ内容:\n${pageContent}`
        : `URL: ${url}\n\nこのURLのプロダクト・サービスを分析してください。`;
    } else {
      userMessage = `プロダクト説明:\n${description}`;
    }

    const result = await callClaude(userMessage);

    // Validate response has required structure
    if (!result.personas || !Array.isArray(result.personas) || result.personas.length === 0) {
      console.error("[analyze] Invalid result structure:", JSON.stringify(result).slice(0, 500));
      return NextResponse.json(
        { error: "分析結果の形式が不正です。もう一度お試しください。" },
        { status: 422 }
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    const errStack = error instanceof Error ? error.stack : "";
    console.error("Campaign analysis error:", errMsg, "\nStack:", errStack);

    if (error instanceof Error && (error.name === "AbortError" || errMsg.includes("aborted"))) {
      return NextResponse.json(
        { error: "分析がタイムアウトしました。もう一度お試しください。" },
        { status: 504 }
      );
    }

    return NextResponse.json(
      { error: `分析中にエラーが発生しました: ${errMsg}` },
      { status: 500 }
    );
  }
}
