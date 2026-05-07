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

  // Use Haiku for speed (retries use even simpler prompt)
  const isRetry = retryCount > 0;
  const model = "claude-haiku-4-5-20251001";
  const timeoutMs = isRetry ? 20000 : 40000;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let message;
  try {
    message = await client.messages.create(
      {
        model,
        max_tokens: 1000,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: isRetry
              ? `簡潔に分析してください（各項目は短く）:\n\n${input.slice(0, 1000)}`
              : `以下のプロダクトを分析してください:\n\n${input}`,
          },
          {
            role: "assistant",
            content: "{",
          },
        ],
      },
      { signal: controller.signal }
    );
    clearTimeout(timeout);
  } catch (apiError) {
    clearTimeout(timeout);
    const msg = apiError instanceof Error ? apiError.message : String(apiError);
    console.error(`Claude API call failed (attempt ${retryCount + 1}):`, msg);

    // Retry once on timeout/abort
    if (retryCount < 1) {
      console.log("Retrying with simpler prompt...");
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
  console.log(`[analyze] Raw response (attempt ${retryCount + 1}, ${rawText.length} chars):`, rawText.substring(0, 400));

  // Try multiple parsing strategies
  const parsed = tryParseJSON(rawText, retryCount);
  if (parsed) return parsed;

  // All parse strategies failed — retry with fresh API call
  if (retryCount < 2) {
    console.log(`[analyze] Parse failed, retrying (attempt ${retryCount + 2})...`);
    return callClaude(input, retryCount + 1);
  }

  console.error("[analyze] FULL raw response dump:", rawText);
  throw new Error("Failed to parse Claude response as JSON after retries");
}

function tryParseJSON(rawText: string, _attempt: number): Record<string, unknown> | null {
  // Strategy 1: Prepend "{" (prefill) and parse directly
  const withPrefill = "{" + rawText;
  const s1 = extractAndParse(withPrefill);
  if (s1) return s1;

  // Strategy 2: Parse raw text as-is (model may have included the "{")
  const s2 = extractAndParse(rawText);
  if (s2) return s2;

  // Strategy 3: Find JSON in code block
  const codeBlockMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    const s3 = extractAndParse(codeBlockMatch[1].trim());
    if (s3) return s3;
  }

  return null;
}

function extractAndParse(text: string): Record<string, unknown> | null {
  // Find the outermost { ... }
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || firstBrace >= lastBrace) return null;

  let jsonStr = text.substring(firstBrace, lastBrace + 1);

  // Fix common issues
  // 1. Remove trailing commas before } or ]
  jsonStr = jsonStr.replace(/,\s*([}\]])/g, "$1");
  // 2. Fix unescaped newlines inside string values
  jsonStr = jsonStr.replace(/(?<=":[ ]*"[^"]*)\n/g, "\\n");

  try {
    const obj = JSON.parse(jsonStr);
    if (typeof obj === "object" && obj !== null) return obj;
  } catch {
    // Try one more fix: replace single quotes with double quotes
    try {
      const fixed = jsonStr.replace(/'/g, '"');
      const obj = JSON.parse(fixed);
      if (typeof obj === "object" && obj !== null) return obj;
    } catch {
      // Failed
    }
  }
  return null;
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
