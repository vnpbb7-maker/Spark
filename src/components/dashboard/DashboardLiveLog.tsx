"use client";

import { LogEntry } from "@/hooks/useRealtimeLog";

export default function DashboardLiveLog({ logs }: { logs: LogEntry[] }) {
  return (
    <div style={{ background: "#13132a", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "16px", padding: "0", height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "16px 20px", borderBottom: "1px solid rgba(255,255,255,0.07)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h3 style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: "14px", color: "#f0efe8" }}>ライブアクティビティ</h3>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#2dd17a", animation: "blink 1.5s infinite" }} />
          <span style={{ fontSize: "11px", color: "#2dd17a" }}>LIVE</span>
        </div>
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: "12px 16px" }}>
        {logs.length === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "32px 16px", gap: 12 }}>
            <div style={{ width: 32, height: 32, border: "3px solid rgba(255,107,53,0.2)", borderTop: "3px solid #ff6b35", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
            <div style={{ fontSize: 13, color: "rgba(240,239,232,0.7)", textAlign: "center", lineHeight: 1.6 }}>
              Reddit・TwitterでAIがターゲットを探しています
            </div>
            <div style={{ fontSize: 11, color: "rgba(240,239,232,0.4)", textAlign: "center", lineHeight: 1.6 }}>
              マッチするターゲットが見つかり次第<br />
              リアルタイムで表示されます
            </div>
          </div>
        ) : (
          logs.map((log) => (
            <div key={log.id} style={{ display: "flex", alignItems: "flex-start", gap: "10px", padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
              <span style={{ fontSize: "14px", flexShrink: 0 }}>{log.icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: "12px", color: log.color, lineHeight: 1.4, wordBreak: "break-word" }}>{log.text}</p>
                <p style={{ fontSize: "10px", color: "rgba(240,239,232,0.2)", marginTop: "2px" }}>{log.timestamp}</p>
              </div>
            </div>
          ))
        )}
      </div>
      <style>{`@keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.2} } @keyframes spin { 0%{transform:rotate(0deg)} 100%{transform:rotate(360deg)} }`}</style>
    </div>
  );
}
