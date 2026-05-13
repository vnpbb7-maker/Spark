"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const PLATFORM_ICONS: Record<string, { icon: string; label: string }> = {
  twitter: { icon: "𝕏", label: "X" }, reddit: { icon: "🤖", label: "Reddit" },
  note: { icon: "📝", label: "note" }, zenn: { icon: "📘", label: "Zenn" },
  qiita: { icon: "💻", label: "Qiita" }, hatena: { icon: "B!", label: "はてな" },
  yahoo_qa: { icon: "🟡", label: "Yahoo知恵袋" }, wantedly: { icon: "🤝", label: "Wantedly" },
  connpass: { icon: "🎪", label: "Connpass" }, producthunt: { icon: "🚀", label: "ProductHunt" },
  peatix: { icon: "🎟️", label: "Peatix" }, discord: { icon: "💬", label: "Discord" },
  google_maps: { icon: "🗺️", label: "Googleマップ" }, web: { icon: "🌐", label: "Web" },
};

const PRIORITY_STYLE: Record<string, { bg: string; color: string }> = {
  S: { bg: "linear-gradient(135deg, #ffd700, #ffaa00)", color: "#000" },
  A: { bg: "linear-gradient(135deg, #2dd17a, #1ba360)", color: "#fff" },
  B: { bg: "linear-gradient(135deg, #3ea8ff, #2d7fd3)", color: "#fff" },
  C: { bg: "rgba(255,255,255,0.08)", color: "rgba(240,239,232,0.4)" },
};

const STATUS_MAP: Record<string, { dot: string; label: string; color: string }> = {
  running: { dot: "🟢", label: "稼働中", color: "#2dd17a" },
  paused: { dot: "🟡", label: "一時停止", color: "#ffd60a" },
  completed: { dot: "⚫", label: "完了", color: "rgba(240,239,232,0.4)" },
};

const NAV_ITEMS = [
  { label: "ダッシュボード", href: "/dashboard", icon: "📊", active: true },
  { label: "キャンペーン", href: "/campaigns/new", icon: "🚀" },
  { label: "アナリティクス", href: "/analytics", icon: "📈" },
  { label: "設定", href: "/settings", icon: "⚙️" },
];

type CampaignRow = {
  id: string; product_url: string; product_description: string; platforms: string[];
  status: string; created_at: string;
  targets_count: number; sa_count: number; contact_count: number;
};

type TopTarget = {
  id: string; campaign_id: string; username: string; platform: string;
  match_score: number; priority: string;
};

