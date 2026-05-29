import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const getSupabase = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: campaignId } = await params;

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

  const supabase = getSupabase();

  // Step1: wantedly.com を含む contact_url を null にリセット
  const { error: resetErr, count: resetCount } = await supabase
    .from("targets")
    .update({ contact_url: null })
    .eq("campaign_id", campaignId)
    .eq("platform", "wantedly")
    .like("contact_url", "%wantedly.com%");

  if (resetErr) {
    return NextResponse.json({ error: `Reset failed: ${resetErr.message}` }, { status: 500 });
  }
  console.log(`[fix-wantedly-batch] Reset ${resetCount ?? "?"} wantedly.com URLs to null`);

  // Step2: contact_url が null の全 Wantedly リードを取得
  const { data: nullTargets, error: fetchErr } = await supabase
    .from("targets")
    .select("id, username, website")
    .eq("campaign_id", campaignId)
    .eq("platform", "wantedly")
    .is("contact_url", null);

  if (fetchErr) {
    return NextResponse.json({ error: `Fetch failed: ${fetchErr.message}` }, { status: 500 });
  }

  const targets = (nullTargets || []) as Array<{ id: string; username: string; website: string | null }>;
  console.log(`[fix-wantedly-batch] ${targets.length} targets need contact URL`);

  if (!process.env.TAVILY_API_KEY) {
    return NextResponse.json({ error: "TAVILY_API_KEY not set" }, { status: 500 });
  }

  let fixed = 0;
  let failed = 0;
  const results: Array<{ id: string; company: string; contactUrl: string | null }> = [];

  for (const t of targets) {
    let contactUrl: string | null = null;
    try {
      const officialWebsite = t.website;
      const query = officialWebsite
        ? `site:${new URL(officialWebsite).hostname} お問い合わせ OR contact`
        : `${t.username} お問い合わせ contact`;

      const searchRes = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: process.env.TAVILY_API_KEY,
          query,
          search_depth: "basic",
          max_results: 5,
          ...(officialWebsite ? { include_domains: [new URL(officialWebsite).hostname] } : {}),
        }),
        signal: AbortSignal.timeout(8000),
      });

      if (searchRes.ok) {
        const data = await searchRes.json();
        const searchResults = (data.results || []) as Array<Record<string, unknown>>;
        let lineUrl: string | null = null;

        for (const r of searchResults) {
          const u = (r.url as string) || "";
          if (!isSafeUrl(u)) continue;
          if (FORM_PATH_RE.test(u)) { contactUrl = u; break; }
          if (!lineUrl && CHAT_PATH_RE.test(u)) lineUrl = u;
        }

        if (!contactUrl) {
          const PRIORITY_EMAILS = /(?:info|sales|contact|support|hello|inquiry)@[a-zA-Z0-9.-]+\.[a-z]{2,}/i;
          for (const r of searchResults) {
            const snippet = ((r.content as string) || "") + ((r.title as string) || "");
            const m = snippet.match(PRIORITY_EMAILS);
            if (m) { contactUrl = `mailto:${m[0]}`; break; }
          }
        }
        if (!contactUrl && lineUrl) contactUrl = lineUrl;
      }

      // 典型パスHEAD確認
      if (!contactUrl && t.website) {
        const origin = new URL(t.website).origin;
        const TYPICAL_PATHS = ["/contact", "/contact-us", "/inquiry", "/inquire", "/form", "/support", "/お問い合わせ"];
        for (const path of TYPICAL_PATHS) {
          try {
            const headRes = await fetch(`${origin}${path}`, { method: "HEAD", signal: AbortSignal.timeout(4000), redirect: "follow" });
            if (headRes.ok) { contactUrl = `${origin}${path}`; break; }
          } catch { /* skip */ }
        }
      }

      // フォールバック: 公式サイトトップ
      if (!contactUrl && t.website && isSafeUrl(t.website)) {
        contactUrl = t.website;
      }

      if (contactUrl) {
        await supabase.from("targets").update({ contact_url: contactUrl }).eq("id", t.id);
        fixed++;
        console.log(`[fix-wantedly-batch] ✅ ${t.username} → ${contactUrl}`);
      } else {
        failed++;
        console.log(`[fix-wantedly-batch] ❌ ${t.username}: not found`);
      }

      results.push({ id: t.id, company: t.username, contactUrl });

      // Rate limiting: Tavily APIへの負荷軽減
      await new Promise(r => setTimeout(r, 300));

    } catch (err) {
      failed++;
      console.log(`[fix-wantedly-batch] Error for ${t.username}:`, (err as Error).message);
      results.push({ id: t.id, company: t.username, contactUrl: null });
    }
  }

  return NextResponse.json({
    success: true,
    resetCount: resetCount ?? 0,
    total: targets.length,
    fixed,
    failed,
    results,
  });
}
