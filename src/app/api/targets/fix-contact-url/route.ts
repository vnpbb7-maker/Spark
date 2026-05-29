import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const getSupabase = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

export async function POST(req: NextRequest) {
  const { target_id, company_name, official_website } = await req.json().catch(() => ({}));
  if (!target_id || !company_name) {
    return NextResponse.json({ error: "target_id and company_name required" }, { status: 400 });
  }

  if (!process.env.TAVILY_API_KEY) {
    return NextResponse.json({ error: "TAVILY_API_KEY not set" }, { status: 500 });
  }

  const EXCLUDED_DOMAINS = ["wantedly.com", "twitter.com", "x.com", "facebook.com",
    "instagram.com", "linkedin.com", "youtube.com", "line.me", "t.co"];
  const IMAGE_EXT_RE = /\.(png|jpg|jpeg|gif|svg|webp|ico|bmp|pdf)(\?.*)?$/i;
  const isSafeUrl = (u: string) => {
    if (!u || IMAGE_EXT_RE.test(u)) return false;
    try { return !EXCLUDED_DOMAINS.some(ex => new URL(u).hostname.toLowerCase().includes(ex)); }
    catch { return false; }
  };

  const FORM_PATH_RE = /\/(contact|inquiry|inquire|form|support|お問い合わせ|問い合わせ|相談|資料請求|request|toiawase)/i;
  const CHAT_PATH_RE = /\/(line|chat|messenger|liff)/i;

  let contactUrl: string | null = null;

  try {
    // Step1: 会社名で「お問い合わせ」を直接検索
    const query = official_website
      ? `site:${new URL(official_website).hostname} お問い合わせ OR contact`
      : `${company_name} お問い合わせ contact`;

    const searchRes = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: process.env.TAVILY_API_KEY,
        query,
        search_depth: "basic",
        max_results: 5,
        ...(official_website ? { include_domains: [new URL(official_website).hostname] } : {}),
      }),
      signal: AbortSignal.timeout(8000),
    });

    if (searchRes.ok) {
      const data = await searchRes.json();
      const results = (data.results || []) as Array<Record<string, unknown>>;
      let lineUrl: string | null = null;

      for (const r of results) {
        const u = (r.url as string) || "";
        if (!isSafeUrl(u)) continue;
        if (FORM_PATH_RE.test(u)) { contactUrl = u; break; }           // 優先度1: フォーム
        if (!lineUrl && CHAT_PATH_RE.test(u)) lineUrl = u;             // 優先度3候補
      }

      // 優先度2: Tavilyのcontentからメールアドレスを探す
      if (!contactUrl) {
        const PRIORITY_EMAILS = /(?:info|sales|contact|support|hello|inquiry)@[a-zA-Z0-9.-]+\.[a-z]{2,}/i;
        for (const r of results) {
          const snippet = ((r.content as string) || "") + ((r.title as string) || "");
          const m = snippet.match(PRIORITY_EMAILS);
          if (m) { contactUrl = `mailto:${m[0]}`; break; }
        }
      }

      // 優先度3: LINE/チャット
      if (!contactUrl && lineUrl) contactUrl = lineUrl;

      console.log(`[fix-contact-url] Tavily (primary): ${contactUrl || "none"}`);
    }

    // Step2: 公式サイトドメインが分かる場合は典型パスをHEAD確認
    if (!contactUrl && official_website) {
      const origin = new URL(official_website).origin;
      const TYPICAL_PATHS = ["/contact", "/contact-us", "/inquiry", "/inquire", "/form", "/support", "/お問い合わせ", "/request"];
      for (const path of TYPICAL_PATHS) {
        try {
          const testUrl = `${origin}${path}`;
          const headRes = await fetch(testUrl, { method: "HEAD", signal: AbortSignal.timeout(4000), redirect: "follow" });
          if (headRes.ok) { contactUrl = testUrl; console.log(`[fix-contact-url] HEAD hit: ${testUrl}`); break; }
        } catch { /* skip */ }
      }
    }

    // Step3: フォールバックは公式サイトトップ
    if (!contactUrl && official_website && isSafeUrl(official_website)) {
      contactUrl = official_website;
      console.log(`[fix-contact-url] Fallback to official site: ${contactUrl}`);
    }

    if (!contactUrl) {
      return NextResponse.json({ contactUrl: null, message: "Contact URL not found" });
    }

    // Supabase更新
    const { error } = await getSupabase()
      .from("targets")
      .update({ contact_url: contactUrl })
      .eq("id", target_id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    console.log(`[fix-contact-url] ${company_name} → "${contactUrl}"`);
    return NextResponse.json({ contactUrl });
  } catch (err: unknown) {
    const e = err as Error;
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
