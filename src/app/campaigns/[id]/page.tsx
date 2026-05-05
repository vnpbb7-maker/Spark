"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useRealtimeLog, LogEntry } from "@/hooks/useRealtimeLog";
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
  const realtimeLogs = useRealtimeLog(campaignId);
  const [initialLogs, setInitialLogs] = useState<LogEntry[]>([]);

  const [campaign, setCampaign] = useState<Record<string, unknown> | null>(null);
  const [targets, setTargets] = useState<TargetWithComment[]>([]);
  const [tab, setTab] = useState<"pending" | "posted" | "replied">("pending");
  const [funnel, setFunnel] = useState({ discovered: 0, generated: 0, approved: 0, posted: 0, replied: 0, converted: 0 });
  const [loading, setLoading] = useState(true);
  const [kpi, setKpi] = useState({ targets: 0, generated: 0, approved: 0, posted: 0 });
  const [pendingComments, setPendingComments] = useState<any[]>([]);
  const [postedComments, setPostedComments] = useState<any[]>([]);
  const [toast, setToast] = useState("");

  // 既存アクティビティを取得
  const fetchExistingActivity = useCallback(async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: existingTargets } = await supabase
      .from("targets")
      .select("platform, username, match_score, created_at")
      .eq("campaign_id", campaignId)
      .order("created_at", { ascending: false })
      .limit(20);

    const { data: existingComments } = await supabase
      .from("comments")
      .select("platform, approved, posted_at, created_at")
      .eq("campaign_id", campaignId)
      .order("created_at", { ascending: false })
      .limit(10);

    const entries: { log: LogEntry; time: string }[] = [];
    let counter = 0;

    existingComments?.forEach((c) => {
      const ts = new Date(c.posted_at || c.created_at).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      if (c.posted_at) {
        entries.push({ log: { id: `init-${++counter}`, icon: "📤", text: `投稿完了: ${c.platform}`, color: "#2dd17a", timestamp: ts, type: "post" }, time: c.posted_at });
      } else if (c.approved) {
        entries.push({ log: { id: `init-${++counter}`, icon: "✅", text: `承認済み: ${c.platform}`, color: "#7c5cfc", timestamp: ts, type: "approve" }, time: c.created_at });
      } else {
        entries.push({ log: { id: `init-${++counter}`, icon: "✍", text: `コメント生成: ${c.platform}`, color: "#ffd60a", timestamp: ts, type: "generate" }, time: c.created_at });
      }
    });

    existingTargets?.forEach((t) => {
      const ts = new Date(t.created_at).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      entries.push({ log: { id: `init-${++counter}`, icon: "🔍", text: `${t.platform}で発見: @${t.username} (マッチ度${t.match_score}%)`, color: "#ff6b35", timestamp: ts, type: "find" }, time: t.created_at });
    });

    entries.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
    setInitialLogs(entries.slice(0, 20).map((e) => e.log));
  }, [campaignId]);

  // 初回取得
  useEffect(() => {
    if (campaignId) fetchExistingActivity();
  }, [campaignId, fetchExistingActivity]);

  // ポーリング: runningなら10秒、それ以外は30秒
  useEffect(() => {
    const pollInterval = campaign?.status === "running" ? 10000 : 30000;
    const interval = setInterval(() => {
      fetchExistingActivity();
    }, pollInterval);
    return () => clearInterval(interval);
  }, [campaign?.status, fetchExistingActivity]);

  // リアルタイム + 既存ログを結合
  const logs = [...realtimeLogs, ...initialLogs.filter((il) => !realtimeLogs.some((rl) => rl.text === il.text))].slice(0, 20);

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

    // KPI counts
    const { count: targetsCount } = await supabase.from("targets").select("*", { count: "exact", head: true }).eq("campaign_id", campaignId);
    const { count: commentsCount } = await supabase.from("comments").select("*", { count: "exact", head: true }).eq("campaign_id", campaignId);
    const { count: approvedCount } = await supabase.from("comments").select("*", { count: "exact", head: true }).eq("campaign_id", campaignId).eq("approved", true);
    const { count: postedCount } = await supabase.from("comments").select("*", { count: "exact", head: true }).eq("campaign_id", campaignId).not("posted_at", "is", null);
    setKpi({ targets: targetsCount || 0, generated: commentsCount || 0, approved: approvedCount || 0, posted: postedCount || 0 });

    setLoading(false);
  }, [campaignId, router]);

  // コメント取得
  const fetchComments = useCallback(async () => {
    const supabase = createClient();
    const { data: pending } = await supabase
      .from("comments")
      .select("*, targets(username, platform, post_url, post_content)")
      .eq("campaign_id", campaignId)
      .eq("approved", false)
      .is("posted_at", null)
      .order("created_at", { ascending: false });
    setPendingComments(pending || []);

    const { data: posted } = await supabase
      .from("comments")
      .select("*, targets(username, platform, post_url)")
      .eq("campaign_id", campaignId)
      .not("posted_at", "is", null)
      .order("posted_at", { ascending: false });
    setPostedComments(posted || []);
  }, [campaignId]);

  // 承認
  const handleApprove = async (commentId: string) => {
    setPendingComments((prev) => prev.filter((c) => c.id !== commentId));
    setToast("✅ 承認しました。投稿処理中...");
    setTimeout(() => setToast(""), 3000);

    const supabase = createClient();
    await supabase.from("comments").update({ approved: true, approved_at: new Date().toISOString() }).eq("id", commentId);
    fetch("/api/comments/post", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ comment_id: commentId }) })
      .then((r) => r.json())
      .then((d) => {
        console.log("Post result:", d);
        fetchData();
      })
      .catch((err) => {
        console.error("Post error:", err);
        fetchData();
      });
  };

  // 却下
  const handleReject = async (commentId: string) => {
    setPendingComments((prev) => prev.filter((c) => c.id !== commentId));
    const supabase = createClient();
    await supabase.from("comments").delete().eq("id", commentId);
  };

  useEffect(() => { fetchData(); fetchComments(); }, [fetchData, fetchComments]);

  // 10秒ポーリング
  useEffect(() => {
    const interval = setInterval(() => { fetchData(); fetchComments(); }, 10000);
    return () => clearInterval(interval);
  }, [fetchData, fetchComments]);

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

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 24 }}>
          {[
            { label: "発見ターゲット", value: kpi.targets, color: "#60a5fa" },
            { label: "コメント生成", value: kpi.generated, color: "#f59e0b" },
            { label: "承認済み", value: kpi.approved, color: "#a78bfa" },
            { label: "投稿済み", value: kpi.posted, color: "#2dd17a" },
          ].map((k) => (
            <div key={k.label} style={{ background: "#13132a", border: "0.5px solid rgba(255,255,255,0.07)", borderRadius: 12, padding: 16, textAlign: "center" }}>
              <div style={{ fontSize: 28, fontWeight: 700, color: k.color }}>{k.value}</div>
              <div style={{ fontSize: 11, color: "rgba(240,239,232,0.5)", marginTop: 2 }}>{k.label}</div>
            </div>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: "24px" }}>
          {/* Left - Target list + Pending comments */}
          <div>
            <TargetList targets={filteredTargets} tab={tab} onTabChange={setTab} pendingCount={pendingCount} onRefresh={fetchData} />

            {/* 承認待ちコメント */}
            {pendingComments.length > 0 && (
              <div style={{ marginTop: 24 }}>
                <h3 style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: 15, color: "#ffd60a", marginBottom: 12 }}>
                  ✍ 承認待ち ({pendingComments.length})
                </h3>
                {pendingComments.map((comment) => (
                  <div key={comment.id} style={{ background: "#13132a", border: "0.5px solid rgba(255,255,255,0.07)", borderRadius: 16, padding: 20, marginBottom: 12 }}>
                    <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                      <span style={{ background: "rgba(255,255,255,0.07)", borderRadius: 8, padding: "3px 10px", fontSize: 12, color: "rgba(240,239,232,0.6)" }}>{comment.platform}</span>
                      <span style={{ fontSize: 12, color: "rgba(240,239,232,0.5)" }}>@{comment.targets?.username}</span>
                    </div>
                    {comment.targets?.post_content && (
                      <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 10, padding: 12, fontSize: 13, color: "rgba(240,239,232,0.5)", marginBottom: 10, fontStyle: "italic" }}>
                        &quot;{(comment.targets.post_content as string).slice(0, 150)}&quot;
                      </div>
                    )}
                    <div style={{ background: "rgba(255,107,53,0.05)", border: "0.5px solid rgba(255,107,53,0.2)", borderRadius: 10, padding: 12, fontSize: 14, color: "#f0efe8", marginBottom: 12 }}>
                      {comment.content}
                    </div>
                    <div style={{ display: "flex", gap: 10 }}>
                      <button onClick={() => handleApprove(comment.id)} style={{ background: "#2dd17a", color: "#fff", border: "none", borderRadius: 10, padding: "10px 20px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "DM Sans" }}>
                        ✓ 承認して投稿
                      </button>
                      <button onClick={() => handleReject(comment.id)} style={{ background: "transparent", color: "rgba(240,239,232,0.5)", border: "0.5px solid rgba(255,255,255,0.15)", borderRadius: 10, padding: "10px 20px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "DM Sans" }}>
                        ✗ 却下
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* 投稿済みコメント */}
            {postedComments.length > 0 && (
              <div style={{ marginTop: 24 }}>
                <h3 style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: 15, color: "#2dd17a", marginBottom: 12 }}>
                  📤 投稿済み ({postedComments.length})
                </h3>
                {postedComments.slice(0, 5).map((comment) => (
                  <div key={comment.id} style={{ background: "#13132a", border: "0.5px solid rgba(45,209,122,0.15)", borderRadius: 16, padding: 16, marginBottom: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                      <span style={{ background: "rgba(255,255,255,0.07)", borderRadius: 8, padding: "3px 10px", fontSize: 12, color: "rgba(240,239,232,0.6)" }}>{comment.platform}</span>
                      <span style={{ fontSize: 12, color: "rgba(240,239,232,0.5)" }}>@{comment.targets?.username}</span>
                      <span style={{ marginLeft: "auto", fontSize: 11, color: "rgba(240,239,232,0.3)" }}>{new Date(comment.posted_at).toLocaleString("ja-JP")}</span>
                    </div>
                    <div style={{ fontSize: 13, color: "rgba(240,239,232,0.7)", lineHeight: 1.5 }}>{(comment.content as string).slice(0, 200)}</div>
                  </div>
                ))}
              </div>
            )}
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

      {toast && (
        <div style={{ position: "fixed", bottom: 32, right: 32, background: "#2dd17a", color: "#fff", borderRadius: 12, padding: "12px 20px", fontSize: 14, fontWeight: 600, zIndex: 1000, boxShadow: "0 4px 20px rgba(0,0,0,0.3)", fontFamily: "DM Sans" }}>
          {toast}
        </div>
      )}
    </div>
  );
}
