import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 300;

const getSupabase = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

// SNS系はフォーム送信対象外 — スキップ
const SNS_PLATFORMS = ["reddit", "twitter", "x", "note", "linkedin", "zenn", "qiita", "hatena", "producthunt", "producthunt_competitor", "google_maps_review", "web"];

// GoogleマップURLをcontact_urlに保存しない
const isInvalidContactUrl = (url: string): boolean => {
  if (!url) return true;
  try { new URL(url); } catch { return true; } // malformed URL
  if (url.includes("google.com/maps")) return true;
  if (url.includes("goo.gl")) return true;
  if (url.includes("maps.app")) return true;
  if (url.includes("maps.google")) return true;
  return false;
};

// 取得したURLがターゲットwebsiteと同一ドメインか検証
const isSameDomain = (websiteUrl: string, contactUrl: string): boolean => {
  try {
    const targetHost = new URL(websiteUrl).hostname.replace(/^www\./, "");
    const contactHost = new URL(contactUrl).hostname.replace(/^www\./, "");
    return contactHost === targetHost || contactHost.endsWith(`.${targetHost}`);
  } catch {
    return false;
  }
};

const CONTACT_KEYWORDS = ["contact", "inquiry", "お問い合わせ", "toiawase", "contact-us", "form", "otoiawase", "問い合わせ", "問合"];
const CONTACT_PATH_CANDIDATES = ["/contact", "/inquiry", "/contact-us", "/form", "/お問い合わせ", "/toiawase", "/contact_us", "/contactus"];

async function findContactUrl(websiteUrl: string): Promise<string | null> {
  if (!websiteUrl || !websiteUrl.startsWith("http")) return null;

  const base = websiteUrl.replace(/\/$/, "");

  // Step 1: HEAD チェック（高速・Firecrawl不要）
  for (const path of CONTACT_PATH_CANDIDATES) {
    try {
      const candidate = base + path;
      const r = await fetch(candidate, { method: "HEAD", signal: AbortSignal.timeout(3000), redirect: "follow" });
      if (r.ok) {
        console.log(`[find-contact-urls] Found via HEAD: ${candidate}`);
        return candidate;
      }
    } catch { /* continue */ }
  }

  // Step 2: Firecrawl でリンク一覧を取得
  const firecrawlKey = process.env.FIRECRAWL_API_KEY;
  if (!firecrawlKey) {
    console.warn("[find-contact-urls] FIRECRAWL_API_KEY not set — skipping Firecrawl");
    return null;
  }

  try {
    const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${firecrawlKey}` },
      body: JSON.stringify({ url: websiteUrl, formats: ["links"], timeout: 8000 }),
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) {
      console.warn(`[find-contact-urls] Firecrawl ${res.status} for ${websiteUrl}`);
      return null;
    }
    const data = await res.json();
    const links: string[] = data.data?.links || [];
    console.log(`[find-contact-urls] Firecrawl returned ${links.length} links for ${websiteUrl}`);

    // キーワードマッチ + 同一ドメイン検証
    const found = links.find(l => {
      if (isInvalidContactUrl(l)) return false;
      if (!isSameDomain(websiteUrl, l)) return false;
      return CONTACT_KEYWORDS.some(kw => l.toLowerCase().includes(kw));
    });

    if (found) console.log(`[find-contact-urls] Found via Firecrawl: ${found}`);
    else console.log(`[find-contact-urls] No contact link found for ${websiteUrl}`);
    return found || null;
  } catch (e) {
    console.error("[find-contact-urls] Firecrawl error:", e);
    return null;
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: campaignId } = await params;
  const supabase = getSupabase();

  // contact_url が null かつ website がある google_maps ターゲットのみ対象
  const { data: targets, error } = await supabase
    .from("targets")
    .select("id, username, platform, website, contact_url")
    .eq("campaign_id", campaignId)
    .is("contact_url", null)
    .not("website", "is", null)
    .neq("website", "")
    .limit(30);

  if (error) {
    console.error("[find-contact-urls] query error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // SNS系・Googleマップ系以外のプラットフォームをフィルタ
  const eligible = (targets || []).filter(t => {
    const platform = ((t.platform as string) || "").toLowerCase();
    if (SNS_PLATFORMS.includes(platform)) {
      console.log(`[find-contact-urls] Skip SNS platform: ${platform} (${t.username})`);
      return false;
    }
    return true;
  });

  console.log(`[find-contact-urls] campaign=${campaignId} total=${targets?.length ?? 0} eligible=${eligible.length} firecrawl=${process.env.FIRECRAWL_API_KEY ? "SET" : "NOT SET"}`);

  if (!eligible.length) {
    return NextResponse.json({ updated: 0, message: "対象なし（SNS除外後）", debug: { campaignId, total: targets?.length ?? 0 } });
  }

  let updated = 0;
  const results: { id: string; username: string; contactUrl: string | null; skipped?: string }[] = [];

  const CONCURRENCY = 3;
  for (let i = 0; i < eligible.length; i += CONCURRENCY) {
    const batch = eligible.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(batch.map(async (t) => {
      const websiteUrl = (t.website as string) || "";
      const username = (t.username as string) || String(t.id);

      if (!websiteUrl) {
        return { id: t.id as string, username, contactUrl: null, skipped: "no website" };
      }

      const contactUrl = await findContactUrl(websiteUrl);

      // 取得できても無効URL・異なるドメインはスキップ
      if (!contactUrl) {
        return { id: t.id as string, username, contactUrl: null };
      }
      if (isInvalidContactUrl(contactUrl)) {
        console.log(`[find-contact-urls] Rejected Maps URL for ${username}: ${contactUrl}`);
        return { id: t.id as string, username, contactUrl: null, skipped: "maps_url" };
      }
      if (!isSameDomain(websiteUrl, contactUrl)) {
        console.log(`[find-contact-urls] Rejected cross-domain URL for ${username}: ${contactUrl}`);
        return { id: t.id as string, username, contactUrl: null, skipped: "cross_domain" };
      }

      // DB 保存
      const { error: updateErr } = await supabase
        .from("targets")
        .update({ contact_url: contactUrl })
        .eq("id", t.id);

      if (updateErr) {
        console.error(`[find-contact-urls] Update error for ${username}:`, updateErr.message);
        return { id: t.id as string, username, contactUrl: null };
      }

      console.log(`[find-contact-urls] ✅ Saved contact_url for ${username}: ${contactUrl}`);
      return { id: t.id as string, username, contactUrl, didUpdate: true };
    }));

    for (const r of batchResults) {
      results.push(r);
      if ((r as { didUpdate?: boolean }).didUpdate) updated++;
    }
  }

  return NextResponse.json({ updated, total: eligible.length, results });
}
