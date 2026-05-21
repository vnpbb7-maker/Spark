import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function getEmailDomain(email: string): string {
  return email.split("@")[1] || "";
}

function getWebsiteDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export async function GET() {
  // Auth check via session cookie
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll() {},
      },
    }
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Fetch this user's sent_history
  const { data: sentHistory, error: shErr } = await supabaseAdmin
    .from("sent_history")
    .select("*")
    .eq("user_id", user.id)
    .order("sent_at", { ascending: false })
    .limit(500);

  if (shErr) {
    console.error("[analytics] sent_history error:", shErr.message);
    return NextResponse.json({ error: shErr.message }, { status: 500 });
  }

  const history = sentHistory || [];

  // Fetch all auth users (admin only) for conversion matching
  let authUsers: { id: string; email?: string; created_at: string }[] = [];
  try {
    const { data: { users } } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
    authUsers = users || [];
  } catch (e) {
    console.warn("[analytics] listUsers error:", e);
  }

  // Domain-based conversion matching
  const convertedDomains = new Set<string>();
  const conversionsMap = new Map<string, { userEmail: string; registeredAt: string }>();

  for (const u of authUsers) {
    if (!u.email) continue;
    const emailDomain = getEmailDomain(u.email);
    if (!emailDomain || emailDomain.includes("gmail") || emailDomain.includes("yahoo") || emailDomain.includes("hotmail") || emailDomain.includes("outlook") || emailDomain.includes("icloud")) continue;
    convertedDomains.add(emailDomain);
    conversionsMap.set(emailDomain, { userEmail: u.email, registeredAt: u.created_at });
  }

  // Tag each sent_history row with conversion status
  const taggedHistory = history.map((row: Record<string, unknown>) => {
    const domain = getWebsiteDomain((row.website_url as string) || "");
    const isConverted = domain
      ? [...convertedDomains].some((d) => d.includes(domain) || domain.includes(d))
      : false;
    const conversionInfo = domain
      ? [...conversionsMap.entries()].find(([d]) => d.includes(domain) || domain.includes(d))
      : undefined;
    return {
      ...row,
      converted: isConverted,
      converted_user_email: conversionInfo?.[1]?.userEmail || null,
      converted_at: conversionInfo?.[1]?.registeredAt || null,
    };
  });

  // Summary stats
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const totalSent = history.length;
  const weekSent = history.filter((h: Record<string, unknown>) => new Date(h.sent_at as string) > weekAgo).length;
  const totalConversions = taggedHistory.filter((h) => h.converted).length;
  const conversionRate = totalSent > 0 ? ((totalConversions / totalSent) * 100).toFixed(1) : "0.0";

  // Daily chart data (last 30 days)
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const dailyMap = new Map<string, number>();
  for (let d = new Date(thirtyDaysAgo); d <= now; d.setDate(d.getDate() + 1)) {
    dailyMap.set(d.toISOString().split("T")[0], 0);
  }
  for (const h of history) {
    const day = (h.sent_at as string)?.split("T")[0];
    if (day && dailyMap.has(day)) {
      dailyMap.set(day, (dailyMap.get(day) || 0) + 1);
    }
  }
  const dailyData = [...dailyMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({
      date: date.slice(5), // MM-DD
      count,
    }));

  return NextResponse.json({
    stats: { totalSent, weekSent, totalConversions, conversionRate },
    dailyData,
    history: taggedHistory,
  });
}
