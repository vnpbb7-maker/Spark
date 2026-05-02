"use client";

import { useRouter } from "next/navigation";

export default function AnalyticsPage() {
  const router = useRouter();
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0d0d1a",
        color: "#f0efe8",
        fontFamily: "DM Sans, sans-serif",
        padding: 32,
      }}
    >
      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            marginBottom: 32,
          }}
        >
          <button
            onClick={() => router.push("/dashboard")}
            style={{
              background: "transparent",
              border: "0.5px solid rgba(255,255,255,0.15)",
              borderRadius: 8,
              padding: "6px 12px",
              color: "rgba(240,239,232,0.6)",
              cursor: "pointer",
              fontSize: 13,
              fontFamily: "DM Sans",
            }}
          >
            ← ダッシュボード
          </button>
          <h1
            style={{
              fontFamily: "Space Grotesk",
              fontSize: 24,
              fontWeight: 700,
            }}
          >
            アナリティクス
          </h1>
        </div>
        <div
          style={{
            background: "#13132a",
            border: "0.5px solid rgba(255,255,255,0.07)",
            borderRadius: 16,
            padding: 48,
            textAlign: "center",
            color: "rgba(240,239,232,0.5)",
          }}
        >
          <div style={{ fontSize: 48, marginBottom: 16 }}>📈</div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>
            アナリティクスは準備中です
          </div>
          <div style={{ fontSize: 13, marginTop: 8 }}>
            キャンペーンが動き出すとデータが表示されます
          </div>
        </div>
      </div>
    </div>
  );
}
