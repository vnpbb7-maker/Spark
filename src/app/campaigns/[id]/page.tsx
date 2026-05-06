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
  twitter: { icon: "𝕏", color: "#1d9bf0" }, reddit: { icon: "🤖", color: "#ff4500" },
  linkedin: { icon: "in", color: "#0a66c2" }, tiktok: { icon: "♪", color: "#ff0050" },
  instagram: { icon: "◈", color: "#e1306c" }, facebook: { icon: "f", color: "#1877f2" },
  youtube: { icon: "▶", color: "#ff0000" }, note: { icon: "📝", color: "#41c9b4" },
  zenn: { icon: "Z", color: "#3ea8ff" }, qiita: { icon: "Q", color: "#55c500" },
  hatena: { icon: "B!", color: "#00a4de" }, yahoo_qa: { icon: "Y!", color: "#ff0033" },
  web: { icon: "🌐", color: "#2dd17a" },
};

const PRIORITY_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  S: { bg: "linear-gradient(135deg, #ffd700, #ffaa00)", color: "#000", label: "S" },
  A: { bg: "linear-gradient(135deg, #2dd17a, #1ba360)", color: "#fff", label: "A" },
  B: { bg: "linear-gradient(135deg, #3ea8ff, #2d7fd3)", color: "#fff", label: "B" },
  C: { bg: "rgba(255,255,255,0.08)", color: "rgba(240,239,232,0.4)", label: "C" },
};

