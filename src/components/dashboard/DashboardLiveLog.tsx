"use client";

import { useEffect, useState } from "react";
import { LogEntry } from "@/hooks/useRealtimeLog";

const PLATFORM_NAMES: Record<string, string> = {
  twitter: "X", reddit: "Reddit", linkedin: "LinkedIn", tiktok: "TikTok",
  instagram: "Instagram", facebook: "Facebook", youtube: "YouTube",
  note: "note.com", zenn: "Zenn", qiita: "Qiita", hatena: "はてな",
  yahoo_qa: "Yahoo知恵袋", web: "Web全体",
};

type Props = {
  logs: LogEntry[];
  platforms?: string[];
  campaignCreatedAt?: string;
  hasData?: boolean; // NEW: signals data exists, stops spinner
};

export default function DashboardLiveLog({ logs, platforms, campaignCreatedAt, hasData }: Props) {
  const [elapsed, setElapsed] = useState(0);

  console.log("[DashboardLiveLog] received logs:", logs.length, "hasData:", hasData, "showSpinner:", !hasData && logs.length === 0);

  // Only run timer if NO data and NO logs
  const showSpinner = !hasData && logs.length === 0;

  useEffect(() => {
    if (!showSpinner || !campaignCreatedAt) return;
    const createdMs = new Date(campaignCreatedAt).getTime();
    const tick = () => setElapsed(Math.floor((Date.now() - createdMs) / 1000));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [showSpinner, campaignCreatedAt]);

  const STEPS = [
    { label: "ターゲットを発見中...", icon: "🔍" },
    { label: "コメントを生成中...", icon: "✍️" },
  ];
  const stepIndex = Math.min(Math.floor(elapsed / 30), STEPS.length - 1);
  const currentStep = STEPS[stepIndex];

  const platformLabel = platforms && platforms.length > 0
    ? platforms.map((p) => PLATFORM_NAMES[p] || p).join("・")
    : "SNS";

  return (
    <div style={{ background: "#13132a", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "16px", padding: "0", height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "16px 20px", borderBottom: "1px solid rgba(255,255,255,0.07)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h3 style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: "14px", color: "#f0efe8" }}>ライブアクティビティ</h3>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: showSpinner ? "#ff6b35" : "#2dd17a", animation: "blink 1.5s infinite" }} />
          <span style={{ fontSize: "11px", color: showSpinner ? "#ff6b35" : "#2dd17a" }}>{showSpinner ? "処理中" : "LIVE"}</span>
        </div>
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: "12px 16px" }}>
        {showSpinner ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "32px 16px", gap: 12 }}>
            <div style={{ width: 32, height: 32, border: "3px solid rgba(255,107,53,0.2)", borderTop: "3px solid #ff6b35", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
            <div style={{ display: "flex", gap: 6, marginBottom: 4 }}>
              {STEPS.map((s, i) => (
                <div key={i} style={{ width: 8, height: 8, borderRadius: "50%", background: i <= stepIndex ? "#ff6b35" : "rgba(255,255,255,0.1)", transition: "background 0.3s" }} />
              ))}
            </div>
            <div style={{ fontSize: 13, color: "rgba(240,239,232,0.7)", textAlign: "center", lineHeight: 1.6 }}>
              {currentStep.icon} {currentStep.label}
            </div>
            <div style={{ fontSize: 12, color: "rgba(240,239,232,0.5)", textAlign: "center" }}>
              {platformLabel}でAIがターゲットを探しています
            </div>
            <div style={{ fontSize: 11, color: "rgba(240,239,232,0.3)", textAlign: "center", lineHeight: 1.6 }}>
              通常1〜2分かかります
            </div>
          </div>
        ) : logs.length > 0 ? (
          logs.map((log) => (
            <div key={log.id} style={{ display: "flex", alignItems: "flex-start", gap: "10px", padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
              <span style={{ fontSize: "14px", flexShrink: 0 }}>{log.icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: "12px", color: log.color, lineHeight: 1.4, wordBreak: "break-word" }}>{log.text}</p>
                <p style={{ fontSize: "10px", color: "rgba(240,239,232,0.2)", marginTop: "2px" }}>{log.timestamp}</p>
              </div>
            </div>
          ))
        ) : (
          /* hasData is true but no logs generated yet */
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "32px 16px", gap: 8 }}>
            <div style={{ fontSize: 28 }}>✅</div>
            <div style={{ fontSize: 13, color: "rgba(240,239,232,0.5)", textAlign: "center" }}>
              処理完了
            </div>
          </div>
        )}
      </div>
      <style>{`@keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.2} } @keyframes spin { 0%{transform:rotate(0deg)} 100%{transform:rotate(360deg)} }`}</style>
    </div>
  );
}
