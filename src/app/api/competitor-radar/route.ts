import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;
export const runtime = "nodejs";

interface TavilyResult {
  url: string;
  title?: string;
  content?: string;
  score?: number;
}

async function tavilySearch(query: string, maxResults = 8): Promise<TavilyResult[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) { console.error("[competitor-radar] TAVILY_API_KEY is not set"); return []; }
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({ query, search_depth: "advanced", max_results: maxResults, include_answer: false, include_raw_content: false }),
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      console.error(`[competitor-radar] Tavily HTTP ${res.status} for query "${query.slice(0,60)}": ${errBody.slice(0,200)}`);
      return [];
    }
    const data = await res.json();
    return (data.results || []) as TavilyResult[];
  } catch (e) { console.error("[competitor-radar] tavilySearch fetch error:", e); return []; }
}

export async function POST(req: NextRequest) {
  try {
    const { competitors, product_url } = await req.json() as { competitors: string[]; product_url?: string };
    if (!competitors?.length) return NextResponse.json({ error: "競合名を入力してください" }, { status: 400 });

    const allResults: TavilyResult[] = [];
    const seenUrls = new Set<string>();

    // Parallel Tavily searches per competitor
    await Promise.all(competitors.slice(0, 5).map(async (competitor) => {
      const queries = [
        `site:reddit.com "${competitor}" "hate" OR "too expensive" OR "alternative" OR "switched"`,
        `site:producthunt.com "${competitor}" expensive OR alternative OR missing OR "wish it had"`,
        `site:twitter.com OR site:x.com "${competitor}" 高い OR 不満 OR 乗り換え OR 解約`,
        `"${competitor}" 評判 口コミ 悪い OR 高い OR 使いにくい OR 不満`,
        `site:apps.apple.com OR site:play.google.com "${competitor}" (1 star OR 2 star OR disappointing OR terrible)`,
      ];
      const searchResults = await Promise.all(queries.map(q => tavilySearch(q, 8)));
      for (const batch of searchResults) {
        for (const r of batch) {
          if (!seenUrls.has(r.url) && (r.content || r.title)) {
            seenUrls.add(r.url);
            allResults.push({ ...r, title: r.title || competitor });
          }
        }
      }
    }));

    if (allResults.length === 0) {
      return NextResponse.json({ complaints: [], summary: { total: 0, categories: {} }, win_points: [] });
    }

    // Build Claude analysis prompt
    const snippets = allResults.slice(0, 60).map((r, i) =>
      `[${i + 1}] URL: ${r.url}\nContent: ${(r.content || r.title || "").slice(0, 300)}`
    ).join("\n\n");

    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 2000,
        system: "You must respond with valid JSON only. No markdown, no explanation.",
        messages: [{
          role: "user",
          content: `以下は競合サービス「${competitors.join(", ")}」への不満コメント一覧です。
${product_url ? `分析対象プロダクト: ${product_url}` : ""}

各コメントについて:
1. カテゴリを以下から分類: 料金/機能不足/サポート/操作性/言語/その他
2. 主要な不満カテゴリ別件数を集計
3. 競合への不満を踏まえて「プロダクトが有利な点TOP3」「ユーザーが最も求めている機能TOP3」「推奨アウトリーチキーワード5個」を分析

コメント一覧:
${snippets}

以下のJSON形式で返してください:
{
  "complaints": [
    { "index": 1, "category": "料金", "snippet": "コメント要約30字以内", "url": "URL" }
  ],
  "summary": {
    "total": 件数,
    "categories": { "料金": 件数, "機能不足": 件数, "サポート": 件数, "操作性": 件数, "言語": 件数, "その他": 件数 }
  },
  "win_points": {
    "advantages": ["有利な点1", "有利な点2", "有利な点3"],
    "wanted_features": ["求める機能1", "求める機能2", "求める機能3"],
    "outreach_keywords": ["キーワード1", "キーワード2", "キーワード3", "キーワード4", "キーワード5"]
  }
}`,
        }],
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!claudeRes.ok) {
      return NextResponse.json({ complaints: allResults.slice(0, 30).map((r, i) => ({
        index: i + 1, category: "その他",
        snippet: (r.content || r.title || "").slice(0, 60),
        url: r.url,
      })), summary: { total: allResults.length, categories: {} }, win_points: null });
    }

    const claudeData = await claudeRes.json();
    const rawText = (claudeData.content?.[0]?.text || "").trim();
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return NextResponse.json({ error: "AI解析に失敗しました" }, { status: 500 });

    const parsed = JSON.parse(jsonMatch[0]);

    // Attach original URLs to complaints
    const enrichedComplaints = (parsed.complaints || []).map((c: { index: number; category: string; snippet: string; url: string }) => {
      const original = allResults[c.index - 1];
      return {
        ...c,
        url: original?.url || c.url,
        platform: detectPlatform(original?.url || ""),
      };
    });

    return NextResponse.json({
      complaints: enrichedComplaints,
      summary: parsed.summary || { total: allResults.length, categories: {} },
      win_points: parsed.win_points || null,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[competitor-radar] Unhandled error:", err);
    return NextResponse.json({
      error: msg || "サーバーエラーが発生しました",
      ...(process.env.NODE_ENV === "development" && err instanceof Error ? { stack: err.stack } : {}),
    }, { status: 500 });
  }
}

function detectPlatform(url: string): string {
  if (url.includes("reddit.com")) return "Reddit";
  if (url.includes("producthunt.com")) return "ProductHunt";
  if (url.includes("twitter.com") || url.includes("x.com")) return "Twitter/X";
  if (url.includes("apps.apple.com")) return "App Store";
  if (url.includes("play.google.com")) return "Google Play";
  if (url.includes("google.com/maps")) return "Googleマップ";
  return "Web";
}
