"use client";

import { useState } from "react";

type Props = {
  onAnalyze: (data: { url?: string; description?: string }) => void;
};

export default function Step1Input({ onAnalyze }: Props) {
  const [tab, setTab] = useState<"url" | "text">("url");
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");

  const handleSubmit = () => {
    if (tab === "url" && url.trim()) {
      onAnalyze({ url: url.trim() });
    } else if (tab === "text" && description.trim()) {
      onAnalyze({ description: description.trim() });
    }
  };

  const isValid = tab === "url" ? url.trim().length > 0 : description.trim().length > 0;

  return (
    <div style={{ maxWidth: "600px", margin: "0 auto" }}>
      <h2
        style={{
          fontFamily: "'Space Grotesk', sans-serif",
          fontWeight: 700,
          fontSize: "28px",
          color: "#f0efe8",
          textAlign: "center",
          marginBottom: "8px",
        }}
      >
        プロダクトを教えてください
      </h2>
      <p
        style={{
          textAlign: "center",
          color: "rgba(240,239,232,0.5)",
          fontSize: "15px",
          marginBottom: "40px",
        }}
      >
        AIがあなたのプロダクトを分析し、最適なターゲットを見つけます
      </p>

      {/* Tab switcher */}
      <div
        style={{
          display: "flex",
          background: "rgba(255,255,255,0.04)",
          borderRadius: "12px",
          padding: "4px",
          marginBottom: "24px",
          border: "1px solid rgba(255,255,255,0.07)",
        }}
      >
        {(["url", "text"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              flex: 1,
              padding: "12px 16px",
              borderRadius: "10px",
              border: "none",
              cursor: "pointer",
              fontSize: "14px",
              fontWeight: 600,
              fontFamily: "'Space Grotesk', sans-serif",
              transition: "all 0.2s",
              background: tab === t ? "rgba(255,107,53,0.15)" : "transparent",
              color: tab === t ? "#ff6b35" : "rgba(240,239,232,0.5)",
            }}
          >
            {t === "url" ? "URLで入力" : "テキストで説明"}
          </button>
        ))}
      </div>

      {/* Input area */}
      {tab === "url" ? (
        <div>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://your-product.com"
            style={{
              width: "100%",
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: "14px",
              padding: "18px 20px",
              color: "#f0efe8",
              fontSize: "16px",
              outline: "none",
              transition: "border-color 0.2s",
              boxSizing: "border-box",
            }}
            onFocus={(e) => (e.target.style.borderColor = "rgba(255,107,53,0.5)")}
            onBlur={(e) => (e.target.style.borderColor = "rgba(255,255,255,0.1)")}
          />
        </div>
      ) : (
        <div>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={`プロダクトの説明を入力...\n例：HIBANAは年齢を超えた議論アプリです。\nAIが毎日トピックを選び、匿名で議論後に\nプロフィールが公開されます。`}
            rows={5}
            style={{
              width: "100%",
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: "14px",
              padding: "18px 20px",
              color: "#f0efe8",
              fontSize: "15px",
              outline: "none",
              resize: "vertical",
              fontFamily: "'DM Sans', sans-serif",
              lineHeight: 1.6,
              transition: "border-color 0.2s",
              boxSizing: "border-box",
            }}
            onFocus={(e) => (e.target.style.borderColor = "rgba(255,107,53,0.5)")}
            onBlur={(e) => (e.target.style.borderColor = "rgba(255,255,255,0.1)")}
          />
        </div>
      )}

      {/* Submit button */}
      <button
        onClick={handleSubmit}
        disabled={!isValid}
        style={{
          width: "100%",
          marginTop: "24px",
          padding: "16px 24px",
          background: isValid ? "#ff6b35" : "rgba(255,107,53,0.3)",
          color: "#fff",
          border: "none",
          borderRadius: "14px",
          fontSize: "16px",
          fontWeight: 700,
          fontFamily: "'Space Grotesk', sans-serif",
          cursor: isValid ? "pointer" : "not-allowed",
          boxShadow: isValid ? "0 0 30px rgba(255,107,53,0.35)" : "none",
          transition: "all 0.2s",
        }}
      >
        AIに分析させる →
      </button>
    </div>
  );
}
