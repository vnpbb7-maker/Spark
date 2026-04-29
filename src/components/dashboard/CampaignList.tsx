"use client";

type Campaign = {
  id: string;
  product_description: string;
  platforms: string[];
  auto_mode: boolean;
  status: string;
  targets_count: number;
  posted_count: number;
  conversion_count: number;
};

const STATUS_MAP: Record<string, { icon: string; label: string; color: string }> = {
  running: { icon: "🟢", label: "稼働中", color: "#2dd17a" },
  paused: { icon: "🟡", label: "一時停止", color: "#ffd60a" },
  completed: { icon: "⚫", label: "完了", color: "rgba(240,239,232,0.4)" },
};

const PLATFORM_ICONS: Record<string, string> = {
  twitter: "𝕏", reddit: "🤖", linkedin: "in", tiktok: "♪", instagram: "◈", facebook: "f",
};

type Props = {
  campaigns: Campaign[];
  onPause: (id: string) => void;
  onDelete: (id: string) => void;
};

export default function CampaignList({ campaigns, onPause, onDelete }: Props) {
  return (
    <div style={{ background: "#13132a", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "16px", overflow: "hidden" }}>
      <div style={{ padding: "20px 24px", borderBottom: "1px solid rgba(255,255,255,0.07)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h3 style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: "16px", color: "#f0efe8" }}>キャンペーン一覧</h3>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
              {["プロダクト", "プラットフォーム", "モード", "ステータス", "発見数", "投稿数", "転換数", "操作"].map((h) => (
                <th key={h} style={{ padding: "12px 16px", textAlign: "left", color: "rgba(240,239,232,0.35)", fontWeight: 600, fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.5px" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {campaigns.length === 0 ? (
              <tr><td colSpan={8} style={{ padding: "40px", textAlign: "center", color: "rgba(240,239,232,0.3)" }}>キャンペーンがありません</td></tr>
            ) : (
              campaigns.map((c) => {
                const st = STATUS_MAP[c.status] || STATUS_MAP.running;
                return (
                  <tr key={c.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                    <td style={{ padding: "14px 16px", color: "#f0efe8", fontWeight: 500, maxWidth: "200px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.product_description.slice(0, 40)}</td>
                    <td style={{ padding: "14px 16px" }}>
                      <div style={{ display: "flex", gap: "4px" }}>
                        {c.platforms.map((p) => <span key={p} title={p} style={{ fontSize: "14px" }}>{PLATFORM_ICONS[p] || p}</span>)}
                      </div>
                    </td>
                    <td style={{ padding: "14px 16px", color: c.auto_mode ? "#2dd17a" : "#ff6b35" }}>{c.auto_mode ? "🟢 全自動" : "🔶 半自動"}</td>
                    <td style={{ padding: "14px 16px", color: st.color }}>{st.icon} {st.label}</td>
                    <td style={{ padding: "14px 16px", color: "#f0efe8", fontWeight: 600 }}>{c.targets_count}</td>
                    <td style={{ padding: "14px 16px", color: "#f0efe8", fontWeight: 600 }}>{c.posted_count}</td>
                    <td style={{ padding: "14px 16px", color: "#ffd60a", fontWeight: 600 }}>{c.conversion_count}</td>
                    <td style={{ padding: "14px 16px" }}>
                      <div style={{ display: "flex", gap: "8px" }}>
                        <a href={`/campaigns/${c.id}`} style={{ color: "#ff6b35", fontSize: "12px", fontWeight: 600, textDecoration: "none" }}>詳細</a>
                        <button onClick={() => onPause(c.id)} style={{ background: "none", border: "none", color: "rgba(240,239,232,0.4)", fontSize: "12px", cursor: "pointer" }}>{c.status === "paused" ? "再開" : "一時停止"}</button>
                        <button onClick={() => onDelete(c.id)} style={{ background: "none", border: "none", color: "#ff3b30", fontSize: "12px", cursor: "pointer" }}>削除</button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
