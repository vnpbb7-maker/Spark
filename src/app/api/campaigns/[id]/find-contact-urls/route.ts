import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 300;

const getSupabase = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

const CONTACT_KEYWORDS = ["contact", "inquiry", "お問い合わせ", "toiawase", "contact-us", "form", "otoiawase", "問い合わせ"];
const CONTACT_PATH_CANDIDATES = ["/contact", "/inquiry", "/contact-us", "/form", "/お問い合わせ", "/toiawase"];

async function findContactUrl(websiteUrl: string): Promise<string | null> {
  if (!websiteUrl || !websiteUrl.startsWith("http")) return null;

  const base = websiteUrl.replace(/\/$/, "");

  // 1. Try common path patterns first (fast, no Firecrawl)
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

  // 2. Firecrawl scrape for links
  const firecrawlKey = process.env.FIRECRAWL_API_KEY;
  if (!firecrawlKey) return null;

  try {
    const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${firecrawlKey}` },
      body: JSON.stringify({ url: websiteUrl, formats: ["links"], timeout: 8000 }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const links: string[] = data.data?.links || [];
    const found = links.find(l =>
      CONTACT_KEYWORDS.some(kw => l.toLowerCase().includes(kw))
    );
    if (found) console.log(`[find-contact-urls] Found via Firecrawl: ${found}`);
    return found || null;
  } catch (e) {
    console.error("[find-contact-urls] Firecrawl error:", e);
    return null;
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const campaignId = params.id;
  const supabase = getSupabase();

  // Fetch targets without contact_url in this campaign
  const { data: targets, error } = await supabase
    .from("targets")
    .select("id, username, website, contact_url")
    .eq("campaign_id", campaignId)
    .is("contact_url", null)
    .not("website", "is", null)
    .neq("website", "")           // also skip empty strings
    .limit(30);

  console.log(`[find-contact-urls] campaign=${campaignId} candidates=${targets?.length ?? 0} firecrawl=${process.env.FIRECRAWL_API_KEY ? "SET" : "NOT SET"}`);
  if (error) console.error("[find-contact-urls] query error:", error.message);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!targets?.length) return NextResponse.json({ updated: 0, message: "対象なし", debug: { campaignId } });

  let updated = 0;
  const results: { id: string; username: string; contactUrl: string | null }[] = [];

  // Process in parallel (3 at a time)
  const CONCURRENCY = 3;
  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    const batch = targets.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(batch.map(async (t) => {
      const url = (t.website as string) || "";
      if (!url) return { id: t.id as string, username: (t.username as string) || "", contactUrl: null };
      const contactUrl = await findContactUrl(url);
      if (contactUrl) {
        await supabase.from("targets").update({ contact_url: contactUrl }).eq("id", t.id);
        return { id: t.id as string, username: (t.username as string) || "", contactUrl, didUpdate: true };
      }
      return { id: t.id as string, username: (t.username as string) || "", contactUrl: null };
    }));
    for (const r of batchResults) {
      results.push(r);
      if ((r as { didUpdate?: boolean }).didUpdate) updated++;
    }
  }

  return NextResponse.json({ updated, total: targets.length, results });
}
