"use client";

import { useState } from "react";
import { CampaignSettings } from "@/types/campaign";

const ALL_PLATFORMS = [
  { id: "twitter", name: "X (Twitter)", icon: "𝕏", color: "#1d9bf0" },
  { id: "reddit", name: "Reddit", icon: "🤖", color: "#ff4500" },
  { id: "linkedin", name: "LinkedIn", icon: "in", color: "#0a66c2" },
  { id: "tiktok", name: "TikTok", icon: "♪", color: "#ff0050" },
  { id: "instagram", name: "Instagram", icon: "◈", color: "#e1306c" },
  { id: "facebook", name: "Facebook", icon: "f", color: "#1877f2" },
];

const TONES = [
  { id: "casual" as const, label: "カジュアル", desc: "友達に話しかけるような自然なトーン" },
  { id: "professional" as const, label: "プロフェッショナル", desc: "ビジネスライクで信頼感のあるトーン" },
  { id: "empathetic" as const, label: "共感型", desc: "相手の悩みに寄り添う温かいトーン" },
];

type Props = {
  recommendedPlatforms: string[];
  onSubmit: (settings: CampaignSettings) => void;
  loading: boolean;
};

export default function Step3Settings({ recommendedPlatforms, onSubmit, loading }: Props) {
  const [platforms, setPlatforms] = useState<string[]>(recommendedPlatforms);
  const [dailyLimit, setDailyLimit] = useState(50);
  const [tone, setTone] = useState<CampaignSettings["tone"]>("casual");
  const [autoMode, setAutoMode] = useState(false);

  const togglePlatform = (id: string) => {
    setPlatforms((prev) => prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]);
  };

  const handleSubmit = () => {
    onSubmit({ platforms, daily_limit: dailyLimit, tone, auto_mode: autoMode });
  };

  return (
    <div style={{ maxWidth: "600px", margin: "0 auto" }}>
      <h2 style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: "28px", color: "#f0efe8", textAlign: "center", marginBottom: "8px" }}>
        キャンペーン設定
      </h2>
      <p style={{ textAlign: "center", color: "rgba(240,239,232,0.5)", fontSize: "15px", marginBottom: "40px" }}>
        あとは設定を決めて開始するだけ
      </p>

      {/* Platform selection */}
      <div style={{ marginBottom: "36px" }}>
        <h3 style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: "15px", color: "#f0efe8", marginBottom: "12px" }}>プラットフォーム選択</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "10px" }}>
          {ALL_PLATFORMS.map((p) => {
            const selected = platforms.includes(p.id);
            const recommended = recommendedPlatforms.includes(p.id);
            return (
              <button key={p.id} onClick={() => togglePlatform(p.id)} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "14px 16px", background: selected ? "rgba(255,107,53,0.1)" : "rgba(255,255,255,0.03)", border: `1px solid ${selected ? "rgba(255,107,53,0.4)" : "rgba(255,255,255,0.07)"}`, borderRadius: "12px", cursor: "pointer", transition: "all 0.2s", position: "relative" }}>
                <span style={{ fontSize: "18px", fontWeight: 700, color: p.color }}>{p.icon}</span>
                <span style={{ fontSize: "14px", color: selected ? "#f0efe8" : "rgba(240,239,232,0.5)", fontWeight: selected ? 600 : 400 }}>{p.name}</span>
                {recommended && <span style={{ position: "absolute", top: "6px", right: "8px", fontSize: "9px", color: "#ff6b35", fontWeight: 600 }}>推奨</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Daily limit slider */}
      <div style={{ marginBottom: "36px" }}>
        <h3 style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: "15px", color: "#f0efe8", marginBottom: "12px" }}>1日の接触数</h3>
        <div style={{ textAlign: "center", marginBottom: "12px" }}>
          <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: "48px", color: "#ff6b35" }}>{dailyLimit}</span>
          <span style={{ fontSize: "16px", color: "rgba(240,239,232,0.4)", marginLeft: "4px" }}>/ 日</span>
        </div>
        <input type="range" min={10} max={200} step={10} value={dailyLimit} onChange={(e) => setDailyLimit(Number(e.target.value))} style={{ width: "100%", accentColor: "#ff6b35" }} />
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "rgba(240,239,232,0.3)", marginTop: "4px" }}>
          <span>10</span><span>200</span>
        </div>
      </div>

      {/* Tone selection */}
      <div style={{ marginBottom: "36px" }}>
        <h3 style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: "15px", color: "#f0efe8", marginBottom: "12px" }}>メッセージトーン</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {TONES.map((t) => (
            <button key={t.id} onClick={() => setTone(t.id)} style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", padding: "16px 18px", background: tone === t.id ? "rgba(255,107,53,0.1)" : "rgba(255,255,255,0.03)", border: `1px solid ${tone === t.id ? "rgba(255,107,53,0.4)" : "rgba(255,255,255,0.07)"}`, borderRadius: "12px", cursor: "pointer", transition: "all 0.2s" }}>
              <span style={{ fontSize: "15px", fontWeight: 600, color: tone === t.id ? "#ff6b35" : "#f0efe8", marginBottom: "4px" }}>{t.label}</span>
              <span style={{ fontSize: "12px", color: "rgba(240,239,232,0.4)" }}>{t.desc}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Auto mode toggle */}
      <div style={{ marginBottom: "40px" }}>
        <h3 style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: "15px", color: "#f0efe8", marginBottom: "12px" }}>承認モード</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <button onClick={() => setAutoMode(false)} style={{ display: "flex", alignItems: "flex-start", gap: "12px", padding: "18px", background: !autoMode ? "rgba(255,107,53,0.1)" : "rgba(255,255,255,0.03)", border: `1px solid ${!autoMode ? "rgba(255,107,53,0.4)" : "rgba(255,255,255,0.07)"}`, borderRadius: "14px", cursor: "pointer", transition: "all 0.2s", textAlign: "left" }}>
            <span style={{ fontSize: "24px" }}>🔶</span>
            <div>
              <div style={{ fontSize: "15px", fontWeight: 600, color: !autoMode ? "#ff6b35" : "#f0efe8", marginBottom: "4px" }}>半自動モード（推奨）</div>
              <div style={{ fontSize: "12px", color: "rgba(240,239,232,0.4)" }}>AIが生成 → あなたが確認 → 投稿</div>
            </div>
          </button>
          <button onClick={() => setAutoMode(true)} style={{ display: "flex", alignItems: "flex-start", gap: "12px", padding: "18px", background: autoMode ? "rgba(45,209,122,0.1)" : "rgba(255,255,255,0.03)", border: `1px solid ${autoMode ? "rgba(45,209,122,0.4)" : "rgba(255,255,255,0.07)"}`, borderRadius: "14px", cursor: "pointer", transition: "all 0.2s", textAlign: "left" }}>
            <span style={{ fontSize: "24px" }}>🟢</span>
            <div>
              <div style={{ fontSize: "15px", fontWeight: 600, color: autoMode ? "#2dd17a" : "#f0efe8", marginBottom: "4px" }}>全自動モード</div>
              <div style={{ fontSize: "12px", color: "rgba(240,239,232,0.4)" }}>AIが全て自動で実行</div>
            </div>
          </button>
        </div>
      </div>

      {/* Submit */}
      <button onClick={handleSubmit} disabled={loading || platforms.length === 0} style={{ width: "100%", padding: "18px 24px", background: platforms.length > 0 ? "#ff6b35" : "rgba(255,107,53,0.3)", color: "#fff", border: "none", borderRadius: "14px", fontSize: "18px", fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif", cursor: platforms.length > 0 && !loading ? "pointer" : "not-allowed", boxShadow: platforms.length > 0 ? "0 0 40px rgba(255,107,53,0.35)" : "none", transition: "all 0.2s", opacity: loading ? 0.7 : 1 }}>
        {loading ? "作成中..." : "キャンペーン開始 🚀"}
      </button>
    </div>
  );
}
