"use client";
import { useState } from "react";

const CATEGORY_COLORS: Record<string, { bg: string; color: string }> = {
  "料金":    { bg: "rgba(255,80,80,0.12)",   color: "#ff5050" },
  "機能不足": { bg: "rgba(255,107,53,0.12)", color: "#ff6b35" },
  "サポート": { bg: "rgba(255,214,10,0.12)", color: "#ffd60a" },
  "操作性":  { bg: "rgba(124,92,252,0.12)",  color: "#7c5cfc" },
  "言語":    { bg: "rgba(29,155,240,0.12)",  color: "#1d9bf0" },
  "その他":  { bg: "rgba(255,255,255,0.06)", color: "rgba(240,239,232,0.5)" },
};

const PLATFORM_BADGE: Record<string, { icon: string; color: string }> = {
  "Reddit":      { icon: "🤖", color: "#ff4500" },
  "ProductHunt": { icon: "🚀", color: "#da552f" },
  "Twitter/X":   { icon: "𝕏",  color: "#1d9bf0" },
  "App Store":   { icon: "🍎", color: "#007aff" },
  "Google Play": { icon: "▶",  color: "#34a853" },
  "Googleマップ": { icon: "🗺️", color: "#4285f4" },
  "Web":         { icon: "🌐", color: "#2dd17a" },
};

interface Complaint {
  index: number;
  category: string;
  snippet: string;
  url: string;
  platform: string;
}

interface WinPoints {
  advantages: string[];
  wanted_features: string[];
  outreach_keywords: string[];
}

interface RadarResult {
  complaints: Complaint[];
  summary: { total: number; categories: Record<string, number> };
  win_points: WinPoints | null;
}

