import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

// Extend Vercel timeout (Pro: 300s, Hobby: 60s)
export const maxDuration = 60;

// System prompt moved inline to callClaude for simplicity

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
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const userPrompt = `以下のプロダクトを分析して、困っている日本人ユーザーを3パターン特定してください。

${input.slice(0, 2000)}

以下のJSON形式で返してください。JSONのみ、他のテキストは不要です:
{"personas":[{"label":"ペルソナ名","pain_scene":"困っている場面","current_workaround":"今の対処法","reddit_communities":["r/xxx"],"twitter_keywords":["キーワード1","キーワード2","キーワード3"],"real_tweet_example":"投稿例","message_angle":"アプローチ角度","avoid_phrases":["避ける表現"],"discovery_signals":["発見シグナル1","発見シグナル2"]}],"recommended_platforms":["twitter","note"],"positioning":"差別化ポイント"}`;

  try {
    console.log(`[analyze] Calling Claude (attempt ${retryCount + 1})...`);
    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2000,
      temperature: 0,
      system: "You are a JSON generator. Respond with ONLY valid JSON. No markdown, no code blocks, no explanation. Start with { and end with }. All content must be in Japanese.",
      messages: [{ role: "user", content: userPrompt }],
    });

    const rawText = (message.content[0]?.type === "text" ? message.content[0].text : "").trim();
    console.log(`[analyze] Raw response (${rawText.length} chars):`, rawText.substring(0, 500));

    if (!rawText) {
      if (retryCount < 2) return callClaude(input, retryCount + 1);
      throw new Error("Empty response from Claude");
    }

    // Try direct parse
    try {
      const obj = JSON.parse(rawText);
      console.log("[analyze] Direct parse OK");
      return obj;
    } catch { /* continue */ }

    // Extract between first { and last }
    const start = rawText.indexOf("{");
    const end = rawText.lastIndexOf("}");
    if (start !== -1 && end > start) {
      let jsonStr = rawText.substring(start, end + 1);
      // Fix trailing commas
      jsonStr = jsonStr.replace(/,\s*([}\]])/g, "$1");

      try {
        const obj = JSON.parse(jsonStr);
        console.log("[analyze] Brace extraction parse OK");
        return obj;
      } catch {
        // Fix unescaped newlines in strings
        jsonStr = jsonStr.replace(/[\r\n]+/g, " ");
        try {
          const obj = JSON.parse(jsonStr);
          console.log("[analyze] Newline-fixed parse OK");
          return obj;
        } catch (e) {
          console.error("[analyze] Parse error after fixes:", (e as Error).message);
          console.error("[analyze] JSON substring (first 300):", jsonStr.substring(0, 300));
        }
      }
    }

    // Code block extraction
    const cbMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (cbMatch) {
      try {
        const obj = JSON.parse(cbMatch[1].trim());
        console.log("[analyze] Code block parse OK");
        return obj;
      } catch { /* continue */ }
    }

    if (retryCount < 2) {
      console.log("[analyze] All parse failed, retrying...");
      return callClaude(input, retryCount + 1);
    }

    console.error("[analyze] FULL DUMP:", rawText);
    throw new Error("Failed to parse Claude response as JSON after retries");
  } catch (err) {
    if (err instanceof Error && err.message.includes("Failed to parse")) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[analyze] API error (attempt ${retryCount + 1}):`, msg);
    if (retryCount < 2) return callClaude(input, retryCount + 1);
    throw new Error(`Claude API error: ${msg}`);
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
