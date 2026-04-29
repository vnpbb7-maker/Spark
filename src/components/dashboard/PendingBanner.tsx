"use client";

type Props = {
  count: number;
  onNavigate: () => void;
};

export default function PendingBanner({ count, onNavigate }: Props) {
  if (count <= 0) return null;
  return (
    <div style={{ background: "rgba(255,107,53,0.1)", border: "1px solid rgba(255,107,53,0.3)", borderRadius: "14px", padding: "16px 24px", marginBottom: "24px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        <span style={{ fontSize: "20px" }}>✍</span>
        <span style={{ fontSize: "14px", color: "#f0efe8", fontWeight: 500 }}>承認待ちのコメントが<strong style={{ color: "#ff6b35" }}>{count}件</strong>あります</span>
      </div>
      <button onClick={onNavigate} style={{ background: "#ff6b35", color: "#fff", border: "none", borderRadius: "10px", padding: "10px 20px", fontSize: "13px", fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif", cursor: "pointer", boxShadow: "0 0 15px rgba(255,107,53,0.3)" }}>
        今すぐ確認する →
      </button>
    </div>
  );
}
