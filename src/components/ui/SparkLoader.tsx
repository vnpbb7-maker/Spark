"use client";

import { useEffect, useState } from "react";

const MESSAGES = [
  "プロダクトを分析中...",
  "ターゲットペルソナを生成中...",
  "最適なプラットフォームを特定中...",
  "キーワードを抽出中...",
];

export default function SparkLoader() {
  const [messageIndex, setMessageIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setMessageIndex((prev) => (prev + 1) % MESSAGES.length);
    }, 1500);
    return () => clearInterval(interval);
  }, []);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "80px 24px",
        gap: "32px",
      }}
    >
      {/* Spark animation */}
      <div style={{ position: "relative", width: "80px", height: "80px" }}>
        {/* Outer ring */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            border: "3px solid rgba(255,107,53,0.15)",
            borderTopColor: "#ff6b35",
            borderRadius: "50%",
            animation: "spin 1s linear infinite",
          }}
        />
        {/* Inner ring */}
        <div
          style={{
            position: "absolute",
            inset: "10px",
            border: "3px solid rgba(255,214,10,0.15)",
            borderBottomColor: "#ffd60a",
            borderRadius: "50%",
            animation: "spin 1.5s linear infinite reverse",
          }}
        />
        {/* Center spark */}
        <div
          style={{
            position: "absolute",
            inset: "24px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "24px",
            animation: "pulse-spark 2s ease-in-out infinite",
          }}
        >
          ⚡
        </div>
      </div>

      {/* Message */}
      <div
        style={{
          textAlign: "center",
        }}
      >
        <p
          style={{
            fontFamily: "'Space Grotesk', sans-serif",
            fontWeight: 600,
            fontSize: "18px",
            color: "#f0efe8",
            marginBottom: "8px",
            transition: "opacity 0.3s",
          }}
          key={messageIndex}
        >
          {MESSAGES[messageIndex]}
        </p>
        <p
          style={{
            fontSize: "13px",
            color: "rgba(240,239,232,0.4)",
          }}
        >
          AIがあなたのプロダクトを理解しています
        </p>
      </div>

      {/* Progress dots */}
      <div style={{ display: "flex", gap: "6px" }}>
        {MESSAGES.map((_, i) => (
          <div
            key={i}
            style={{
              width: "8px",
              height: "8px",
              borderRadius: "50%",
              background: i <= messageIndex ? "#ff6b35" : "rgba(255,107,53,0.2)",
              transition: "background 0.3s",
            }}
          />
        ))}
      </div>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes pulse-spark {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.2); opacity: 0.7; }
        }
      `}</style>
    </div>
  );
}
