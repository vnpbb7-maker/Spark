"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from "recharts";

const NAV_ITEMS = [
  { label: "ダッシュボード", href: "/dashboard", icon: "📊" },
  { label: "キャンペーン", href: "/campaigns/new", icon: "🚀" },
  { label: "アナリティクス", href: "/analytics", icon: "📈", active: true },
  { label: "設定", href: "/settings", icon: "⚙️" },
];

type SentRow = {
  id: string;
  company_name: string | null;
  website_url: string | null;
  email: string | null;
  send_method: string | null;
  sent_at: string;
  campaign_id: string | null;
  converted: boolean;
  converted_user_email: string | null;
  converted_at: string | null;
  clicked: boolean;
};

type DailyPoint = { date: string; count: number };

type AnalyticsData = {
  stats: {
    totalSent: number;
    weekSent: number;
    totalConversions: number;
    conversionRate: string;
    totalClicks: number;
    clickRate: string;
  };
  dailyData: DailyPoint[];
  history: SentRow[];
};

const METHOD_BADGE: Record<string, { label: string; color: string; bg: string }> = {
  "form-async": { label: "フォーム(非同期)", color: "#ffd60a", bg: "rgba(255,214,10,0.08)" },
  form:         { label: "フォーム",         color: "#ffd60a", bg: "rgba(255,214,10,0.08)" },
  email:        { label: "メール",           color: "#2dd17a", bg: "rgba(45,209,122,0.08)" },
  gmail:        { label: "Gmail",            color: "#2dd17a", bg: "rgba(45,209,122,0.08)" },
  dm:           { label: "DM",              color: "#1d9bf0", bg: "rgba(29,155,240,0.08)" },
};

function fmtDate(iso: string) {
  try { return new Date(iso).toLocaleString("ja-JP", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }); }
  catch { return iso; }
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "#1a1a2e", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "10px", padding: "10px 14px" }}>
      <div style={{ fontSize: "11px", color: "rgba(240,239,232,0.5)", marginBottom: "4px" }}>{label}</div>
      <div style={{ fontSize: "18px", fontWeight: 800, color: "#ff6b35", fontFamily: "'Space Grotesk'" }}>{payload[0].value}件</div>
    </div>
  );
};

