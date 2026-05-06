"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useRealtimeLog, LogEntry } from "@/hooks/useRealtimeLog";
import KpiBar from "@/components/campaign/KpiBar";
import ModeToggle from "@/components/campaign/ModeToggle";
import DashboardLiveLog from "@/components/dashboard/DashboardLiveLog";

const STATUS_MAP: Record<string, { icon: string; label: string; color: string }> = {
  running: { icon: "🟢", label: "稼働中", color: "#2dd17a" },
  paused: { icon: "🟡", label: "一時停止", color: "#ffd60a" },
  completed: { icon: "⚫", label: "完了", color: "rgba(240,239,232,0.4)" },
};

const PLATFORM_ICONS: Record<string, { icon: string; color: string }> = {
  twitter: { icon: "𝕏", color: "#1d9bf0" },
  reddit: { icon: "🤖", color: "#ff4500" },
  linkedin: { icon: "in", color: "#0a66c2" },
  tiktok: { icon: "♪", color: "#ff0050" },
  instagram: { icon: "◈", color: "#e1306c" },
  facebook: { icon: "f", color: "#1877f2" },
  youtube: { icon: "▶", color: "#ff0000" },
  note: { icon: "📝", color: "#41c9b4" },
  zenn: { icon: "Z", color: "#3ea8ff" },
  qiita: { icon: "Q", color: "#55c500" },
  hatena: { icon: "B!", color: "#00a4de" },
  yahoo_qa: { icon: "Y!", color: "#ff0033" },
  web: { icon: "🌐", color: "#2dd17a" },
};

type TargetRow = {
  id: string;
  platform: string;
  username: string;
  post_url: string | null;
  post_content: string | null;
  match_score: number;
  match_reason: string | null;
  email: string | null;
  comment?: { id: string; content: string; approach: string | null };
  excluded?: boolean;
};

