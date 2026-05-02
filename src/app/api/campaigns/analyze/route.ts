import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const SYSTEM_PROMPT = `あなたはスタートアップのGrowth専門家です。
以下のプロダクト情報を分析し、
JSONのみで返してください。前置き不要。

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

async function callClaude(input: string, retryCount = 0): Promise<Record<string, unknown>> {
  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const message = await client.messages.create(
      {
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: `以下のプロダクトを分析してください:\n\n${input}`,
          },
        ],
      },
      { signal: controller.signal }
    );

    clearTimeout(timeout);

    const textBlock = message.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("No text response from Claude");
    }

    // Extract JSON from response (handle markdown code blocks)
    let jsonStr = textBlock.text.trim();
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    try {
      return JSON.parse(jsonStr);
    } catch {
      // Retry on JSON parse failure (max 2 retries)
      if (retryCount < 2) {
        return callClaude(input, retryCount + 1);
      }
      throw new Error("Failed to parse Claude response as JSON after retries");
    }
  } catch (error) {
    clearTimeout(timeout);
    throw error;
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

    const userMessage = url
      ? `以下のURLのプロダクト・サービスを分析してください：\n${url}\n\nURLからわかる情報（ドメイン名、パス、クエリパラメータなど）を元に、このプロダクトが何をするサービスかを推測して分析してください。`
      : `プロダクト説明:\n${description}`;

    const result = await callClaude(userMessage);

    return NextResponse.json(result);
  } catch (error) {
    console.error("Campaign analysis error:", error);

    if (error instanceof Error && error.name === "AbortError") {
      return NextResponse.json(
        { error: "分析がタイムアウトしました。もう一度お試しください。" },
        { status: 504 }
      );
    }

    return NextResponse.json(
      { error: "分析中にエラーが発生しました。" },
      { status: 500 }
    );
  }
}