export default function AnalyticsPage() {
  const router = useRouter();
  const [user, setUser] = useState<{ email?: string } | null>(null);
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "converted">("all");
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { router.push("/auth/login"); return; }
    const { data: { user: u } } = await supabase.auth.getUser();
    if (!u) { router.push("/auth/login"); return; }
    setUser(u);

    const res = await fetch("/api/analytics", { credentials: "include" });
    if (!res.ok) { setLoading(false); return; }
    const json = await res.json();
    setData(json);
    setLoading(false);
  }, [router]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/");
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await fetchData();
    setTimeout(() => setIsRefreshing(false), 800);
  };

  const history = data?.history || [];
  const filtered = filter === "converted" ? history.filter(h => h.converted) : history;

  if (loading) return (
    <div style={{ minHeight: "100vh", background: "#0d0d1a", display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(240,239,232,0.3)", fontFamily: "'Space Grotesk'" }}>
      読み込み中...
    </div>
  );

  const stats = data?.stats ?? { totalSent: 0, weekSent: 0, totalConversions: 0, conversionRate: "0.0" };
  const dailyData = data?.dailyData ?? [];

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "#0d0d1a", color: "#f0efe8", fontFamily: "DM Sans, sans-serif" }}>
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
      <main style={{ flex: 1, marginLeft: "220px", padding: "28px 32px", minHeight: "100vh" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "28px" }}>
          <div>
            <h1 style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: "20px", margin: 0 }}>
              📊 送信レポート & 送信先登録者
            </h1>
            <p style={{ fontSize: "12px", color: "rgba(240,239,232,0.35)", margin: "4px 0 0" }}>
              フォーム送信履歴 · 送信した企業ドメインと一致するメールアドレスで登録したユーザー数を追跡
            </p>
          </div>
          <style>{`
            @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
            .spinning { animation: spin 0.8s linear infinite; display: inline-block; }
          `}</style>
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            style={{
              background: isRefreshing ? "rgba(255,107,53,0.08)" : "rgba(255,255,255,0.05)",
              border: `1px solid ${isRefreshing ? "rgba(255,107,53,0.2)" : "rgba(255,255,255,0.08)"}`,
              borderRadius: "10px", padding: "8px 16px",
              color: isRefreshing ? "rgba(255,107,53,0.8)" : "rgba(240,239,232,0.6)",
              fontSize: "12px", cursor: isRefreshing ? "default" : "pointer",
              fontFamily: "'Space Grotesk'", fontWeight: 600,
              opacity: isRefreshing ? 0.85 : 1, transition: "all 0.2s",
              display: "flex", alignItems: "center", gap: "6px",
            }}
          >
            <span className={isRefreshing ? "spinning" : ""} style={{ display: "inline-block" }}>🔄</span>
            {isRefreshing ? "更新中..." : "更新"}
          </button>
        </div>

        {/* Tracking warning banner */}
        <div style={{
          display: "flex", alignItems: "flex-start", gap: "10px",
          background: "rgba(255,214,10,0.06)", border: "1px solid rgba(255,214,10,0.18)",
          borderRadius: "12px", padding: "11px 16px", marginBottom: "22px",
        }}>
          <span style={{ fontSize: "15px", flexShrink: 0, marginTop: "1px" }}>⚠️</span>
          <p style={{ margin: 0, fontSize: "12px", lineHeight: 1.6, color: "rgba(255,214,10,0.85)" }}>
            <strong>トラッキングURLを有効にして送信したリードのみ</strong>、クリック数・開封数が追跡されます。<br />
            <span style={{ color: "rgba(255,214,10,0.55)", fontSize: "11px" }}>
              アウトリーチページの「設定」でトラッキングを有効にしてから一括送信してください。
            </span>
          </p>
        </div>

        {/* Summary Cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: "12px", marginBottom: "28px" }}>
          {[
            { label: "総送信数", value: stats.totalSent, icon: "📨", color: "#ff6b35", sub: "累計" },
            { label: "今週の送信", value: stats.weekSent, icon: "📅", color: "#7c5cfc", sub: "直近7日" },
            { label: "送信先登録者", value: stats.totalConversions, icon: "🎯", color: "#2dd17a", sub: "送信先からの登録" },
            { label: "登録率", value: `${stats.conversionRate}%`, icon: "📈", color: "#ffd60a", sub: "送信先登録率" },
            { label: "🔗 クリック数", value: stats.totalClicks ?? 0, icon: "🔗", color: "#1d9bf0", sub: "リンククリック" },
            { label: "クリック率", value: `${stats.clickRate ?? "0.0"}%`, icon: "🖱️", color: "#a78bfa", sub: "クリック/送信" },
          ].map((s) => (
            <div key={s.label} style={{ background: "#13132a", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "14px", padding: "18px", position: "relative", overflow: "hidden" }}>
              <div style={{ position: "absolute", top: "-10px", right: "-10px", fontSize: "48px", opacity: 0.06 }}>{s.icon}</div>
              <div style={{ fontSize: "11px", color: "rgba(240,239,232,0.4)", marginBottom: "6px" }}>{s.icon} {s.label}</div>
              <div style={{ fontSize: "32px", fontWeight: 800, fontFamily: "'Space Grotesk'", color: s.color, lineHeight: 1 }}>{s.value}</div>
              <div style={{ fontSize: "10px", color: "rgba(240,239,232,0.25)", marginTop: "4px" }}>{s.sub}</div>
            </div>
          ))}
        </div>

        {/* Bar Chart */}
        <div style={{ background: "#13132a", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "16px", padding: "22px", marginBottom: "24px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "18px" }}>
            <div>
              <div style={{ fontFamily: "'Space Grotesk'", fontWeight: 700, fontSize: "14px" }}>日別送信件数</div>
              <div style={{ fontSize: "11px", color: "rgba(240,239,232,0.35)", marginTop: "2px" }}>過去30日間</div>
            </div>
            <div style={{ fontSize: "11px", color: "rgba(255,107,53,0.7)", background: "rgba(255,107,53,0.08)", padding: "4px 10px", borderRadius: "6px" }}>
              合計 {stats.totalSent}件
            </div>
          </div>
          {dailyData.length > 0 ? (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={dailyData} barSize={14} margin={{ top: 4, right: 0, left: -20, bottom: 0 }}>
                <XAxis dataKey="date" tick={{ fill: "rgba(240,239,232,0.25)", fontSize: 10 }} axisLine={false} tickLine={false} interval={4} />
                <YAxis tick={{ fill: "rgba(240,239,232,0.25)", fontSize: 10 }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {dailyData.map((_, i) => (
                    <Cell key={i} fill={_ .count > 0 ? "#ff6b35" : "rgba(255,107,53,0.15)"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ height: "180px", display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(240,239,232,0.2)", fontSize: "13px" }}>
              送信データがまだありません
            </div>
          )}
        </div>

        {/* Conversion Highlights */}
        {stats.totalConversions > 0 && (
          <div style={{ background: "linear-gradient(135deg, rgba(45,209,122,0.06), rgba(45,209,122,0.02))", border: "1px solid rgba(45,209,122,0.2)", borderRadius: "16px", padding: "20px 24px", marginBottom: "24px" }}>
            <div style={{ fontFamily: "'Space Grotesk'", fontWeight: 700, fontSize: "14px", color: "#2dd17a", marginBottom: "12px" }}>
              🎯 送信先登録者 — {stats.totalConversions}件
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {history.filter(h => h.converted).map(h => (
                <div key={h.id} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "10px 14px", background: "rgba(45,209,122,0.05)", borderRadius: "10px", border: "1px solid rgba(45,209,122,0.1)" }}>
                  <span style={{ fontSize: "18px" }}>✅</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: "13px", fontWeight: 600 }}>{h.company_name || h.website_url || "—"}</div>
                    <div style={{ fontSize: "11px", color: "rgba(240,239,232,0.4)", marginTop: "2px" }}>
                      送信: {fmtDate(h.sent_at)} → 登録: {h.converted_at ? fmtDate(h.converted_at) : "—"}
                    </div>
                  </div>
                  <span style={{ fontSize: "10px", background: "rgba(45,209,122,0.15)", color: "#2dd17a", padding: "3px 10px", borderRadius: "6px", fontWeight: 700 }}>
                    ✅ 送信先からの登録
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* History Table */}
        <div style={{ background: "#13132a", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "16px", overflow: "hidden" }}>
          <div style={{ padding: "18px 22px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ fontFamily: "'Space Grotesk'", fontWeight: 700, fontSize: "14px" }}>送信履歴一覧</div>
            <div style={{ display: "flex", gap: "6px" }}>
              {[
                { key: "all" as const, label: `全て (${history.length})` },
                { key: "converted" as const, label: `送信先登録者 (${stats.totalConversions})` },
              ].map(tab => (
                <button key={tab.key} onClick={() => setFilter(tab.key)} style={{
                  background: filter === tab.key ? "rgba(255,107,53,0.1)" : "transparent",
                  border: `1px solid ${filter === tab.key ? "rgba(255,107,53,0.3)" : "rgba(255,255,255,0.08)"}`,
                  borderRadius: "8px", padding: "5px 12px", fontSize: "11px", fontWeight: 600,
                  color: filter === tab.key ? "#ff6b35" : "rgba(240,239,232,0.4)", cursor: "pointer",
                }}>{tab.label}</button>
              ))}
            </div>
          </div>

          {/* Table header */}
          <div style={{ display: "grid", gridTemplateColumns: "160px 1fr 110px 120px 140px", padding: "10px 22px", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
            {["送信日時", "企業名 / URL", "送信方法", "キャンペーン", "ステータス"].map(h => (
              <div key={h} style={{ fontSize: "10px", color: "rgba(240,239,232,0.3)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>{h}</div>
            ))}
          </div>

          {/* Rows */}
          {filtered.length === 0 ? (
            <div style={{ padding: "48px", textAlign: "center" }}>
              <div style={{ fontSize: "28px", marginBottom: "10px" }}>📭</div>
              <div style={{ fontSize: "13px", color: "rgba(240,239,232,0.3)" }}>
                {filter === "converted" ? "送信先からの登録者はまだいません" : "送信履歴がまだありません"}
              </div>
            </div>
          ) : filtered.map((row) => {
            const method = METHOD_BADGE[row.send_method || ""] || { label: row.send_method || "—", color: "rgba(240,239,232,0.4)", bg: "rgba(255,255,255,0.04)" };
            const rowBg = row.converted ? "rgba(45,209,122,0.03)" : "transparent";
            const rowBorder = row.converted ? "rgba(45,209,122,0.08)" : "transparent";
            return (
              <div key={row.id} style={{
                display: "grid", gridTemplateColumns: "160px 1fr 110px 120px 140px",
                padding: "12px 22px", borderBottom: "1px solid rgba(255,255,255,0.03)",
                background: rowBg, borderLeft: `3px solid ${row.converted ? "rgba(45,209,122,0.4)" : "transparent"}`,
                alignItems: "center",
              }}
                onMouseEnter={e => (e.currentTarget.style.background = row.converted ? "rgba(45,209,122,0.06)" : "rgba(255,255,255,0.02)")}
                onMouseLeave={e => (e.currentTarget.style.background = rowBg)}
              >
                <div style={{ fontSize: "11px", color: "rgba(240,239,232,0.45)" }}>{fmtDate(row.sent_at)}</div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: "12px", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {row.company_name || "—"}
                  </div>
                  {row.website_url &&
                    !row.website_url.includes("place_id") &&
                    !row.website_url.includes("google.com/maps") &&
                    row.website_url !== "skip" && (
                    <a href={row.website_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: "10px", color: "rgba(255,107,53,0.6)", textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>
                      {row.website_url.slice(0, 45)}{row.website_url.length > 45 ? "…" : ""}
                    </a>
                  )}
                </div>
                <div>
                  <span style={{ fontSize: "10px", padding: "3px 8px", borderRadius: "5px", fontWeight: 600, background: method.bg, color: method.color }}>
                    {method.label}
                  </span>
                </div>
                <div style={{ fontSize: "10px", color: "rgba(240,239,232,0.35)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {row.campaign_id ? row.campaign_id.slice(0, 8) + "…" : "—"}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  {row.converted ? (
                    <span style={{ fontSize: "10px", background: "rgba(45,209,122,0.12)", color: "#2dd17a", padding: "4px 10px", borderRadius: "6px", fontWeight: 700, display: "inline-flex", alignItems: "center", gap: "4px" }}>
                      ✅ 送信先からの登録
                    </span>
                  ) : null}
                  {row.clicked ? (
                    <span style={{ fontSize: "10px", background: "rgba(29,155,240,0.12)", color: "#1d9bf0", padding: "4px 10px", borderRadius: "6px", fontWeight: 700, display: "inline-flex", alignItems: "center", gap: "4px" }}>
                      🔗 リンククリック
                    </span>
                  ) : null}
                  {!row.converted && !row.clicked && (
                    <span style={{ fontSize: "10px", color: "rgba(240,239,232,0.25)" }}>送信済み</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {filtered.length > 0 && (
          <div style={{ textAlign: "center", padding: "16px", fontSize: "11px", color: "rgba(240,239,232,0.2)" }}>
            {filtered.length}件表示
          </div>
        )}
      </main>
    </div>
  );
}
