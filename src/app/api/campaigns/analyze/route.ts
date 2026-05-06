import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const SYSTEM_PROMPT = `あなたはスタートアップのGrowth専門家です。
以下のプロダクト情報を分析し、結果をJSON形式で返してください。

【重要】有効なJSONのみを返すこと。マークダウン、説明文、コードブロック（\`\`\`）は一切不要。生のJSONだけを返してください。

重要：
- URLが入力された場合、そのURLのサービス・プロダクトを分析する
- 個人のSNSアカウント（instagram.com/@xxx等）の場合は
  そのアカウントのブランド・コンテンツを分析する
- 分析対象はURLまたは説明文に記載されたプロダクト・サービスそのもの

{
  "core_value": "プロダクトの本質的価値（1文・40字以内）",
  "problem_solved": "解決している問題（1文）",
  "personas": [
    {
      "name": "ペルソナ名",
      "description": "どんな人か（2文）",
      "pain_points": ["悩み1","悩み2","悩み3"],
      "where_to_find": {
        "twitter": ["キーワード1","キーワード2"],
        "reddit": ["r/sub1","r/sub2"],
        "linkedin": ["職種1","業界1"],
        "tiktok": ["#tag1","#tag2"],
        "instagram": ["#tag1","#tag2"],
        "facebook": ["グループ名1","グループ名2"]
      },
      "keywords": ["kw1","kw2","kw3"]
    }
  ],
  "recommended_platforms": ["reddit","twitter"],
  "positioning": "競合との差別化（1文）"
}`;

async function fetchPageContent(url: string): Promise<string> {
  try {
    const jinaUrl = `https://r.jina.ai/${url}`;
    const res = await fetch(jinaUrl, {
      headers: {
        Accept: "text/plain",
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return "";
    const text = await res.text();
    return text.slice(0, 3000);
  } catch {
    return "";
  }
}

async function callClaude(input: string, retryCount = 0): Promise<Record<string, unknown>> {
  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  let message;
  try {
    message = await client.messages.create(
      {
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 1500,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: `以下のプロダクトを分析してください:\n\n${input}`,
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
    console.error("Claude API call failed:", msg);
    throw new Error(`Claude API error: ${msg}`);
  }

  const textBlock = message.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text response from Claude");
  }

  // Prepend the "{" we used as prefill
  let jsonStr = "{" + textBlock.text.trim();
  console.log("Raw Claude response (with prefill):", jsonStr.substring(0, 500));

  // Strip markdown code block wrappers if model still adds them
  const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1].trim();
  }

  // Extract the JSON object
  const firstBrace = jsonStr.indexOf("{");
  const lastBrace = jsonStr.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && firstBrace < lastBrace) {
    jsonStr = jsonStr.substring(firstBrace, lastBrace + 1);
  }

  try {
    return JSON.parse(jsonStr);
  } catch (parseErr) {
    console.error("JSON parse error (attempt", retryCount + 1, "):", parseErr, "\nRaw:", jsonStr.substring(0, 500));
    if (retryCount < 2) {
      return callClaude(input, retryCount + 1);
    }
    throw new Error("Failed to parse Claude response as JSON after retries");
  }
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

    return NextResponse.json(result);
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    const errStack = error instanceof Error ? error.stack : "";
    console.error("Campaign analysis error:", errMsg, "\nStack:", errStack);

    if (error instanceof Error && error.name === "AbortError") {
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
