"use client";

import { AnalysisResult } from "@/types/campaign";

type Props = {
  analysis: AnalysisResult;
  onContinue: () => void;
  onBack: () => void;
  userPlan?: string;
};

export default function Step2Analysis({ analysis, onContinue, onBack }: Props) {
  return (
    <div style={{ maxWidth: "800px", margin: "0 auto" }}>
      {/* Positioning */}
      {analysis.positioning && (
        <div style={{ background: "rgba(255,107,53,0.06)", border: "1px solid rgba(255,107,53,0.2)", borderRadius: "14px", padding: "16px 20px", marginBottom: "32px", textAlign: "center" }}>
          <p style={{ fontSize: "13px", color: "rgba(240,239,232,0.4)", marginBottom: "4px" }}>ポジショニング</p>
          <p style={{ fontSize: "14px", color: "#f0efe8" }}>{analysis.positioning}</p>
        </div>
      )}

      {/* Persona cards */}
      <div style={{ marginBottom: "32px" }}>
        <h3 style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: "16px", color: "#f0efe8", marginBottom: "16px" }}>
          🎯 ターゲットペルソナ
        </h3>
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {analysis.personas.map((persona, index) => {
            // Support both new and legacy persona formats
            const title = persona.label || persona.name || `ペルソナ ${index + 1}`;
            const isNew = !!persona.pain_scene;

            return (
              <div key={index} style={{ width: "100%", background: "#13132a", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "16px", padding: "24px" }}>
                {/* Header */}
                <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "16px" }}>
                  <span style={{ background: "rgba(255,107,53,0.15)", color: "#ff6b35", fontWeight: 900, fontSize: "13px", width: "28px", height: "28px", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {index + 1}
                  </span>
                  <h4 style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: "17px", color: "#f0efe8" }}>{title}</h4>
                </div>

                {isNew ? (
                  <>
                    {/* Pain scene */}
                    <div style={{ marginBottom: "14px" }}>
                      <p style={{ fontSize: "11px", color: "rgba(240,239,232,0.35)", textTransform: "uppercase", letterSpacing: "1px", marginBottom: "6px", fontWeight: 600 }}>🔥 困っている場面</p>
                      <p style={{ fontSize: "14px", color: "rgba(240,239,232,0.75)", lineHeight: 1.6 }}>{persona.pain_scene}</p>
                    </div>

                    {/* Current workaround */}
                    <div style={{ marginBottom: "14px" }}>
                      <p style={{ fontSize: "11px", color: "rgba(240,239,232,0.35)", textTransform: "uppercase", letterSpacing: "1px", marginBottom: "6px", fontWeight: 600 }}>😤 今の対処法と不満</p>
                      <p style={{ fontSize: "13px", color: "rgba(240,239,232,0.55)", lineHeight: 1.5 }}>{persona.current_workaround}</p>
                    </div>

                    {/* Real tweet example */}
                    <div style={{ marginBottom: "14px", background: "rgba(29,155,240,0.06)", border: "1px solid rgba(29,155,240,0.15)", borderRadius: "10px", padding: "12px 16px" }}>
                      <p style={{ fontSize: "11px", color: "rgba(240,239,232,0.35)", marginBottom: "6px", fontWeight: 600 }}>💬 投稿例</p>
                      <p style={{ fontSize: "13px", color: "rgba(240,239,232,0.65)", fontStyle: "italic", lineHeight: 1.5 }}>&quot;{persona.real_tweet_example}&quot;</p>
                    </div>

                    {/* Message angle */}
                    <div style={{ marginBottom: "14px" }}>
                      <p style={{ fontSize: "11px", color: "rgba(240,239,232,0.35)", textTransform: "uppercase", letterSpacing: "1px", marginBottom: "6px", fontWeight: 600 }}>🎯 刺さるアプローチ</p>
                      <p style={{ fontSize: "13px", color: "#2dd17a", lineHeight: 1.5 }}>{persona.message_angle}</p>
                    </div>

                    {/* Discovery signals */}
                    {persona.discovery_signals?.length > 0 && (
                      <div style={{ marginBottom: "14px" }}>
                        <p style={{ fontSize: "11px", color: "rgba(240,239,232,0.35)", textTransform: "uppercase", letterSpacing: "1px", marginBottom: "6px", fontWeight: 600 }}>🔍 発見シグナル</p>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                          {persona.discovery_signals.map((s, i) => (
                            <span key={i} style={{ background: "rgba(255,107,53,0.08)", border: "1px solid rgba(255,107,53,0.2)", borderRadius: "6px", padding: "3px 10px", fontSize: "12px", color: "#ff6b35" }}>
                              {s}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Twitter keywords + Reddit communities */}
                    <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
                      {persona.twitter_keywords?.length > 0 && (
                        <div style={{ flex: 1, minWidth: "200px" }}>
                          <p style={{ fontSize: "11px", color: "rgba(240,239,232,0.35)", marginBottom: "6px", fontWeight: 600 }}>𝕏 キーワード</p>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                            {persona.twitter_keywords.map((k, i) => (
                              <span key={i} style={{ background: "rgba(29,155,240,0.08)", borderRadius: "5px", padding: "2px 8px", fontSize: "11px", color: "rgba(29,155,240,0.7)" }}>{k}</span>
                            ))}
                          </div>
                        </div>
                      )}
                      {persona.reddit_communities?.length > 0 && (
                        <div style={{ flex: 1, minWidth: "200px" }}>
                          <p style={{ fontSize: "11px", color: "rgba(240,239,232,0.35)", marginBottom: "6px", fontWeight: 600 }}>🤖 Reddit</p>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                            {persona.reddit_communities.map((r, i) => (
                              <span key={i} style={{ background: "rgba(255,69,0,0.08)", borderRadius: "5px", padding: "2px 8px", fontSize: "11px", color: "rgba(255,69,0,0.7)" }}>{r}</span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Avoid phrases */}
                    {persona.avoid_phrases?.length > 0 && (
                      <div style={{ marginTop: "12px" }}>
                        <p style={{ fontSize: "11px", color: "rgba(240,239,232,0.35)", marginBottom: "6px", fontWeight: 600 }}>⚠️ 避けるフレーズ</p>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                          {persona.avoid_phrases.map((p, i) => (
                            <span key={i} style={{ background: "rgba(255,59,48,0.08)", borderRadius: "5px", padding: "2px 8px", fontSize: "11px", color: "rgba(255,59,48,0.6)" }}>✗ {p}</span>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  /* Legacy persona format */
                  <>
                    {persona.description && <p style={{ fontSize: "13px", color: "rgba(240,239,232,0.6)", lineHeight: 1.5, marginBottom: "16px" }}>{persona.description}</p>}
                    {persona.pain_points && persona.pain_points.length > 0 && (
                      <>
                        <p style={{ fontSize: "11px", color: "rgba(240,239,232,0.35)", textTransform: "uppercase", letterSpacing: "1px", marginBottom: "8px", fontWeight: 600 }}>悩み</p>
                        <ul style={{ listStyle: "none", padding: 0, margin: "0 0 16px" }}>
                          {persona.pain_points.map((p, i) => (
                            <li key={i} style={{ display: "flex", alignItems: "flex-start", gap: "8px", fontSize: "13px", color: "rgba(240,239,232,0.5)", marginBottom: "4px" }}>
                              <span style={{ color: "#ff6b35", flexShrink: 0 }}>•</span>{p}
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                    {persona.keywords && persona.keywords.length > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                        {persona.keywords.map((k, i) => (
                          <span key={i} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "6px", padding: "3px 8px", fontSize: "11px", color: "rgba(240,239,232,0.5)" }}>
                            {k}
                          </span>
                        ))}
                      </div>
                    )}
                  </>
                )}
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
