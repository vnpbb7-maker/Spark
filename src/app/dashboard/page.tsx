"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useRealtimeLog } from "@/hooks/useRealtimeLog";
import KpiCards from "@/components/dashboard/KpiCards";
import CampaignList from "@/components/dashboard/CampaignList";
import DashboardLiveLog from "@/components/dashboard/DashboardLiveLog";
import PendingBanner from "@/components/dashboard/PendingBanner";

const NAV_ITEMS = [
  { label: "ダッシュボード", href: "/dashboard", icon: "📊", active: true },
  { label: "キャンペーン", href: "/campaigns/new", icon: "🚀" },
  { label: "承認待ち", href: "/dashboard", icon: "✍", badge: true },
  { label: "アナリティクス", href: "/dashboard", icon: "📈" },
  { label: "設定", href: "/dashboard", icon: "⚙️" },
];

export default function DashboardPage() {
  const router = useRouter();
  const supabase = createClient();
  const logs = useRealtimeLog();
  const [user, setUser] = useState<{ email?: string } | null>(null);
  const [campaigns, setCampaigns] = useState<Array<Record<string, unknown>>>([]);
  const [kpi, setKpi] = useState({ targetsFound: 0, pendingComments: 0, postedComments: 0, conversions: 0, prevTargets: 0, prevPending: 0, prevPosted: 0, prevConversions: 0 });
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    const { data: { user: u } } = await supabase.auth.getUser();
    if (!u) { router.push("/auth/login"); return; }
    setUser(u);

    // Fetch campaigns
    const { data: camps } = await supabase.from("campaigns").select("*").eq("user_id", u.id).order("created_at", { ascending: false });

    if (camps) {
      const enriched = await Promise.all(camps.map(async (c) => {
        const { count: tc } = await supabase.from("targets").select("*", { count: "exact", head: true }).eq("campaign_id", c.id);
        const { count: pc } = await supabase.from("comments").select("*", { count: "exact", head: true }).eq("campaign_id", c.id).not("posted_at", "is", null);
        const { count: cc } = await supabase.from("comments").select("*", { count: "exact", head: true }).eq("campaign_id", c.id).not("responded_at", "is", null);
        return { ...c, targets_count: tc || 0, posted_count: pc || 0, conversion_count: cc || 0 };
      }));
      setCampaigns(enriched);

      // KPI
      const totalTargets = enriched.reduce((s, c) => s + (c.targets_count as number), 0);
      const totalPosted = enriched.reduce((s, c) => s + (c.posted_count as number), 0);
      const totalConversions = enriched.reduce((s, c) => s + (c.conversion_count as number), 0);
      const { count: pendCount } = await supabase.from("comments").select("*", { count: "exact", head: true }).eq("approved", false);
      setKpi({ targetsFound: totalTargets, pendingComments: pendCount || 0, postedComments: totalPosted, conversions: totalConversions, prevTargets: Math.max(0, totalTargets - 5), prevPending: Math.max(0, (pendCount || 0) - 2), prevPosted: Math.max(0, totalPosted - 3), prevConversions: Math.max(0, totalConversions - 1) });
    }
    setLoading(false);
  }, [supabase, router]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handlePause = async (id: string) => {
    const camp = campaigns.find((c) => c.id === id);
    const newStatus = camp?.status === "paused" ? "running" : "paused";
    await supabase.from("campaigns").update({ status: newStatus }).eq("id", id);
    fetchData();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("本当に削除しますか？")) return;
    await supabase.from("campaigns").delete().eq("id", id);
    fetchData();
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/");
  };

  if (loading) {
    return <div style={{ minHeight: "100vh", background: "#0d0d1a", display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(240,239,232,0.3)" }}>読み込み中...</div>;
  }

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "#0d0d1a", color: "#f0efe8" }}>
      {/* Sidebar */}
      <aside style={{ width: "240px", background: "#0a0a18", borderRight: "1px solid rgba(255,255,255,0.07)", display: "flex", flexDirection: "column", flexShrink: 0, position: "fixed", top: 0, bottom: 0, left: 0, zIndex: 40 }}>
        <div style={{ padding: "24px 20px", display: "flex", alignItems: "center", gap: "8px", fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: "20px" }}>
          <span style={{ color: "#ff6b35", fontSize: "22px" }}>⚡</span> SPARK
        </div>
        <nav style={{ flex: 1, padding: "0 12px" }}>
          {NAV_ITEMS.map((item) => (
            <a key={item.label} href={item.href} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "12px 14px", borderRadius: "10px", marginBottom: "4px", textDecoration: "none", fontSize: "14px", fontWeight: item.active ? 600 : 400, color: item.active ? "#ff6b35" : "rgba(240,239,232,0.5)", background: item.active ? "rgba(255,107,53,0.1)" : "transparent", transition: "all 0.2s" }}>
              <span style={{ fontSize: "16px" }}>{item.icon}</span>
              {item.label}
              {item.badge && kpi.pendingComments > 0 && (
                <span style={{ marginLeft: "auto", background: "#ff6b35", color: "#fff", fontSize: "10px", fontWeight: 700, borderRadius: "10px", padding: "2px 8px", minWidth: "20px", textAlign: "center" }}>{kpi.pendingComments}</span>
              )}
            </a>
          ))}
        </nav>
        <div style={{ padding: "16px 20px", borderTop: "1px solid rgba(255,255,255,0.07)", display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{ width: "32px", height: "32px", borderRadius: "50%", background: "rgba(255,107,53,0.2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "14px", fontWeight: 700, color: "#ff6b35" }}>
            {(user?.email || "U")[0].toUpperCase()}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: "12px", color: "#f0efe8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user?.email}</p>
          </div>
          <button onClick={handleLogout} style={{ background: "none", border: "none", color: "rgba(240,239,232,0.3)", cursor: "pointer", fontSize: "14px" }} title="ログアウト">↩</button>
        </div>
      </aside>

      {/* Main */}
      <div style={{ flex: 1, marginLeft: "240px", display: "flex" }}>
        <main style={{ flex: 1, padding: "32px 32px 32px 32px", minWidth: 0 }}>
          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "32px" }}>
            <div>
              <h1 style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: "24px", marginBottom: "4px" }}>おかえりなさい 👋</h1>
              <p style={{ fontSize: "14px", color: "rgba(240,239,232,0.4)" }}>{user?.email}</p>
            </div>
            <a href="/campaigns/new" style={{ background: "#ff6b35", color: "#fff", textDecoration: "none", padding: "12px 24px", borderRadius: "12px", fontSize: "14px", fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif", boxShadow: "0 0 20px rgba(255,107,53,0.35)" }}>
              + 新しいキャンペーン
            </a>
          </div>

          <KpiCards data={kpi} />
          <PendingBanner count={kpi.pendingComments} onNavigate={() => router.push("/dashboard")} />
          <CampaignList campaigns={campaigns as never[]} onPause={handlePause} onDelete={handleDelete} />
        </main>

        {/* Right sidebar - Live Log */}
        <aside style={{ width: "320px", borderLeft: "1px solid rgba(255,255,255,0.07)", flexShrink: 0, padding: "32px 16px" }}>
          <DashboardLiveLog logs={logs} />
        </aside>
      </div>
    </div>
  );
}
