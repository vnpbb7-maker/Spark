import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const getSupabase = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

export async function POST(req: NextRequest) {
  const { target_id, company_name, official_website, platform } =
    await req.json().catch(() => ({}));
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
  let foundFormPage = false;

  const platformLabel = platform || "unknown";

  try {
    // Step1: Tavilyで「site:domain お問い合わせ OR contact」検索
    let tavilyDomain: string | null = null;
    try { if (official_website) tavilyDomain = new URL(official_website).hostname; } catch {}

    const query = tavilyDomain
      ? `site:${tavilyDomain} お問い合わせ OR contact`
      : `${company_name} お問い合わせ OR contact`;

    const searchRes = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: process.env.TAVILY_API_KEY,
        query,
        search_depth: "basic",
        max_results: 5,
        ...(tavilyDomain ? { include_domains: [tavilyDomain] } : {}),
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
        if (FORM_PATH_RE.test(u)) { contactUrl = u; foundFormPage = true; break; }
        if (!lineUrl && CHAT_PATH_RE.test(u)) lineUrl = u;
      }

      // 優先度2: Tavilyのcontentからメールアドレスを探す
      if (!contactUrl) {
        const PRIORITY_EMAILS = /(?:info|sales|contact|support|hello|inquiry)@[a-zA-Z0-9.-]+\.[a-z]{2,}/i;
        for (const r of results) {
          const snippet = ((r.content as string) || "") + ((r.title as string) || "");
          const m = snippet.match(PRIORITY_EMAILS);
          if (m) { contactUrl = `mailto:${m[0]}`; foundFormPage = true; break; }
        }
      }

      // 優先度3: LINE/チャット
      if (!contactUrl && lineUrl) { contactUrl = lineUrl; foundFormPage = true; }

      console.log(`[fix-contact-url][${platformLabel}] Tavily: ${contactUrl || "none"}`);
    }

    // Step2: 典型パスをHEADリクエストで確認
    if (!contactUrl && official_website) {
      const origin = new URL(official_website).origin;
      const TYPICAL_PATHS = [
        "/contact", "/contact-us", "/inquiry", "/inquire",
        "/form", "/support", "/お問い合わせ", "/request",
      ];
      for (const path of TYPICAL_PATHS) {
        try {
          const testUrl = `${origin}${path}`;
          const headRes = await fetch(testUrl, { method: "HEAD", signal: AbortSignal.timeout(4000), redirect: "follow" });
          if (headRes.ok) {
            contactUrl = testUrl;
            foundFormPage = true;
            console.log(`[fix-contact-url][${platformLabel}] HEAD hit: ${testUrl}`);
            break;
          }
        } catch { /* skip */ }
      }
    }

    // Step3: PlaywrightサーバーにURLクロールを依頼（フォームリンクを探す）
    if (!contactUrl && official_website && process.env.PLAYWRIGHT_SERVER_URL && process.env.PLAYWRIGHT_API_KEY) {
      console.log(`[fix-contact-url][${platformLabel}] Trying Playwright crawl for ${official_website}`);
      try {
        const crawlRes = await fetch(`${process.env.PLAYWRIGHT_SERVER_URL}/find-contact-link`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": process.env.PLAYWRIGHT_API_KEY,
          },
          body: JSON.stringify({ website_url: official_website }),
          signal: AbortSignal.timeout(25000),
        });
        if (crawlRes.ok) {
          const crawlData = await crawlRes.json() as Record<string, unknown>;
          const found = crawlData.contactUrl as string | null;
          if (found && isSafeUrl(found)) {
            contactUrl = found;
            foundFormPage = true;
            console.log(`[fix-contact-url][${platformLabel}] Playwright found: ${found}`);
          }
        }
      } catch (crawlErr) {
        console.warn(`[fix-contact-url][${platformLabel}] Playwright crawl failed:`, (crawlErr as Error).message);
      }
    }

    // Step4: フォールバックは公式サイトトップ（Playwrightに任せる）
    if (!contactUrl && official_website && isSafeUrl(official_website)) {
      contactUrl = official_website;
      console.log(`[fix-contact-url][${platformLabel}] Fallback to official top: ${contactUrl}`);
    }

    // Step5: それでもなければ「フォームなし」として no_form ステータスに更新
    if (!contactUrl) {
      console.log(`[fix-contact-url][${platformLabel}] No contact found for ${company_name} → marking as no_form`);
      await getSupabase()
        .from("targets")
        .update({ contact_url: null, status: "no_form" })
        .eq("id", target_id);
      return NextResponse.json({ contactUrl: null, foundFormPage: false, noForm: true, message: "フォームが見つかりませんでした。スキップタブに移動します。" });
    }

    // DB更新
    const { error } = await getSupabase()
      .from("targets")
      .update({ contact_url: contactUrl })
      .eq("id", target_id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    console.log(`[fix-contact-url][${platformLabel}] ${company_name} → "${contactUrl}" (formPage=${foundFormPage})`);
    return NextResponse.json({ contactUrl, foundFormPage });
  } catch (err: unknown) {
    const e = err as Error;
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
