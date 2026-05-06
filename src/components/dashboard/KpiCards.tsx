"use client";

type KpiData = {
  targetsFound: number;
  analyzed: number;
  exported: number;
  conversions: number;
  prevTargets: number;
  prevAnalyzed: number;
  prevExported: number;
  prevConversions: number;
};

function calcDiff(current: number, prev: number): string {
  if (prev === 0) return current > 0 ? "+∞" : "±0";
  const pct = Math.round(((current - prev) / prev) * 100);
  return pct >= 0 ? `+${pct}%` : `${pct}%`;
}

export default function KpiCards({ data }: { data: KpiData }) {
  const cards = [
    { label: "総ターゲット発見数", value: data.targetsFound, diff: calcDiff(data.targetsFound, data.prevTargets), color: "#1d9bf0", icon: "🔍" },
    { label: "分析済みターゲット", value: data.analyzed, diff: calcDiff(data.analyzed, data.prevAnalyzed), color: "#ff6b35", icon: "🧠" },
    { label: "エクスポート済み", value: data.exported, diff: calcDiff(data.exported, data.prevExported), color: "#2dd17a", icon: "📊" },
    { label: "βユーザー獲得数", value: data.conversions, diff: calcDiff(data.conversions, data.prevConversions), color: "#ffd60a", icon: "🎉" },
  ];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px", marginBottom: "24px" }}>
      {cards.map((c) => (
        <div key={c.label} style={{ background: "#13132a", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "16px", padding: "24px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
            <span style={{ fontSize: "12px", color: "rgba(240,239,232,0.4)", fontWeight: 600 }}>{c.label}</span>
            <span style={{ fontSize: "20px" }}>{c.icon}</span>
          </div>
          <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: "36px", color: "#f0efe8", marginBottom: "4px" }}>
            {c.value.toLocaleString()}
          </div>
          <span style={{ fontSize: "12px", fontWeight: 600, color: c.diff.startsWith("+") ? "#2dd17a" : c.diff.startsWith("-") ? "#ff3b30" : "rgba(240,239,232,0.3)" }}>
            {c.diff} 前日比
          </span>
        </div>
      ))}
    </div>
  );
}