export default function CompetitorRadarPage() {
  const [input, setInput] = useState("");
  const [productUrl, setProductUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RadarResult | null>(null);
  const [error, setError] = useState("");

  const handleSearch = async () => {
    const competitors = input.split(",").map(s => s.trim()).filter(Boolean);
    if (!competitors.length) { setError("競合サービス名を入力してください"); return; }
    setLoading(true); setError(""); setResult(null);
    try {
      const res = await fetch("/api/competitor-radar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ competitors, product_url: productUrl }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "エラーが発生しました"); return; }
      setResult(data);
    } catch { setError("ネットワークエラーが発生しました"); }
    finally { setLoading(false); }
  };

  const topCategories = result
    ? Object.entries(result.summary.categories)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
    : [];

  return (
    <div style={{ minHeight: "100vh", background: "#0d0d1a", color: "#f0efe8", fontFamily: "DM Sans, sans-serif" }}>
      {/* Header */}
      <div style={{ borderBottom: "1px solid rgba(255,255,255,0.07)", padding: "16px 28px", display: "flex", alignItems: "center", gap: "14px" }}>
        <a href="/dashboard" style={{ color: "rgba(240,239,232,0.4)", textDecoration: "none", fontSize: "13px" }}>← ダッシュボード</a>
        <span style={{ color: "rgba(255,255,255,0.1)" }}>|</span>
        <span style={{ fontFamily: "'Space Grotesk'", fontWeight: 700, fontSize: "17px" }}>🎯 競合弱点レーダー</span>
      </div>

      <div style={{ maxWidth: "900px", margin: "0 auto", padding: "36px 24px" }}>
        {/* Hero */}
        <div style={{ textAlign: "center", marginBottom: "36px" }}>
          <div style={{ fontSize: "44px", marginBottom: "12px" }}>🎯</div>
          <h1 style={{ fontFamily: "'Space Grotesk'", fontWeight: 800, fontSize: "28px", margin: "0 0 10px", background: "linear-gradient(135deg, #ff6b35, #ffd60a)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
            競合弱点レーダー
          </h1>
          <p style={{ color: "rgba(240,239,232,0.5)", fontSize: "14px", maxWidth: "520px", margin: "0 auto", lineHeight: 1.6 }}>
            SNS・レビューサイトから競合への不満を収集し、あなたのプロダクトの勝ちポイントを発見します
          </p>
        </div>

        {/* Input card */}
        <div style={{ background: "#13132a", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "18px", padding: "24px", marginBottom: "28px" }}>
          <div style={{ marginBottom: "14px" }}>
            <label style={{ fontSize: "12px", fontWeight: 600, color: "rgba(240,239,232,0.5)", display: "block", marginBottom: "6px" }}>
              競合サービス名（カンマ区切り）
            </label>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleSearch()}
              placeholder="例：Apollo.io, HubSpot, Phantombuster"
              style={{
                width: "100%", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: "10px", padding: "11px 14px", fontSize: "14px", color: "#f0efe8",
                outline: "none", boxSizing: "border-box",
              }}
            />
          </div>
          <div style={{ marginBottom: "16px" }}>
            <label style={{ fontSize: "12px", fontWeight: 600, color: "rgba(240,239,232,0.5)", display: "block", marginBottom: "6px" }}>
              自社プロダクトURL（任意 — 勝ちポイント分析の精度向上）
            </label>
            <input
              value={productUrl}
              onChange={e => setProductUrl(e.target.value)}
              placeholder="例：https://spark-ai.jp"
              style={{
                width: "100%", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: "10px", padding: "11px 14px", fontSize: "14px", color: "#f0efe8",
                outline: "none", boxSizing: "border-box",
              }}
            />
          </div>
          {error && <div style={{ fontSize: "12px", color: "#ff5050", marginBottom: "10px" }}>⚠️ {error}</div>}
          <button
            onClick={handleSearch}
            disabled={loading}
            style={{
              width: "100%", padding: "12px", borderRadius: "11px", border: "none",
              background: loading ? "rgba(255,107,53,0.2)" : "linear-gradient(135deg, #ff6b35, #e05a28)",
              color: "#fff", fontFamily: "'Space Grotesk'", fontWeight: 700, fontSize: "14px",
              cursor: loading ? "wait" : "pointer", transition: "all 0.2s",
              boxShadow: loading ? "none" : "0 0 24px rgba(255,107,53,0.3)",
            }}
          >
            {loading ? "🔍 調査中... (30〜60秒)" : "🔍 弱点を調査する"}
          </button>
        </div>

        {/* Loading state */}
        {loading && (
          <div style={{ textAlign: "center", padding: "60px 20px", color: "rgba(240,239,232,0.4)" }}>
            <div style={{ fontSize: "36px", marginBottom: "14px", animation: "spin 2s linear infinite" }}>🔍</div>
            <div style={{ fontSize: "14px", marginBottom: "6px" }}>SNS・レビューサイトを横断調査中...</div>
            <div style={{ fontSize: "12px", color: "rgba(240,239,232,0.25)" }}>Tavily × Claude で分析しています。30〜60秒かかります</div>
            <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
          </div>
        )}

        {/* Results */}
        {result && !loading && (
          <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>

            {/* Summary card */}
            <div style={{ background: "linear-gradient(135deg, rgba(255,107,53,0.08), rgba(255,214,10,0.04))", border: "1px solid rgba(255,107,53,0.2)", borderRadius: "16px", padding: "20px 24px" }}>
              <div style={{ fontSize: "13px", fontWeight: 700, color: "rgba(240,239,232,0.6)", marginBottom: "12px" }}>📊 調査結果サマリー</div>
              <div style={{ fontSize: "20px", fontWeight: 800, fontFamily: "'Space Grotesk'", marginBottom: "14px" }}>
                <span style={{ color: "#ff6b35" }}>{result.summary.total}件</span>の不満コメントを発見
              </div>
              {topCategories.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                  <span style={{ fontSize: "12px", color: "rgba(240,239,232,0.4)" }}>上位の不満：</span>
                  {topCategories.map(([cat, count]) => {
                    const cs = CATEGORY_COLORS[cat] || CATEGORY_COLORS["その他"];
                    return (
                      <span key={cat} style={{ background: cs.bg, color: cs.color, fontSize: "12px", fontWeight: 700, padding: "3px 10px", borderRadius: "20px" }}>
                        {cat} {count}件
                      </span>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Win points */}
            {result.win_points && (
              <div style={{ background: "#13132a", border: "1px solid rgba(45,209,122,0.2)", borderRadius: "16px", padding: "20px 24px" }}>
                <div style={{ fontSize: "15px", fontWeight: 700, fontFamily: "'Space Grotesk'", marginBottom: "18px", color: "#2dd17a" }}>
                  🏆 勝ちポイント分析
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "16px" }}>
                  <div>
                    <div style={{ fontSize: "11px", fontWeight: 700, color: "rgba(240,239,232,0.4)", marginBottom: "10px", textTransform: "uppercase", letterSpacing: "0.5px" }}>貴社が有利な点 TOP3</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                      {result.win_points.advantages.map((a, i) => (
                        <div key={i} style={{ display: "flex", gap: "8px", alignItems: "flex-start" }}>
                          <span style={{ background: "rgba(45,209,122,0.15)", color: "#2dd17a", fontSize: "10px", fontWeight: 900, width: "20px", height: "20px", borderRadius: "6px", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{i + 1}</span>
                          <span style={{ fontSize: "13px", lineHeight: 1.5, color: "rgba(240,239,232,0.8)" }}>{a}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: "11px", fontWeight: 700, color: "rgba(240,239,232,0.4)", marginBottom: "10px", textTransform: "uppercase", letterSpacing: "0.5px" }}>ユーザーが求める機能 TOP3</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                      {result.win_points.wanted_features.map((f, i) => (
                        <div key={i} style={{ display: "flex", gap: "8px", alignItems: "flex-start" }}>
                          <span style={{ background: "rgba(124,92,252,0.15)", color: "#7c5cfc", fontSize: "10px", fontWeight: 900, width: "20px", height: "20px", borderRadius: "6px", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{i + 1}</span>
                          <span style={{ fontSize: "13px", lineHeight: 1.5, color: "rgba(240,239,232,0.8)" }}>{f}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: "11px", fontWeight: 700, color: "rgba(240,239,232,0.4)", marginBottom: "10px", textTransform: "uppercase", letterSpacing: "0.5px" }}>推奨アウトリーチキーワード</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                      {result.win_points.outreach_keywords.map((kw, i) => (
                        <span key={i} style={{ background: "rgba(255,214,10,0.1)", color: "#ffd60a", fontSize: "12px", fontWeight: 600, padding: "4px 10px", borderRadius: "20px" }}>{kw}</span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Complaint list */}
            <div>
              <div style={{ fontSize: "15px", fontWeight: 700, fontFamily: "'Space Grotesk'", marginBottom: "12px" }}>
                💬 不満コメント一覧 ({result.complaints.length}件)
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {result.complaints.map((complaint, i) => {
                  const cat = CATEGORY_COLORS[complaint.category] || CATEGORY_COLORS["その他"];
                  const plat = PLATFORM_BADGE[complaint.platform] || PLATFORM_BADGE["Web"];
                  return (
                    <div key={i} style={{ background: "#13132a", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "12px", padding: "14px 16px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px", flexWrap: "wrap" }}>
                        <span style={{ fontSize: "11px", fontWeight: 700, padding: "2px 8px", borderRadius: "5px", background: `${plat.color}18`, color: plat.color }}>
                          {plat.icon} {complaint.platform}
                        </span>
                        <span style={{ fontSize: "11px", fontWeight: 700, padding: "2px 8px", borderRadius: "5px", background: cat.bg, color: cat.color }}>
                          {complaint.category}
                        </span>
                        <a href={complaint.url} target="_blank" rel="noopener noreferrer"
                          style={{ marginLeft: "auto", fontSize: "10px", color: "rgba(240,239,232,0.3)", textDecoration: "none" }}>
                          ソースを開く →
                        </a>
                      </div>
                      <p style={{ fontSize: "13px", color: "rgba(240,239,232,0.7)", lineHeight: 1.6, margin: 0, wordBreak: "break-word" }}>
                        {complaint.snippet}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>

          </div>
        )}
      </div>
    </div>
  );
}
