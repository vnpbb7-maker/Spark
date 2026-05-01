"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useRealtimeLog } from "@/hooks/useRealtimeLog";
import KpiBar from "@/components/campaign/KpiBar";
import TargetList from "@/components/campaign/TargetList";
import ModeToggle from "@/components/campaign/ModeToggle";
import DashboardLiveLog from "@/components/dashboard/DashboardLiveLog";

const STATUS_MAP: Record<string, { icon: string; label: string; color: string }> = {
  running: { icon: "🟢", label: "稼働中", color: "#2dd17a" },
  paused: { icon: "🟡", label: "一時停止", color: "#ffd60a" },
  completed: { icon: "⚫", label: "完了", color: "rgba(240,239,232,0.4)" },
};

type TargetWithComment = {
  id: string; platform: string; username: string; post_url: string | null;
  post_content: string | null; match_score: number; match_reason: string | null;
  comment?: { id: string; content: string; approach: string | null; approved: boolean; posted_at: string | null; response_text: string | null; };
};

const INSIGHTS = [
  { title: "今週何が刺さったか", content: "Redditでの共感型コメントが最も高い返信率（34%）を記録。特にr/startups での「自分も同じ経験をした」という切り口が効果的でした。" },
  { title: "改善提案", content: "LinkedInでの投稿は午前10時〜12時の投稿が最もエンゲージメントが高い傾向にあります。投稿スケジュールの調整を推奨します。" },
  { title: "次のアクション", content: "TikTokでのハッシュタグ戦略を見直し、#startuplife #indiehacker を追加することで新規ターゲット層にリーチ可能です。" },
];

export default function CampaignDetailPage() {
  const params = useParams();
  const router = useRouter();
  const campaignId = params.id as string;
  const logs = useRealtimeLog(campaignId);

  const [campaign, setCampaign] = useState<Record<string, unknown> | null>(null);
  const [targets, setTargets] = useState<TargetWithComment[]>([]);
  const [tab, setTab] = useState<"pending" | "posted" | "replied">("pending");
  const [funnel, setFunnel] = useState({ discovered: 0, generated: 0, approved: 0, posted: 0, replied: 0, converted: 0 });
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    const supabase = createClient();
    const { data: camp } = await supabase.from("campaigns").select("*").eq("id", campaignId).single();
    if (!camp) { router.push("/dashboard"); return; }
    setCampaign(camp);

    // Fetch targets with comments
    const { data: tgts } = await supabase.from("targets").select("*, comments(*)").eq("campaign_id", campaignId).order("created_at", { ascending: false });

    const enriched: TargetWithComment[] = (tgts || []).map((t: Record<string, unknown>) => {
      const comments = (t.comments as Array<Record<string, unknown>>) || [];
      const comment = comments[0];
      return { id: t.id as string, platform: t.platform as string, username: t.username as string, post_url: t.post_url as string | null, post_content: t.post_content as string | null, match_score: t.match_score as number, match_reason: t.match_reason as string | null, comment: comment ? { id: comment.id as string, content: comment.content as string, approach: comment.approach as string | null, approved: comment.approved as boolean, posted_at: comment.posted_at as string | null, response_text: comment.response_text as string | null } : undefined };
    });
    setTargets(enriched);

    // Funnel
    const discovered = enriched.length;
    const generated = enriched.filter((t) => t.comment).length;
    const approved = enriched.filter((t) => t.comment?.approved).length;
    const posted = enriched.filter((t) => t.comment?.posted_at).length;
    const replied = enriched.filter((t) => t.comment?.response_text).length;
    setFunnel({ discovered, generated, approved, posted, replied, converted: Math.floor(replied * 0.6) });
    setLoading(false);
  }, [campaignId, router]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filteredTargets = targets.filter((t) => {
    if (tab === "pending") return t.comment && !t.comment.approved;
    if (tab === "posted") return t.comment?.posted_at;
    if (tab === "replied") return t.comment?.response_text;
    return true;
  });

  const pendingCount = targets.filter((t) => t.comment && !t.comment.approved).length;
  const st = STATUS_MAP[campaign?.status as string] || STATUS_MAP.running;

  if (loading) return <div style={{ minHeight: "100vh", background: "#0d0d1a", display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(240,239,232,0.3)" }}>読み込み中...</div>;

  return (
    <div style={{ minHeight: "100vh", background: "#0d0d1a", color: "#f0efe8" }}>
      {/* Header */}
      <div style={{ borderBottom: "1px solid rgba(255,255,255,0.07)", padding: "16px 24px" }}>
        <div style={{ maxWidth: "1200px", margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            <a href="/dashboard" style={{ color: "rgba(240,239,232,0.4)", textDecoration: "none", fontSize: "14px" }}>← ダッシュボード</a>
            <span style={{ color: "rgba(255,255,255,0.1)" }}>|</span>
            <h1 style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: "18px" }}>
              {(campaign?.product_description as string || "").slice(0, 30)}
            </h1>
            <span style={{ fontSize: "12px", padding: "4px 10px", borderRadius: "8px", background: `${st.color}20`, color: st.color, fontWeight: 600 }}>{st.icon} {st.label}</span>
          </div>
          <ModeToggle campaignId={campaignId} autoMode={campaign?.auto_mode as boolean || false} onToggle={(m) => setCampaign((p) => p ? { ...p, auto_mode: m } : p)} />
        </div>
      </div>

      <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "24px" }}>
        <KpiBar funnel={funnel} />

        <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: "24px" }}>
          {/* Left - Target list */}
          <div>
            <TargetList targets={filteredTargets} tab={tab} onTabChange={setTab} pendingCount={pendingCount} onRefresh={fetchData} />
          </div>

          {/* Right - Live log + Insights */}
          <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
            <div style={{ height: "400px" }}>
              <DashboardLiveLog logs={logs} />
            </div>
            <div style={{ background: "#13132a", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "16px", padding: "20px" }}>
              <h3 style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: "14px", color: "#ff6b35", marginBottom: "16px" }}>🧠 AIインサイト（週次）</h3>
              {INSIGHTS.map((ins, i) => (
                <div key={i} style={{ marginBottom: i < INSIGHTS.length - 1 ? "16px" : 0, paddingBottom: i < INSIGHTS.length - 1 ? "16px" : 0, borderBottom: i < INSIGHTS.length - 1 ? "1px solid rgba(255,255,255,0.05)" : "none" }}>
                  <p style={{ fontSize: "12px", fontWeight: 600, color: "#f0efe8", marginBottom: "4px" }}>{ins.title}</p>
                  <p style={{ fontSize: "12px", color: "rgba(240,239,232,0.4)", lineHeight: 1.5 }}>{ins.content}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