type TargetRow = {
  id: string; platform: string; username: string; post_url: string | null;
  post_content: string | null; match_score: number; match_reason: string | null;
  email: string | null; priority: string | null; ai_reason: string | null;
  estimated_age: string | null; estimated_role: string | null;
  comment?: { id: string; content: string; approach: string | null };
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
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState("");
  const [exporting, setExporting] = useState(false);
  const [platformFilter, setPlatformFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const buildLogsFromData = useCallback((
    existingTargets: { platform: string; username: string; match_score: number; created_at: string; id: string; priority?: string }[],
    existingComments: { platform: string; created_at: string; id: string }[],
  ): LogEntry[] => {
    const entries: { log: LogEntry; time: string }[] = [];
    existingComments?.forEach((c) => {
      const ts = new Date(c.created_at).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      entries.push({ log: { id: `log-c-${c.id}`, icon: "✍️", text: `コメント生成: ${c.platform}`, color: "#ffd60a", timestamp: ts, type: "generate" }, time: c.created_at });
    });
    existingTargets?.forEach((t) => {
      const ts = new Date(t.created_at).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      entries.push({ log: { id: `log-t-${t.id}`, icon: "🔍", text: `${t.platform}で発見: @${t.username} (${t.match_score}%)`, color: "#ff6b35", timestamp: ts, type: "find" }, time: t.created_at });
      if (t.priority) {
        entries.push({ log: { id: `log-s-${t.id}`, icon: "🧠", text: `AI分析: @${t.username} → ${t.priority}ランク`, color: "#7c5cfc", timestamp: ts, type: "score" }, time: t.created_at });
      }
    });
    entries.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
    return entries.slice(0, 20).map((e) => e.log);
  }, []);

  const fetchData = useCallback(async () => {
    const supabase = createClient();
    console.log("[fetchData] campaignId:", campaignId);
    const { data: camp } = await supabase.from("campaigns").select("*").eq("id", campaignId).single();
    if (!camp) { router.push("/dashboard"); return; }
    setCampaign(camp);

    const { data: tgts } = await supabase.from("targets").select("*, comments(*)").eq("campaign_id", campaignId).order("match_score", { ascending: false });
    console.log("[fetchData] raw tgts from DB:", tgts?.length);

    const enriched: TargetRow[] = (tgts || []).map((t: Record<string, unknown>) => {
      const comments = (t.comments as Array<Record<string, unknown>>) || [];
      const comment = comments[0];
      return {
        id: t.id as string, platform: t.platform as string, username: t.username as string,
        post_url: t.post_url as string | null, post_content: t.post_content as string | null,
        match_score: t.match_score as number, match_reason: t.match_reason as string | null,
        email: t.email as string | null, priority: t.priority as string | null,
        ai_reason: t.ai_reason as string | null, estimated_age: t.estimated_age as string | null,
        estimated_role: t.estimated_role as string | null,
        comment: comment ? { id: comment.id as string, content: comment.content as string, approach: comment.approach as string | null } : undefined,
      };
    });
    console.log("[fetchData] enriched targets:", enriched.length, "with comments:", enriched.filter((t) => t.comment).length);
    setTargets(enriched);

    const discovered = enriched.length;
    const generated = enriched.filter((t) => t.comment).length;
    setFunnel({ discovered, generated, exported: 0 });

    const { data: logTargets } = await supabase.from("targets").select("id, platform, username, match_score, created_at, priority").eq("campaign_id", campaignId).order("created_at", { ascending: false }).limit(20);
    const { data: logComments } = await supabase.from("comments").select("id, platform, created_at").eq("campaign_id", campaignId).order("created_at", { ascending: false }).limit(10);
    console.log("[fetchData] logTargets:", logTargets?.length, "logComments:", logComments?.length);
    const builtLogs = buildLogsFromData(logTargets || [], logComments || []);
    console.log("[fetchData] builtLogs:", builtLogs.length);
    setInitialLogs([...builtLogs]);
    setLoading(false);
  }, [campaignId, router, buildLogsFromData]);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => { const i = setInterval(fetchData, 10000); return () => clearInterval(i); }, [fetchData]);

  const logs = [...realtimeLogs, ...initialLogs.filter((il) => !realtimeLogs.some((rl) => rl.text === il.text))].slice(0, 20);
  const hasData = targets.length > 0 || initialLogs.length > 0;
  console.log("[CampaignPage] render — targets:", targets.length, "initialLogs:", initialLogs.length, "realtimeLogs:", realtimeLogs.length, "merged logs:", logs.length, "hasData:", hasData);

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/export`);
      if (!res.ok) { alert("エクスポートに失敗しました"); setExporting(false); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = `spark_targets_${campaignId.slice(0, 8)}.xlsx`; a.click();
      URL.revokeObjectURL(url);
      setFunnel((p) => ({ ...p, exported: p.generated }));
      setToast("✅ エクスポート完了！"); setTimeout(() => setToast(""), 3000);
    } catch { alert("エクスポートに失敗しました"); }
    setExporting(false);
  };

  const st = STATUS_MAP[campaign?.status as string] || STATUS_MAP.running;
  const uniquePlatforms = [...new Set(targets.map((t) => t.platform))];

  const visibleTargets = targets
    .filter((t) => t.comment)
    .filter((t) => platformFilter === "all" || t.platform === platformFilter)
    .filter((t) => priorityFilter === "all" || t.priority === priorityFilter);

  const selectedCount = [...selected].filter((id) => visibleTargets.some((t) => t.id === id)).length;

  const selectAll = () => setSelected(new Set(visibleTargets.map((t) => t.id)));
  const selectSA = () => setSelected(new Set(visibleTargets.filter((t) => t.priority === "S" || t.priority === "A").map((t) => t.id)));
  const toggleSelect = (id: string) => setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleExpand = (id: string) => setExpanded((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  if (loading) return <div style={{ minHeight: "100vh", background: "#0d0d1a", display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(240,239,232,0.3)" }}>読み込み中...</div>;

  return (
    <div style={{ minHeight: "100vh", background: "#0d0d1a", color: "#f0efe8" }}>
      {/* Header */}
      <div style={{ borderBottom: "1px solid rgba(255,255,255,0.07)", padding: "16px 24px" }}>
        <div style={{ maxWidth: "1200px", margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            <a href="/dashboard" style={{ color: "rgba(240,239,232,0.4)", textDecoration: "none", fontSize: "14px" }}>← ダッシュボード</a>
            <span style={{ color: "rgba(255,255,255,0.1)" }}>|</span>
            <h1 style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: "18px" }}>{(campaign?.product_description as string || "").slice(0, 30)}</h1>
            <span style={{ fontSize: "12px", padding: "4px 10px", borderRadius: "8px", background: `${st.color}20`, color: st.color, fontWeight: 600 }}>{st.icon} {st.label}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <button onClick={handleExport} disabled={exporting} style={{
              background: "linear-gradient(135deg, #2dd17a, #1ba360)", color: "#fff", border: "none", borderRadius: "12px",
              padding: "10px 24px", fontSize: "14px", fontWeight: 700, cursor: exporting ? "wait" : "pointer",
              fontFamily: "DM Sans, sans-serif", display: "flex", alignItems: "center", gap: "8px",
              boxShadow: "0 4px 20px rgba(45,209,122,0.3)", transition: "all 0.2s", opacity: exporting ? 0.7 : 1,
            }}>
              📊 {exporting ? "エクスポート中..." : `Excelでエクスポート${selectedCount > 0 ? ` (${selectedCount}件)` : ""}`}
            </button>
            <ModeToggle campaignId={campaignId} autoMode={campaign?.auto_mode as boolean || false} onToggle={(m) => setCampaign((p) => p ? { ...p, auto_mode: m } : p)} />
          </div>
        </div>
      </div>

      <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "24px" }}>
        <KpiBar funnel={funnel} />

        <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: "24px" }}>
          {/* Left */}
          <div>
            {/* Filter bar */}
            <div style={{ display: "flex", gap: "8px", marginBottom: "12px", flexWrap: "wrap", alignItems: "center" }}>
              {/* Priority filter */}
              {["all", "S", "A", "B", "C"].map((p) => {
                const count = p === "all" ? visibleTargets.length : targets.filter((t) => t.comment && t.priority === p).length;
                const ps = p !== "all" ? PRIORITY_STYLE[p] : null;
                return (
                  <button key={p} onClick={() => setPriorityFilter(p)} style={{
                    background: priorityFilter === p ? (ps ? ps.bg : "rgba(255,107,53,0.15)") : "rgba(255,255,255,0.03)",
                    border: `1px solid ${priorityFilter === p ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.07)"}`,
                    borderRadius: "10px", padding: "5px 12px", fontSize: "12px", fontWeight: 700,
                    color: priorityFilter === p ? (ps ? ps.color : "#ff6b35") : "rgba(240,239,232,0.5)",
                    cursor: "pointer", transition: "all 0.2s",
                  }}>
                    {p === "all" ? `全て (${count})` : `${p} (${count})`}
                  </button>
                );
              })}
              <span style={{ color: "rgba(255,255,255,0.1)", margin: "0 4px" }}>|</span>
              {/* Platform filter */}
              {uniquePlatforms.slice(0, 6).map((p) => {
                const pi = PLATFORM_ICONS[p] || { icon: "?", color: "#888" };
                return (
                  <button key={p} onClick={() => setPlatformFilter(platformFilter === p ? "all" : p)} style={{
                    background: platformFilter === p ? `${pi.color}15` : "transparent",
                    border: `1px solid ${platformFilter === p ? `${pi.color}40` : "rgba(255,255,255,0.05)"}`,
                    borderRadius: "8px", padding: "4px 10px", fontSize: "11px", fontWeight: 600,
                    color: platformFilter === p ? pi.color : "rgba(240,239,232,0.35)", cursor: "pointer",
                  }}>
                    {pi.icon}
                  </button>
                );
              })}
            </div>

            {/* Action bar */}
            <div style={{ display: "flex", gap: "8px", marginBottom: "16px", alignItems: "center" }}>
              <button onClick={selectAll} style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", padding: "6px 14px", fontSize: "12px", fontWeight: 600, color: "rgba(240,239,232,0.5)", cursor: "pointer" }}>
                全選択
              </button>
              <button onClick={selectSA} style={{ background: "rgba(255,214,0,0.08)", border: "1px solid rgba(255,214,0,0.2)", borderRadius: "8px", padding: "6px 14px", fontSize: "12px", fontWeight: 600, color: "#ffd60a", cursor: "pointer" }}>
                S+Aのみ選択
              </button>
              <button onClick={() => setSelected(new Set())} style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "8px", padding: "6px 14px", fontSize: "12px", fontWeight: 600, color: "rgba(240,239,232,0.3)", cursor: "pointer" }}>
                選択解除
              </button>
              <span style={{ marginLeft: "auto", fontSize: "12px", color: "rgba(240,239,232,0.4)" }}>
                {selectedCount > 0 ? `${selectedCount}件選択中` : `${visibleTargets.length}件表示`}
              </span>
            </div>

            {/* Target rows */}
            {visibleTargets.length === 0 ? (
              <div style={{ background: "#13132a", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "16px", padding: "40px 20px", textAlign: "center" }}>
                <div style={{ fontSize: "32px", marginBottom: "12px" }}>{targets.length === 0 ? "🔍" : "✍️"}</div>
                <div style={{ fontSize: "14px", color: "rgba(240,239,232,0.5)" }}>{targets.length === 0 ? "ターゲットを発見中..." : "AI分析中..."}</div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {visibleTargets.map((t) => {
                  const pi = PLATFORM_ICONS[t.platform] || { icon: "?", color: "#888" };
                  const ps = PRIORITY_STYLE[t.priority || "C"] || PRIORITY_STYLE.C;
                  const isSelected = selected.has(t.id);
                  const isExpanded = expanded.has(t.id);
                  return (
                    <div key={t.id} onClick={() => toggleExpand(t.id)} style={{
                      background: isSelected ? "rgba(255,214,0,0.04)" : "#13132a",
                      border: `1px solid ${isSelected ? "rgba(255,214,0,0.15)" : "rgba(255,255,255,0.07)"}`,
                      borderRadius: "12px", padding: "14px 18px", cursor: "pointer", transition: "all 0.15s",
                    }}>
                      {/* Row 1: priority + platform + user + score + age + role + checkbox */}
                      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        {/* Checkbox */}
                        <div onClick={(e) => { e.stopPropagation(); toggleSelect(t.id); }} style={{
                          width: "18px", height: "18px", borderRadius: "5px", flexShrink: 0,
                          border: `2px solid ${isSelected ? "#ffd60a" : "rgba(255,255,255,0.15)"}`,
                          background: isSelected ? "#ffd60a" : "transparent", display: "flex", alignItems: "center", justifyContent: "center",
                          cursor: "pointer", transition: "all 0.15s",
                        }}>
                          {isSelected && <span style={{ fontSize: "11px", color: "#000", fontWeight: 900 }}>✓</span>}
                        </div>

                        {/* Priority badge */}
                        <span style={{
                          background: ps.bg, color: ps.color, fontSize: "11px", fontWeight: 900,
                          width: "24px", height: "24px", borderRadius: "6px", display: "flex", alignItems: "center",
                          justifyContent: "center", flexShrink: 0,
                        }}>{ps.label}</span>

                        {/* Platform icon */}
                        <span style={{ fontSize: "14px", fontWeight: 700, color: pi.color, flexShrink: 0 }}>{pi.icon}</span>

                        {/* Username */}
                        <span style={{ fontSize: "13px", fontWeight: 600, color: "#f0efe8" }}>@{t.username}</span>

                        {/* Score */}
                        <span style={{ fontSize: "11px", padding: "2px 8px", borderRadius: "6px", background: `${pi.color}12`, color: pi.color, fontWeight: 600 }}>
                          {t.match_score}%
                        </span>

                        {/* Age + Role */}
                        {t.estimated_role && (
                          <span style={{ fontSize: "11px", color: "rgba(240,239,232,0.35)" }}>
                            {t.estimated_age || ""} {t.estimated_role}
                          </span>
                        )}

                        {/* Email badge */}
                        {t.email && <span style={{ fontSize: "10px", color: "#2dd17a" }}>✉️</span>}

                        {/* Expand indicator */}
                        <span style={{ marginLeft: "auto", fontSize: "10px", color: "rgba(240,239,232,0.2)", transition: "transform 0.2s", transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)" }}>▼</span>
                      </div>

                      {/* Row 2: AI reason */}
                      {t.ai_reason && (
                        <div style={{ fontSize: "12px", color: "rgba(240,239,232,0.4)", marginTop: "6px", marginLeft: "52px" }}>
                          {t.ai_reason}
                        </div>
                      )}

                      {/* Expanded content */}
                      {isExpanded && (
                        <div style={{ marginTop: "12px", marginLeft: "52px", display: "flex", flexDirection: "column", gap: "8px" }}>
                          {t.post_content && (
                            <div style={{ fontSize: "12px", color: "rgba(240,239,232,0.35)", fontStyle: "italic", lineHeight: 1.5, background: "rgba(255,255,255,0.02)", borderRadius: "8px", padding: "10px" }}>
                              &quot;{t.post_content.slice(0, 200)}{t.post_content.length > 200 ? "..." : ""}&quot;
                            </div>
                          )}
                          {t.comment && (
                            <div style={{ fontSize: "12px", color: "rgba(240,239,232,0.7)", lineHeight: 1.6, background: "rgba(255,214,10,0.04)", border: "1px solid rgba(255,214,10,0.08)", borderRadius: "8px", padding: "10px" }}>
                              💬 {t.comment.content}
                            </div>
                          )}
                          {t.post_url && (
                            <a href={t.post_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: "11px", color: "rgba(240,239,232,0.25)", textDecoration: "none" }}>
                              🔗 {t.post_url.slice(0, 60)}...
                            </a>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right - Live log */}
          <div>
            <div style={{ height: "500px", position: "sticky", top: "24px" }}>
              <DashboardLiveLog logs={logs} platforms={(campaign?.platforms as string[]) || []} campaignCreatedAt={campaign?.created_at as string} hasData={hasData} />
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