export default function CampaignDetailPage() {
  const params = useParams();
  const router = useRouter();
  const campaignId = params.id as string;
  const realtimeLogs = useRealtimeLog(campaignId);
  const [initialLogs, setInitialLogs] = useState<LogEntry[]>([]);

  const [campaign, setCampaign] = useState<Record<string, unknown> | null>(null);
  const [targets, setTargets] = useState<TargetRow[]>([]);
  const [funnel, setFunnel] = useState({ discovered: 0, generated: 0, exported: 0 });
  const [loading, setLoading] = useState(true);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState("");
  const [exporting, setExporting] = useState(false);
  const [platformFilter, setPlatformFilter] = useState<string>("all");

  const buildLogsFromData = useCallback((
    existingTargets: { platform: string; username: string; match_score: number; created_at: string; id: string }[],
    existingComments: { platform: string; created_at: string; id: string }[],
  ): LogEntry[] => {
    const entries: { log: LogEntry; time: string }[] = [];

    existingComments?.forEach((c) => {
      const ts = new Date(c.created_at).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      entries.push({ log: { id: `log-c-${c.id}`, icon: "✍️", text: `コメント生成: ${c.platform}`, color: "#ffd60a", timestamp: ts, type: "generate" }, time: c.created_at });
    });

    existingTargets?.forEach((t) => {
      const ts = new Date(t.created_at).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      entries.push({ log: { id: `log-t-${t.id}`, icon: "🔍", text: `${t.platform}で発見: @${t.username} (マッチ度${t.match_score}%)`, color: "#ff6b35", timestamp: ts, type: "find" }, time: t.created_at });
    });

    entries.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
    return entries.slice(0, 20).map((e) => e.log);
  }, []);

  const fetchData = useCallback(async () => {
    const supabase = createClient();
    const { data: camp } = await supabase.from("campaigns").select("*").eq("id", campaignId).single();
    if (!camp) { router.push("/dashboard"); return; }
    setCampaign(camp);

    const { data: tgts } = await supabase.from("targets").select("*, comments(*)").eq("campaign_id", campaignId).order("match_score", { ascending: false });

    const enriched: TargetRow[] = (tgts || []).map((t: Record<string, unknown>) => {
      const comments = (t.comments as Array<Record<string, unknown>>) || [];
      const comment = comments[0];
      return {
        id: t.id as string,
        platform: t.platform as string,
        username: t.username as string,
        post_url: t.post_url as string | null,
        post_content: t.post_content as string | null,
        match_score: t.match_score as number,
        match_reason: t.match_reason as string | null,
        email: t.email as string | null,
        comment: comment ? {
          id: comment.id as string,
          content: comment.content as string,
          approach: comment.approach as string | null,
        } : undefined,
      };
    });
    setTargets(enriched);

    const discovered = enriched.length;
    const generated = enriched.filter((t) => t.comment).length;
    setFunnel({ discovered, generated, exported: 0 });

    // Activity logs
    const { data: logTargets } = await supabase
      .from("targets")
      .select("id, platform, username, match_score, created_at")
      .eq("campaign_id", campaignId)
      .order("created_at", { ascending: false })
      .limit(20);

    const { data: logComments } = await supabase
      .from("comments")
      .select("id, platform, created_at")
      .eq("campaign_id", campaignId)
      .order("created_at", { ascending: false })
      .limit(10);

    const builtLogs = buildLogsFromData(logTargets || [], logComments || []);
    setInitialLogs(builtLogs);
    setLoading(false);
  }, [campaignId, router, buildLogsFromData]);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => {
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const logs = [...realtimeLogs, ...initialLogs.filter((il) => !realtimeLogs.some((rl) => rl.text === il.text))].slice(0, 20);
  const hasData = targets.length > 0;

  const handleExclude = (targetId: string) => {
    setExcluded((prev) => new Set(prev).add(targetId));
    setToast("除外しました");
    setTimeout(() => setToast(""), 2000);
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/export`);
      if (!res.ok) { alert("エクスポートに失敗しました"); setExporting(false); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `spark_targets_${campaignId.slice(0, 8)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      setFunnel((prev) => ({ ...prev, exported: prev.generated }));
      setToast("✅ エクスポート完了！");
      setTimeout(() => setToast(""), 3000);
    } catch { alert("エクスポートに失敗しました"); }
    setExporting(false);
  };

  const st = STATUS_MAP[campaign?.status as string] || STATUS_MAP.running;

  // Get unique platforms for filter
  const uniquePlatforms = [...new Set(targets.map((t) => t.platform))];

  const visibleTargets = targets
    .filter((t) => !excluded.has(t.id))
    .filter((t) => t.comment) // only show targets with generated comments
    .filter((t) => platformFilter === "all" || t.platform === platformFilter);

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
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <button
              onClick={handleExport}
              disabled={exporting}
              style={{
                background: "linear-gradient(135deg, #2dd17a, #1ba360)",
                color: "#fff",
                border: "none",
                borderRadius: "12px",
                padding: "10px 24px",
                fontSize: "14px",
                fontWeight: 700,
                cursor: exporting ? "wait" : "pointer",
                fontFamily: "DM Sans, sans-serif",
                display: "flex",
                alignItems: "center",
                gap: "8px",
                boxShadow: "0 4px 20px rgba(45,209,122,0.3)",
                transition: "all 0.2s",
                opacity: exporting ? 0.7 : 1,
              }}
              onMouseEnter={(e) => { if (!exporting) e.currentTarget.style.transform = "translateY(-1px)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.transform = "translateY(0)"; }}
            >
              📊 {exporting ? "エクスポート中..." : "Excelでエクスポート"}
            </button>
            <ModeToggle campaignId={campaignId} autoMode={campaign?.auto_mode as boolean || false} onToggle={(m) => setCampaign((p) => p ? { ...p, auto_mode: m } : p)} />
          </div>
        </div>
      </div>

      <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "24px" }}>
        <KpiBar funnel={funnel} />

        <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: "24px" }}>
          {/* Left - Target list */}
          <div>
            {/* Platform filter */}
            <div style={{ display: "flex", gap: "8px", marginBottom: "16px", flexWrap: "wrap" }}>
              <button
                onClick={() => setPlatformFilter("all")}
                style={{
                  background: platformFilter === "all" ? "rgba(255,107,53,0.15)" : "rgba(255,255,255,0.03)",
                  border: `1px solid ${platformFilter === "all" ? "rgba(255,107,53,0.4)" : "rgba(255,255,255,0.07)"}`,
                  borderRadius: "10px", padding: "6px 14px", fontSize: "12px", fontWeight: 600,
                  color: platformFilter === "all" ? "#ff6b35" : "rgba(240,239,232,0.5)",
                  cursor: "pointer", transition: "all 0.2s",
                }}
              >
                全て ({targets.filter((t) => t.comment && !excluded.has(t.id)).length})
              </button>
              {uniquePlatforms.map((p) => {
                const pi = PLATFORM_ICONS[p] || { icon: "?", color: "#888" };
                const count = targets.filter((t) => t.platform === p && t.comment && !excluded.has(t.id)).length;
                if (count === 0) return null;
                return (
                  <button
                    key={p}
                    onClick={() => setPlatformFilter(p)}
                    style={{
                      background: platformFilter === p ? `${pi.color}15` : "rgba(255,255,255,0.03)",
                      border: `1px solid ${platformFilter === p ? `${pi.color}40` : "rgba(255,255,255,0.07)"}`,
                      borderRadius: "10px", padding: "6px 14px", fontSize: "12px", fontWeight: 600,
                      color: platformFilter === p ? pi.color : "rgba(240,239,232,0.5)",
                      cursor: "pointer", transition: "all 0.2s",
                    }}
                  >
                    {pi.icon} {p} ({count})
                  </button>
                );
              })}
            </div>

            {/* Results count */}
            <div style={{ fontSize: "13px", color: "rgba(240,239,232,0.4)", marginBottom: "12px" }}>
              {visibleTargets.length}件のターゲット（コメント生成済み）
            </div>

            {/* Target rows */}
            {visibleTargets.length === 0 ? (
              <div style={{ background: "#13132a", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "16px", padding: "40px 20px", textAlign: "center" }}>
                <div style={{ fontSize: "32px", marginBottom: "12px" }}>🔍</div>
                <div style={{ fontSize: "14px", color: "rgba(240,239,232,0.5)" }}>
                  {targets.length === 0 ? "ターゲットを発見中..." : "コメント生成中..."}
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {visibleTargets.map((t) => {
                  const pi = PLATFORM_ICONS[t.platform] || { icon: "?", color: "#888" };
                  return (
                    <div key={t.id} style={{ background: "#13132a", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "14px", padding: "16px 20px", transition: "border-color 0.2s" }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.15)"; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.07)"; }}
                    >
                      {/* Row 1: platform + username + score + exclude */}
                      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "10px" }}>
                        <span style={{ fontSize: "16px", fontWeight: 700, color: pi.color, width: "24px", textAlign: "center" }}>{pi.icon}</span>
                        <span style={{ fontSize: "13px", fontWeight: 600, color: "#f0efe8" }}>@{t.username}</span>
                        <span style={{ fontSize: "11px", padding: "2px 8px", borderRadius: "6px", background: `${pi.color}15`, color: pi.color, fontWeight: 600 }}>
                          {t.match_score}%
                        </span>
                        {t.email && (
                          <span style={{ fontSize: "11px", padding: "2px 8px", borderRadius: "6px", background: "rgba(45,209,122,0.1)", color: "#2dd17a", fontWeight: 600 }}>
                            ✉️ {t.email}
                          </span>
                        )}
                        <button
                          onClick={() => handleExclude(t.id)}
                          style={{ marginLeft: "auto", background: "transparent", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", padding: "4px 10px", fontSize: "11px", color: "rgba(240,239,232,0.3)", cursor: "pointer", transition: "all 0.2s" }}
                          onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(255,0,0,0.3)"; e.currentTarget.style.color = "#ff4444"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)"; e.currentTarget.style.color = "rgba(240,239,232,0.3)"; }}
                        >
                          除外
                        </button>
                      </div>

                      {/* Row 2: post snippet */}
                      {t.post_content && (
                        <div style={{ fontSize: "12px", color: "rgba(240,239,232,0.4)", marginBottom: "10px", fontStyle: "italic", lineHeight: 1.5 }}>
                          &quot;{t.post_content.slice(0, 120)}{t.post_content.length > 120 ? "..." : ""}&quot;
                        </div>
                      )}

                      {/* Row 3: generated comment */}
                      {t.comment && (
                        <div style={{ background: "rgba(255,214,10,0.04)", border: "1px solid rgba(255,214,10,0.1)", borderRadius: "10px", padding: "12px", fontSize: "13px", color: "rgba(240,239,232,0.8)", lineHeight: 1.6 }}>
                          {t.comment.content}
                        </div>
                      )}

                      {/* Row 4: URL link */}
                      {t.post_url && (
                        <div style={{ marginTop: "8px" }}>
                          <a href={t.post_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: "11px", color: "rgba(240,239,232,0.25)", textDecoration: "none", wordBreak: "break-all" }}>
                            🔗 {t.post_url.slice(0, 60)}...
                          </a>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right - Live log */}
          <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
            <div style={{ height: "500px" }}>
              <DashboardLiveLog
                logs={logs}
                platforms={(campaign?.platforms as string[]) || []}
                campaignCreatedAt={campaign?.created_at as string}
                hasData={hasData}
              />
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
