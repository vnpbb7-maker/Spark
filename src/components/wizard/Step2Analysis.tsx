"use client";

import { AnalysisResult } from "@/types/campaign";

const PLATFORM_ICONS: Record<string, { icon: string; color: string }> = {
  twitter: { icon: "𝕏", color: "#1d9bf0" },
  reddit: { icon: "🤖", color: "#ff4500" },
  linkedin: { icon: "in", color: "#0a66c2" },
  tiktok: { icon: "♪", color: "#ff0050" },
  instagram: { icon: "◈", color: "#e1306c" },
  facebook: { icon: "f", color: "#1877f2" },
};

type Props = {
  analysis: AnalysisResult;
  onContinue: () => void;
  onBack: () => void;
};

export default function Step2Analysis({ analysis, onContinue, onBack }: Props) {
  return (
    <div style={{ maxWidth: "800px", margin: "0 auto" }}>
      {/* Core value */}
      <div style={{ textAlign: "center", marginBottom: "48px" }}>
        <p style={{ fontSize: "13px", color: "rgba(240,239,232,0.4)", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "1.5px", fontWeight: 600 }}>
          本質的価値
        </p>
        <h2 style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: "24px", color: "#ff6b35", marginBottom: "12px" }}>
          {analysis.core_value}
        </h2>
        <p style={{ fontSize: "15px", color: "rgba(240,239,232,0.6)" }}>{analysis.problem_solved}</p>
      </div>

      {/* Positioning */}
      <div style={{ background: "rgba(255,107,53,0.06)", border: "1px solid rgba(255,107,53,0.2)", borderRadius: "14px", padding: "16px 20px", marginBottom: "32px", textAlign: "center" }}>
        <p style={{ fontSize: "13px", color: "rgba(240,239,232,0.4)", marginBottom: "4px" }}>ポジショニング</p>
        <p style={{ fontSize: "14px", color: "#f0efe8" }}>{analysis.positioning}</p>
      </div>

      {/* Persona cards - horizontal scroll */}
      <div style={{ marginBottom: "32px" }}>
        <h3 style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: "16px", color: "#f0efe8", marginBottom: "16px" }}>
          ターゲットペルソナ
        </h3>
        <div style={{ display: "flex", gap: "16px", overflowX: "auto", paddingBottom: "8px" }}>
          {analysis.personas.map((persona, index) => (
            <div key={index} style={{ minWidth: "280px", flex: "0 0 auto", background: "#13132a", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "16px", padding: "24px" }}>
              <h4 style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: "18px", color: "#f0efe8", marginBottom: "8px" }}>{persona.name}</h4>
              <p style={{ fontSize: "13px", color: "rgba(240,239,232,0.6)", lineHeight: 1.5, marginBottom: "16px" }}>{persona.description}</p>
              <p style={{ fontSize: "11px", color: "rgba(240,239,232,0.35)", textTransform: "uppercase", letterSpacing: "1px", marginBottom: "8px", fontWeight: 600 }}>悩み</p>
              <ul style={{ listStyle: "none", padding: 0, margin: "0 0 16px" }}>
                {persona.pain_points.map((p, i) => (
                  <li key={i} style={{ display: "flex", alignItems: "flex-start", gap: "8px", fontSize: "13px", color: "rgba(240,239,232,0.5)", marginBottom: "4px" }}>
                    <span style={{ color: "#ff6b35", flexShrink: 0 }}>•</span>{p}
                  </li>
                ))}
              </ul>
              <p style={{ fontSize: "11px", color: "rgba(240,239,232,0.35)", textTransform: "uppercase", letterSpacing: "1px", marginBottom: "8px", fontWeight: 600 }}>どこで見つけるか</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                {Object.entries(persona.where_to_find).map(([plat, vals]) => {
                  const info = PLATFORM_ICONS[plat];
                  if (!info || !vals?.length) return null;
                  return vals.map((v, vi) => (
                    <span key={`${plat}-${vi}`} style={{ display: "inline-flex", alignItems: "center", gap: "4px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "6px", padding: "3px 8px", fontSize: "11px", color: "rgba(240,239,232,0.5)" }}>
                      <span style={{ color: info.color, fontWeight: 700, fontSize: "10px" }}>{info.icon}</span>{v}
                    </span>
                  ));
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Recommended platforms */}
      <div style={{ marginBottom: "40px" }}>
        <h3 style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: "16px", color: "#f0efe8", marginBottom: "12px" }}>推奨プラットフォーム</h3>
        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
          {analysis.recommended_platforms.map((p) => {
            const info = PLATFORM_ICONS[p];
            if (!info) return null;
            return (
              <div key={p} style={{ display: "flex", alignItems: "center", gap: "8px", background: "rgba(255,107,53,0.08)", border: "1px solid rgba(255,107,53,0.25)", borderRadius: "10px", padding: "10px 16px", fontSize: "14px", fontWeight: 600, color: "#f0efe8" }}>
                <span style={{ color: info.color, fontSize: "16px", fontWeight: 700 }}>{info.icon}</span>
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </div>
            );
          })}
        </div>
      </div>

      {/* Buttons */}
      <div style={{ display: "flex", gap: "12px" }}>
        <button onClick={onBack} style={{ flex: 1, padding: "14px 20px", background: "rgba(255,255,255,0.06)", color: "rgba(240,239,232,0.7)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "12px", fontSize: "15px", fontWeight: 600, cursor: "pointer" }}>
          ← 修正する
        </button>
        <button onClick={onContinue} style={{ flex: 2, padding: "14px 20px", background: "#ff6b35", color: "#fff", border: "none", borderRadius: "12px", fontSize: "15px", fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif", cursor: "pointer", boxShadow: "0 0 25px rgba(255,107,53,0.35)" }}>
          このまま進む →
        </button>
      </div>
    </div>
  );
}
