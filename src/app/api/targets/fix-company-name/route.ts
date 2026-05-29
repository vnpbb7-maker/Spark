import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const getSupabase = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

export async function POST(req: NextRequest) {
  const { target_id, slug } = await req.json().catch(() => ({}));
  if (!target_id || !slug) {
    return NextResponse.json({ error: "target_id and slug required" }, { status: 400 });
  }

  if (!process.env.TAVILY_API_KEY) {
    return NextResponse.json({ error: "TAVILY_API_KEY not set" }, { status: 500 });
  }

  try {
    // Tavilyで会社名を検索
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: process.env.TAVILY_API_KEY,
        query: `wantedly.com/companies/${slug} 会社名`,
        search_depth: "basic",
        max_results: 3,
      }),
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      return NextResponse.json({ error: "Tavily search failed" }, { status: 500 });
    }

    const data = await res.json();
    const results = (data.results || []) as Array<Record<string, unknown>>;

    // 検索結果タイトルから会社名を抽出
    // 例: "株式会社ABC | Wantedly" → "株式会社ABC"
    let companyName: string | null = null;
    for (const r of results) {
      const title = (r.title as string) || "";
      const content = (r.content as string) || "";
      const combined = `${title} ${content}`;

      // 法人格を含む文字列を抽出
      const corpMatch = combined.match(/([\u30A0-\u30FF\u3040-\u309F\u4E00-\u9FFF\uFF00-\uFFEF\w]+(?:株式会社|合同会社|有限会社|Inc\.|Co\.,|Ltd\.|LLC)[^\s|｜\-–—]{0,20})/u);
      if (corpMatch) {
        companyName = corpMatch[1].replace(/[|｜\-–—].*$/, "").trim();
        break;
      }

      // Wantedlyタイトルパターン: "Company Name | Wantedly"
      const wantedlyTitle = title.replace(/\s*[\|｜]\s*Wantedly.*$/i, "").replace(/\s*[\|｜]\s*ウォンテッドリー.*$/i, "").trim();
      if (wantedlyTitle && wantedlyTitle.length >= 2 && wantedlyTitle.length <= 50 && !wantedlyTitle.toLowerCase().includes("wantedly")) {
        companyName = wantedlyTitle;
        break;
      }
    }

    if (!companyName) {
      return NextResponse.json({ companyName: null, message: "Company name not found" });
    }

    // Supabaseのusernameを更新
    const { error } = await getSupabase()
      .from("targets")
      .update({ username: companyName })
      .eq("id", target_id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    console.log(`[fix-company-name] ${slug} → "${companyName}"`);
    return NextResponse.json({ companyName });
  } catch (err: unknown) {
    const e = err as Error;
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
