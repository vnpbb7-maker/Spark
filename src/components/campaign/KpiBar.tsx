"use client";

type Props = {
  funnel: {
    discovered: number;
    generated: number;
    exported: number;
  };
};

const STEPS = [
  { key: "discovered", label: "発見済み", color: "#1d9bf0" },
  { key: "generated", label: "生成済み", color: "#ffd60a" },
  { key: "exported", label: "エクスポート済み", color: "#2dd17a" },
] as const;

export default function KpiBar({ funnel }: Props) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0", background: "#13132a", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "16px", padding: "20px 24px", marginBottom: "24px", overflowX: "auto" }}>
      {STEPS.map((s, i) => (
        <div key={s.key} style={{ display: "flex", alignItems: "center", flex: 1 }}>
          <div style={{ textAlign: "center", flex: 1 }}>
            <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: "28px", color: s.color }}>
              {funnel[s.key]}
            </div>
            <div style={{ fontSize: "12px", color: "rgba(240,239,232,0.4)", marginTop: "4px", whiteSpace: "nowrap" }}>{s.label}</div>
          </div>
          {i < STEPS.length - 1 && (
            <div style={{ color: "rgba(240,239,232,0.15)", fontSize: "20px", margin: "0 12px" }}>→</div>
          )}
        </div>
      ))}
    </div>
  );
}