type ActivityItem = { id: string; icon: string; text: string; color: string; time: string; type: string };

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<{ email?: string } | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [stats, setStats] = useState({ total: 0, sa: 0, contacts: 0, exported: 0, todayNew: 0 });
  const [topTargets, setTopTargets] = useState<TopTarget[]>([]);
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    const supabase = createClient();

    // Auth check
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      await new Promise((r) => setTimeout(r, 600));
      const { data: { session: retry } } = await supabase.auth.getSession();
      if (!retry) { router.push("/auth/login"); return; }
    }
    const { data: { user: u } } = await supabase.auth.getUser();
    if (!u) { router.push("/auth/login"); return; }
    setUser(u);

    // Use API route (service role) to bypass RLS on targets table
    try {
      const res = await fetch("/api/dashboard", { credentials: "include" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.error("[dashboard] API error:", err);
        setLoading(false);
        return;
      }
      const data = await res.json();
      console.log("[dashboard] API returned:", {
        campaigns: data.campaigns?.length,
        stats: data.stats,
        topTargets: data.topTargets?.length,
      });

      setCampaigns(data.campaigns || []);
      setStats({ ...data.stats, exported: (data.campaigns || []).reduce((s: number, c: CampaignRow) => s + c.sa_count, 0) });
      setTopTargets(data.topTargets || []);
      setActivities(data.activities || []);
    } catch (err) {
      console.error("[dashboard] fetch failed:", err);
    }
    setLoading(false);
  }, [router]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handlePause = async (id: string) => {
    const supabase = createClient();
    const camp = campaigns.find((c) => c.id === id);
    await supabase.from("campaigns").update({ status: camp?.status === "paused" ? "running" : "paused" }).eq("id", id);
    setMenuOpen(null); fetchData();
  };
  const handleDelete = async (id: string) => {
    if (!confirm("このキャンペーンを削除しますか？\n（発見済みターゲットも全て削除されます）")) return;
    const supabase = createClient();
    // Optimistic update: remove immediately from UI
    setCampaigns(prev => prev.filter(c => c.id !== id));
    setMenuOpen(null);
    // Delete targets first (FK constraint), then campaign
    await supabase.from("targets").delete().eq("campaign_id", id);
    const { error } = await supabase.from("campaigns").delete().eq("id", id);
    if (error) {
      console.error("[delete] Campaign delete error:", error.message);
      fetchData(); // restore state on error
    }
  };
  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/");
  };

  if (loading) return <div style={{ minHeight: "100vh", background: "#0d0d1a", display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(240,239,232,0.3)" }}>読み込み中...</div>;

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "#0d0d1a", color: "#f0efe8" }}>
      {/* Sidebar */}
      <aside style={{ width: "220px", background: "#0a0a18", borderRight: "1px solid rgba(255,255,255,0.07)", display: "flex", flexDirection: "column", flexShrink: 0, position: "fixed", top: 0, bottom: 0, left: 0, zIndex: 40 }}>
        <div style={{ padding: "22px 18px", display: "flex", alignItems: "center", gap: "8px", fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: "19px" }}>
          <span style={{ color: "#ff6b35", fontSize: "20px" }}>⚡</span> SPARK
        </div>
        <nav style={{ flex: 1, padding: "0 10px" }}>
          {NAV_ITEMS.map((item) => (
            <a key={item.label} href={item.href} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "11px 14px", borderRadius: "10px", marginBottom: "3px", textDecoration: "none", fontSize: "13px", fontWeight: item.active ? 600 : 400, color: item.active ? "#ff6b35" : "rgba(240,239,232,0.5)", background: item.active ? "rgba(255,107,53,0.1)" : "transparent" }}>
              <span style={{ fontSize: "15px" }}>{item.icon}</span>
              {item.label}
            </a>
          ))}
        </nav>
        <div style={{ padding: "14px 18px", borderTop: "1px solid rgba(255,255,255,0.07)", display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{ width: "30px", height: "30px", borderRadius: "50%", background: "rgba(255,107,53,0.2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "13px", fontWeight: 700, color: "#ff6b35" }}>
            {(user?.email || "U")[0].toUpperCase()}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: "11px", color: "#f0efe8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", margin: 0 }}>{user?.email}</p>
          </div>
          <button onClick={handleLogout} style={{ background: "none", border: "none", color: "rgba(240,239,232,0.3)", cursor: "pointer", fontSize: "13px" }} title="ログアウト">↩</button>
        </div>
      </aside>

      {/* Main */}
      <main style={{ flex: 1, marginLeft: "220px", padding: "28px 32px" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "28px" }}>
          <div>
            <h1 style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: "20px", marginBottom: "4px", margin: 0 }}>おかえり 👋</h1>
            <p style={{ fontSize: "12px", color: "rgba(240,239,232,0.35)", margin: "4px 0 0" }}>
              {user?.email} · 今日のターゲット発見数: <span style={{ color: "#ff6b35", fontWeight: 700 }}>{stats.todayNew}件</span>
            </p>
          </div>
          <a href="/campaigns/new" style={{ background: "#ff6b35", color: "#fff", textDecoration: "none", padding: "10px 22px", borderRadius: "11px", fontSize: "13px", fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif", boxShadow: "0 0 20px rgba(255,107,53,0.3)", display: "flex", alignItems: "center", gap: "6px" }}>
            + 新しいキャンペーン
          </a>
        </div>

        {/* 4 Stats */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px", marginBottom: "28px" }}>
          {[
            { label: "総発見数", value: stats.total, delta: `今日 +${stats.todayNew}`, icon: "🔍", color: "#ff6b35" },
            { label: "S+Aランク", value: stats.sa, delta: "", icon: "⭐", color: "#ffd60a" },
            { label: "連絡先取得", value: stats.contacts, delta: "", icon: "📧", color: "#2dd17a" },
            { label: "エクスポート済み", value: stats.exported, delta: "", icon: "📊", color: "#7c5cfc" },
          ].map((s) => (
            <div key={s.label} style={{ background: "#13132a", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "14px", padding: "18px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                <span style={{ fontSize: "11px", color: "rgba(240,239,232,0.4)", fontWeight: 500 }}>{s.icon} {s.label}</span>
                {s.delta && <span style={{ fontSize: "10px", color: s.color, fontWeight: 600, background: `${s.color}15`, padding: "2px 6px", borderRadius: "6px" }}>{s.delta}</span>}
              </div>
              <div style={{ fontSize: "28px", fontWeight: 800, fontFamily: "'Space Grotesk'", color: s.color }}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* Campaign list */}
        <div style={{ marginBottom: "28px" }}>
          <h2 style={{ fontFamily: "'Space Grotesk'", fontWeight: 700, fontSize: "16px", marginBottom: "14px" }}>キャンペーン一覧</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {campaigns.length === 0 ? (
              <div style={{ background: "#13132a", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "14px", padding: "40px", textAlign: "center" }}>
                <div style={{ fontSize: "28px", marginBottom: "10px" }}>🚀</div>
                <div style={{ fontSize: "14px", color: "rgba(240,239,232,0.5)", marginBottom: "8px" }}>キャンペーンがまだありません</div>
                <a href="/campaigns/new" style={{ color: "#ff6b35", fontSize: "13px", textDecoration: "none", fontWeight: 600 }}>最初のキャンペーンを作成 →</a>
              </div>
            ) : campaigns.map((c) => {
              const st = STATUS_MAP[c.status] || STATUS_MAP.running;
              return (
                <div key={c.id} style={{ background: "#13132a", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "12px", padding: "14px 18px", display: "flex", alignItems: "center", gap: "16px" }}>
                  {/* Left: product + platforms */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "13px", fontWeight: 700, marginBottom: "5px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.product_description || c.product_url || "キャンペーン"}</div>
                    <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
                      {c.platforms.slice(0, 5).map((p) => {
                        const pi = PLATFORM_ICONS[p] || { icon: "?", label: p };
                        return <span key={p} style={{ fontSize: "9px", padding: "1px 6px", borderRadius: "4px", background: "rgba(255,255,255,0.04)", color: "rgba(240,239,232,0.4)" }}>{pi.icon} {pi.label}</span>;
                      })}
                    </div>
                  </div>
                  {/* Status */}
                  <div style={{ display: "flex", alignItems: "center", gap: "5px", width: "80px", flexShrink: 0 }}>
                    <span style={{ fontSize: "10px" }}>{st.dot}</span>
                    <span style={{ fontSize: "11px", color: st.color, fontWeight: 600 }}>{st.label}</span>
                  </div>
                  {/* Mini stats */}
                  <div style={{ display: "flex", gap: "12px", flexShrink: 0 }}>
                    {[
                      { label: "発見", value: c.targets_count, color: "#ff6b35" },
                      { label: "S+A", value: c.sa_count, color: "#ffd60a" },
                      { label: "連絡先", value: c.contact_count, color: "#2dd17a" },
                    ].map((s) => (
                      <div key={s.label} style={{ textAlign: "center", minWidth: "40px" }}>
                        <div style={{ fontSize: "15px", fontWeight: 800, fontFamily: "'Space Grotesk'", color: s.color }}>{s.value}</div>
                        <div style={{ fontSize: "9px", color: "rgba(240,239,232,0.3)" }}>{s.label}</div>
                      </div>
                    ))}
                  </div>
                  {/* Actions */}
                  <div style={{ display: "flex", gap: "6px", flexShrink: 0, position: "relative" }}>
                    <a href={`/campaigns/${c.id}`} style={{ background: "rgba(255,107,53,0.08)", border: "1px solid rgba(255,107,53,0.15)", borderRadius: "7px", padding: "5px 10px", fontSize: "10px", fontWeight: 600, color: "#ff6b35", textDecoration: "none" }}>📊 詳細</a>
                    <a href={`/api/campaigns/${c.id}/export`} style={{ background: "rgba(45,209,122,0.08)", border: "1px solid rgba(45,209,122,0.15)", borderRadius: "7px", padding: "5px 10px", fontSize: "10px", fontWeight: 600, color: "#2dd17a", textDecoration: "none" }}>📥</a>
                    <button onClick={() => setMenuOpen(menuOpen === c.id ? null : c.id)} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "7px", padding: "5px 8px", fontSize: "10px", color: "rgba(240,239,232,0.4)", cursor: "pointer" }}>⋯</button>
                    {menuOpen === c.id && (
                      <div style={{ position: "absolute", top: "100%", right: 0, marginTop: "4px", background: "#1a1a2e", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "10px", padding: "4px", zIndex: 50, minWidth: "120px" }}>
                        <button onClick={() => handlePause(c.id)} style={{ width: "100%", background: "none", border: "none", padding: "8px 12px", fontSize: "12px", color: "#ffd60a", cursor: "pointer", textAlign: "left", borderRadius: "6px" }}>
                          {c.status === "paused" ? "▶️ 再開" : "⏸️ 一時停止"}
                        </button>
                        <button onClick={() => handleDelete(c.id)} style={{ width: "100%", background: "none", border: "none", padding: "8px 12px", fontSize: "12px", color: "#ff4444", cursor: "pointer", textAlign: "left", borderRadius: "6px" }}>
                          🗑️ 削除
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Bottom 2-column */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
          {/* Live activity */}
          <div style={{ background: "#13132a", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "14px", padding: "18px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "14px" }}>
              <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#2dd17a", boxShadow: "0 0 8px #2dd17a" }} />
              <span style={{ fontSize: "13px", fontWeight: 700, fontFamily: "'Space Grotesk'" }}>ライブアクティビティ</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {activities.length === 0 ? (
                <div style={{ fontSize: "12px", color: "rgba(240,239,232,0.3)", padding: "16px 0", textAlign: "center" }}>アクティビティはまだありません</div>
              ) : activities.map((a) => (
                <div key={a.id} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "6px 0" }}>
                  <div style={{ width: "26px", height: "26px", borderRadius: "50%", background: `${a.color}15`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "12px", flexShrink: 0 }}>{a.icon}</div>
                  <span style={{ fontSize: "11px", color: "rgba(240,239,232,0.6)", flex: 1 }}>{a.text}</span>
                  <span style={{ fontSize: "10px", color: "rgba(240,239,232,0.25)", flexShrink: 0 }}>{a.time}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Top targets */}
          <div style={{ background: "#13132a", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "14px", padding: "18px" }}>
            <div style={{ marginBottom: "14px" }}>
              <span style={{ fontSize: "13px", fontWeight: 700, fontFamily: "'Space Grotesk'" }}>注目ターゲット</span>
              <span style={{ fontSize: "10px", color: "rgba(240,239,232,0.3)", marginLeft: "8px" }}>S+Aランクのみ</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              {topTargets.length === 0 ? (
                <div style={{ fontSize: "12px", color: "rgba(240,239,232,0.3)", padding: "16px 0", textAlign: "center" }}>S+Aランクのターゲットがまだ見つかっていません</div>
              ) : topTargets.map((t) => {
                const ps = PRIORITY_STYLE[t.priority] || PRIORITY_STYLE.C;
                const pi = PLATFORM_ICONS[t.platform] || { icon: "?", label: t.platform };
                return (
                  <a key={t.id} href={`/campaigns/${t.campaign_id}`} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "8px 10px", borderRadius: "8px", textDecoration: "none", color: "#f0efe8", transition: "background 0.15s" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.04)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                    <span style={{ background: ps.bg, color: ps.color, fontSize: "9px", fontWeight: 900, width: "20px", height: "20px", borderRadius: "5px", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{t.priority}</span>
                    <span style={{ fontSize: "12px", fontWeight: 600 }}>@{t.username}</span>
                    <span style={{ fontSize: "10px", color: "rgba(240,239,232,0.3)" }}>{pi.icon} {pi.label}</span>
                    <span style={{ marginLeft: "auto", fontSize: "14px", fontWeight: 800, fontFamily: "'Space Grotesk'", color: t.match_score >= 75 ? "#ffd60a" : "#2dd17a" }}>{t.match_score}%</span>
                  </a>
                );
              })}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
