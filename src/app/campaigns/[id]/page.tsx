"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
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
  wantedly: { icon: "🤝", color: "#21bddb" }, connpass: { icon: "🎪", color: "#e05048" },
  producthunt: { icon: "🚀", color: "#da552f" }, peatix: { icon: "🎟️", color: "#f54b5e" },
  discord: { icon: "💬", color: "#5865f2" }, google_maps: { icon: "🗺️", color: "#4285f4" },
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
  relevance_score: number | null; intent_score: number | null;
  influence_score: number | null; accessibility_score: number | null;
  comment?: { id: string; content: string; approach: string | null };
};

export default function CampaignDetailPage() {
  const params = useParams();
  const router = useRouter();
  // Normalize: params.id can be string | string[] in Next.js
  const campaignId = Array.isArray(params.id) ? params.id[0] : (params.id as string);
  const realtimeLogs = useRealtimeLog(campaignId);
  const [initialLogs, setInitialLogs] = useState<LogEntry[]>([]);

  const [campaign, setCampaign] = useState<Record<string, unknown> | null>(null);
  const [targets, setTargets] = useState<TargetRow[]>([]);
  const [exportedCount, setExportedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState("");
  const [exporting, setExporting] = useState(false);
  const [platformFilter, setPlatformFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [minScore, setMinScore] = useState(50);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [generatingIds, setGeneratingIds] = useState<Set<string>>(new Set());
  const [bulkGenerating, setBulkGenerating] = useState(false);
  const [draftingIds, setDraftingIds] = useState<Set<string>>(new Set());

  // Reset ALL state when campaignId changes (prevents stale data from previous campaign)
  useEffect(() => {
    setCampaign(null);
    setTargets([]);
    setInitialLogs([]);
    setExportedCount(0);
    setLoading(true);
    setSelected(new Set());
    setExpanded(new Set());
    setPlatformFilter("all");
    setPriorityFilter("all");
  }, [campaignId]);

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
      // Only show scored targets in logs (skip pending/unscored)
      if (!t.priority) return;
      const ts = new Date(t.created_at).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      entries.push({ log: { id: `log-t-${t.id}`, icon: "🔍", text: `${t.platform}で発見: @${t.username} (${t.priority}ランク ${t.match_score}%)`, color: "#ff6b35", timestamp: ts, type: "find" }, time: t.created_at });
      entries.push({ log: { id: `log-s-${t.id}`, icon: "🧠", text: `AI分析: @${t.username} → ${t.priority}ランク`, color: "#7c5cfc", timestamp: ts, type: "score" }, time: t.created_at });
    });
    entries.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
    return entries.slice(0, 20).map((e) => e.log);
  }, []);

  // Stable ref for router (prevents fetchData from changing on every render)
  const routerRef = useRef(router);
  routerRef.current = router;

  const fetchData = useCallback(async () => {
    const supabase = createClient();

    // Parallel DB queries
    const [campResult, tgtsResult] = await Promise.all([
      supabase.from("campaigns").select("*").eq("id", campaignId).single(),
      supabase.from("targets").select("*, comments(*)").eq("campaign_id", campaignId).order("match_score", { ascending: false }).limit(50),
    ]);

    if (!campResult.data) { routerRef.current.push("/dashboard"); return; }
    setCampaign(campResult.data);
    // Set minimum score filter from campaign settings (cap at 50 for initial display)
    const campaignMinScore = (campResult.data as Record<string, unknown>).min_match_score as number;
    if (campaignMinScore && campaignMinScore > 0) {
      setMinScore(Math.min(campaignMinScore, 50));
    }

    const enriched: TargetRow[] = (tgtsResult.data || []).map((t: Record<string, unknown>) => {
      const comments = (t.comments as Array<Record<string, unknown>>) || [];
      const comment = comments[0];
      return {
        id: t.id as string, platform: t.platform as string, username: t.username as string,
        post_url: t.post_url as string | null, post_content: t.post_content as string | null,
        match_score: t.match_score as number, match_reason: t.match_reason as string | null,
        email: t.email as string | null, priority: t.priority as string | null,
        ai_reason: t.ai_reason as string | null, estimated_age: t.estimated_age as string | null,
        estimated_role: t.estimated_role as string | null,
        relevance_score: t.relevance_score as number | null,
        intent_score: t.intent_score as number | null,
        influence_score: t.influence_score as number | null,
        accessibility_score: t.accessibility_score as number | null,
        comment: comment ? { id: comment.id as string, content: comment.content as string, approach: comment.approach as string | null } : undefined,
      };
    });
    setTargets(enriched);



    // Build logs from same data (no extra queries)
    const logTargets = enriched.map(t => ({ id: t.id, platform: t.platform, username: t.username, match_score: t.match_score, created_at: (tgtsResult.data?.find((d: any) => d.id === t.id) as any)?.created_at || "", priority: t.priority || undefined }));
    const logComments = enriched.filter(t => t.comment).map(t => ({ id: t.comment!.id, platform: t.platform, created_at: (tgtsResult.data?.find((d: any) => d.id === t.id)?.comments as any)?.[0]?.created_at || "" }));
    const builtLogs = buildLogsFromData(logTargets, logComments);
    setInitialLogs([...builtLogs]);
    setLoading(false);
  }, [campaignId, buildLogsFromData]);

  // Single effect: initial fetch + polling interval
  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const logs = [...realtimeLogs, ...initialLogs.filter((il) => !realtimeLogs.some((rl) => rl.text === il.text))].slice(0, 20);
  const hasData = targets.length > 0 || initialLogs.length > 0;

  const handleExport = async () => {
    setExporting(true);
    try {
      // If user has selected specific targets, only export those
      const selectedIds = [...selected].filter((id) => visibleTargets.some((t) => t.id === id));
      const url = selectedIds.length > 0
        ? `/api/campaigns/${campaignId}/export?ids=${selectedIds.join(",")}`
        : `/api/campaigns/${campaignId}/export`;
      const res = await fetch(url);
      if (!res.ok) { alert("エクスポートに失敗しました"); setExporting(false); return; }
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = blobUrl; a.download = `spark_targets_${campaignId.slice(0, 8)}.xlsx`; a.click();
      URL.revokeObjectURL(blobUrl);
      setExportedCount(visibleTargets.filter(t => t.comment).length);
      setToast(`✅ エクスポート完了！${selectedIds.length > 0 ? ` (${selectedIds.length}件)` : ""}`); setTimeout(() => setToast(""), 3000);
    } catch { alert("エクスポートに失敗しました"); }
    setExporting(false);
  };
  const handleGenerateComment = async (targetId: string) => {
    setGeneratingIds((prev) => { const n = new Set(prev); n.add(targetId); return n; });
    try {
      const res = await fetch(`/api/targets/${targetId}/generate-comment`, { method: "POST" });
      if (!res.ok) { setToast("❌ コメント生成に失敗"); setTimeout(() => setToast(""), 3000); return; }
      const data = await res.json();
      setTargets((prev) => prev.map((t) => t.id === targetId ? { ...t, comment: { id: data.comment.id, content: data.comment.content, approach: data.comment.approach } } : t));
      setExpanded((prev) => { const n = new Set(prev); n.add(targetId); return n; });
    } catch { setToast("❌ エラーが発生しました"); setTimeout(() => setToast(""), 3000); }
    setGeneratingIds((prev) => { const n = new Set(prev); n.delete(targetId); return n; });
  };

  const handleBulkGenerate = async () => {
    const withoutComment = visibleTargets.filter((t) => !t.comment);
    if (withoutComment.length === 0) { setToast("全ターゲットにコメント済み"); setTimeout(() => setToast(""), 2000); return; }
    setBulkGenerating(true);
    for (const t of withoutComment.slice(0, 20)) {
      await handleGenerateComment(t.id);
    }
    setBulkGenerating(false);
    setToast(`✅ ${Math.min(withoutComment.length, 20)}件のコメントを生成しました`);
    setTimeout(() => setToast(""), 3000);
  };

  const handleDraftEmail = async (targetId: string) => {
    setDraftingIds((prev) => { const n = new Set(prev); n.add(targetId); return n; });
    try {
      const res = await fetch(`/api/targets/${targetId}/draft-email`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json();
        setToast(`❌ ${err.error || "メール下書き作成に失敗"}`); setTimeout(() => setToast(""), 3000);
        return;
      }
      const data = await res.json();
      window.open(data.draft_url, "_blank");
      setToast(`✅ Gmail下書きを開きました (${data.email_to})`); setTimeout(() => setToast(""), 4000);
    } catch {
      setToast("❌ エラーが発生しました"); setTimeout(() => setToast(""), 3000);
    }
    setDraftingIds((prev) => { const n = new Set(prev); n.delete(targetId); return n; });
  };

  const st = STATUS_MAP[campaign?.status as string] || STATUS_MAP.running;
  const uniquePlatforms = [...new Set(targets.map((t) => t.platform))];

  const visibleTargets = useMemo(() => targets
    .filter((t) => platformFilter === "all" || t.platform === platformFilter)
    .filter((t) => priorityFilter === "all" || t.priority === priorityFilter)
    .filter((t) => (t.match_score ?? 0) >= minScore),
    [targets, platformFilter, priorityFilter, minScore]);

  const funnel = useMemo(() => ({
    discovered: visibleTargets.length,
    generated: visibleTargets.filter((t) => t.comment).length,
    exported: exportedCount,
  }), [visibleTargets, exportedCount]);

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
                const baseFiltered = targets
                  .filter((t) => platformFilter === "all" || t.platform === platformFilter)
                  .filter((t) => (t.match_score || 0) >= minScore);
                const count = p === "all" ? baseFiltered.length : baseFiltered.filter((t) => t.priority === p).length;
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
              <span style={{ color: "rgba(255,255,255,0.1)", margin: "0 4px" }}>|</span>
              {/* Minimum score filter */}
              <select
                value={minScore}
                onChange={(e) => setMinScore(Number(e.target.value))}
                style={{
                  background: minScore > 0 ? "rgba(255,107,53,0.12)" : "rgba(255,255,255,0.03)",
                  border: `1px solid ${minScore > 0 ? "rgba(255,107,53,0.3)" : "rgba(255,255,255,0.07)"}`,
                  borderRadius: "8px", padding: "4px 8px", fontSize: "11px", fontWeight: 600,
                  color: minScore > 0 ? "#ff6b35" : "rgba(240,239,232,0.5)",
                  cursor: "pointer", outline: "none",
                }}
              >
                <option value={0}>最低スコア: なし</option>
                <option value={30}>≥ 30%</option>
                <option value={50}>≥ 50%</option>
                <option value={70}>≥ 70%</option>
                <option value={90}>≥ 90%</option>
              </select>
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
              <button onClick={handleBulkGenerate} disabled={bulkGenerating} style={{ background: "rgba(124,92,252,0.1)", border: "1px solid rgba(124,92,252,0.25)", borderRadius: "8px", padding: "6px 14px", fontSize: "12px", fontWeight: 600, color: "#7c5cfc", cursor: bulkGenerating ? "wait" : "pointer", opacity: bulkGenerating ? 0.6 : 1 }}>
                {bulkGenerating ? "⏳ 生成中..." : "💬 一括コメント生成"}
              </button>
              <span style={{ marginLeft: "auto", fontSize: "12px", color: "rgba(240,239,232,0.4)" }}>
                {selectedCount > 0 ? `${selectedCount}件選択中` : `${visibleTargets.length}件表示`}
              </span>
            </div>

            {/* Target rows */}
            {visibleTargets.length === 0 ? (
              <div style={{ background: "#13132a", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "16px", padding: "40px 20px", textAlign: "center" }}>
                {targets.length === 0 ? (
                  <>
                    <div style={{ fontSize: "32px", marginBottom: "12px" }}>
                      {(campaign?.status === "completed" || campaign?.status === "paused") ? "📭" : "🔍"}
                    </div>
                    <div style={{ fontSize: "14px", color: "rgba(240,239,232,0.5)", marginBottom: "8px" }}>
                      {(campaign?.status === "completed" || campaign?.status === "paused")
                        ? "ターゲットが見つかりませんでした"
                        : "ターゲットを発見中..."}
                    </div>
                    {(campaign?.status === "completed" || campaign?.status === "paused") && (
                      <div style={{ fontSize: "12px", color: "rgba(240,239,232,0.3)" }}>
                        検索キーワードを変えて新しいキャンペーンを作成してください
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div style={{ fontSize: "32px", marginBottom: "12px" }}>✍️</div>
                    <div style={{ fontSize: "14px", color: "rgba(240,239,232,0.5)" }}>フィルターに一致するターゲットがありません</div>
                  </>
                )}
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

                      {/* Row 2: AI reason / match reason — always show */}
                      <div style={{ fontSize: "12px", color: "rgba(240,239,232,0.4)", marginTop: "6px", marginLeft: "52px" }}>
                        💡 {t.ai_reason || t.match_reason || t.comment?.approach || "分析中..."}
                      </div>

                      {/* Comment generation / display */}
                      {!t.comment ? (
                        <div style={{ marginTop: "8px", marginLeft: "52px" }}>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleGenerateComment(t.id); }}
                            disabled={generatingIds.has(t.id)}
                            style={{
                              background: generatingIds.has(t.id) ? "rgba(124,92,252,0.05)" : "rgba(124,92,252,0.1)",
                              border: "1px solid rgba(124,92,252,0.2)", borderRadius: "8px",
                              padding: "5px 12px", fontSize: "11px", fontWeight: 600,
                              color: "#7c5cfc", cursor: generatingIds.has(t.id) ? "wait" : "pointer",
                              transition: "all 0.15s",
                            }}
                          >
                            {generatingIds.has(t.id) ? "⏳ 生成中..." : "💬 参考コメント生成"}
                          </button>
                        </div>
                      ) : (
                        <div style={{ marginTop: "8px", marginLeft: "52px" }}>
                          <div style={{ display: "flex", alignItems: "flex-start", gap: "8px", fontSize: "12px", color: "rgba(240,239,232,0.7)", lineHeight: 1.6, background: "rgba(255,214,10,0.04)", border: "1px solid rgba(255,214,10,0.08)", borderRadius: "8px", padding: "10px" }}>
                            <span style={{ flex: 1 }}>💬 {t.comment.content}</span>
                            <button
                              onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(t.comment!.content); setToast("📋 コピーしました"); setTimeout(() => setToast(""), 2000); }}
                              style={{ flexShrink: 0, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "6px", padding: "3px 8px", fontSize: "10px", fontWeight: 600, color: "rgba(240,239,232,0.5)", cursor: "pointer" }}
                            >
                              📋 コピー
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Email draft button — show for targets with real email */}
                      {t.email && !t.email.startsWith("Twitter:") && (
                        <div style={{ marginTop: "6px", marginLeft: "52px" }}>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDraftEmail(t.id); }}
                            disabled={draftingIds.has(t.id)}
                            style={{
                              background: draftingIds.has(t.id) ? "rgba(45,209,122,0.05)" : "rgba(45,209,122,0.1)",
                              border: "1px solid rgba(45,209,122,0.2)", borderRadius: "8px",
                              padding: "5px 12px", fontSize: "11px", fontWeight: 600,
                              color: "#2dd17a", cursor: draftingIds.has(t.id) ? "wait" : "pointer",
                              transition: "all 0.15s",
                            }}
                          >
                            {draftingIds.has(t.id) ? "⏳ 下書き作成中..." : `📧 メール下書き作成 (${t.email})`}
                          </button>
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
                          {/* Sub-scores — always show */}
                          {t.relevance_score != null ? (
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px", background: "rgba(255,255,255,0.02)", borderRadius: "8px", padding: "10px" }}>
                              {[
                                { label: "課題一致", score: t.relevance_score, color: "#ff6b35" },
                                { label: "行動意欲", score: t.intent_score, color: "#2dd17a" },
                                { label: "影響力", score: t.influence_score, color: "#1d9bf0" },
                                { label: "接触性", score: t.accessibility_score, color: "#ffd60a" },
                              ].map((s) => (
                                <div key={s.label} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                  <span style={{ fontSize: "10px", color: "rgba(240,239,232,0.35)", width: "48px", flexShrink: 0 }}>{s.label}</span>
                                  <div style={{ flex: 1, height: "4px", background: "rgba(255,255,255,0.05)", borderRadius: "2px", overflow: "hidden" }}>
                                    <div style={{ width: `${((s.score || 0) / 25) * 100}%`, height: "100%", background: s.color, borderRadius: "2px" }} />
                                  </div>
                                  <span style={{ fontSize: "10px", color: s.color, fontWeight: 700, width: "20px", textAlign: "right" }}>{s.score || 0}</span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div style={{ fontSize: "11px", color: "rgba(240,239,232,0.25)", fontStyle: "italic", padding: "8px 10px", background: "rgba(255,255,255,0.02)", borderRadius: "8px" }}>
                              🧠 スコア計算中...
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
