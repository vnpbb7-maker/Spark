import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";

// Service role client — bypasses RLS
function getAdminSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET() {
  try {
    // Get authenticated user via server client (cookie-based)
    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const admin = getAdminSupabase();

    // Fetch campaigns for this user
    const { data: camps, error: campErr } = await admin
      .from("campaigns")
      .select("id, product_url, product_description, platforms, status, created_at, daily_limit")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (campErr) {
      console.error("[dashboard API] campaigns error:", campErr.message);
      return NextResponse.json({ error: campErr.message }, { status: 500 });
    }

    if (!camps || camps.length === 0) {
      return NextResponse.json({ campaigns: [], targets: [], stats: { total: 0, sa: 0, contacts: 0, todayNew: 0 } });
    }

    const campIds = camps.map((c) => c.id);
    console.log(`[dashboard API] user=${user.id.slice(0, 8)} campaigns=${campIds.length}`);

    // Fetch ALL targets for these campaigns using service role (no RLS)
    const { data: targets, error: tgtErr } = await admin
      .from("targets")
      .select("id, campaign_id, username, platform, match_score, priority, email, created_at, website, phone")
      .in("campaign_id", campIds)
      .order("match_score", { ascending: false });

    if (tgtErr) {
      console.error("[dashboard API] targets error:", tgtErr.message);
    }

    const tgts = targets || [];
    console.log(`[dashboard API] targets fetched: ${tgts.length}`);

    // Contact check (email OR DM-capable platform)
    const SNS_DM = ["reddit", "twitter", "wantedly"];
    const hasContact = (t: { email: string | null; platform: string }) => {
      const hasEmail = t.email && !t.email.startsWith("Twitter:") && !t.email.startsWith("DM:") && t.email.includes("@");
      return hasEmail || SNS_DM.includes(t.platform);
    };

    // Enrich campaigns with target stats
    const enriched = camps.map((c) => {
      const ct = tgts.filter((t) => t.campaign_id === c.id);
      return {
        ...c,
        targets_count: ct.length,
        sa_count: ct.filter((t) => t.priority === "S" || t.priority === "A").length,
        contact_count: ct.filter(hasContact).length,
      };
    });

    // Global stats
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const stats = {
      total: tgts.length,
      sa: tgts.filter((t) => t.priority === "S" || t.priority === "A").length,
      contacts: tgts.filter(hasContact).length,
      todayNew: tgts.filter((t) => new Date(t.created_at) >= today).length,
    };

    // Top targets (S+A)
    const topTargets = tgts
      .filter((t) => t.priority === "S" || t.priority === "A")
      .slice(0, 5)
      .map((t) => ({
        id: t.id, campaign_id: t.campaign_id, username: t.username,
        platform: t.platform, match_score: t.match_score, priority: t.priority,
      }));

    // Recent activity feed
    const activities = tgts.slice(0, 8).flatMap((t, i) => {
      const ts = new Date(t.created_at).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
      return [
        { id: `a-${i * 2}`, icon: "🔍", text: `${t.platform}で発見: @${t.username} (${t.match_score}%)`, color: "#1d9bf0", time: ts, type: "discover" },
        t.priority ? { id: `a-${i * 2 + 1}`, icon: "🧠", text: `AI分析: @${t.username} → ${t.priority}ランク`, color: "#ffd60a", time: ts, type: "score" } : null,
      ].filter(Boolean);
    }).slice(0, 10);

    console.log(`[dashboard API] stats:`, stats);

    return NextResponse.json({ campaigns: enriched, stats, topTargets, activities });
  } catch (err) {
    console.error("[dashboard API] unexpected error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
