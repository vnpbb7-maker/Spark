"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useRealtimeLog, LogEntry } from "@/hooks/useRealtimeLog";


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
  email: string | null; twitter_handle: string | null; priority: string | null; ai_reason: string | null;
  estimated_age: string | null; estimated_role: string | null;
  relevance_score: number | null; intent_score: number | null;
  influence_score: number | null; accessibility_score: number | null;
  q1_score: number | null; q2_score: number | null; q3_score: number | null;
  contact_url: string | null; website: string | null;
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
  const [minScore, setMinScore] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [generatingIds, setGeneratingIds] = useState<Set<string>>(new Set());
  const [bulkGenerating, setBulkGenerating] = useState(false);
  const [draftingIds, setDraftingIds] = useState<Set<string>>(new Set());
  const [submittingFormIds, setSubmittingFormIds] = useState<Set<string>>(new Set());
  const [contactFilter, setContactFilter] = useState(false);
  const [showLiveLog, setShowLiveLog] = useState(false);
  // Form submission preview modal
  const [formModal, setFormModal] = useState<{ targetId: string; websiteUrl: string; message: string; senderName: string; senderEmail: string } | null>(null);
  const [formModalMsg, setFormModalMsg] = useState("");
  const [formSubmitting, setFormSubmitting] = useState(false);
  // Bulk send modal
  const [bulkModal, setBulkModal] = useState<{
    targets: { id: string; username: string; method: "form" | "gmail" }[];
    senderName: string; senderEmail: string;
  } | null>(null);
  const [bulkProgress, setBulkProgress] = useState<{
    done: number; total: number;
    results: { username: string; status: "sent" | "failed" | "gmail"; gmailUrl?: string; error?: string }[];
    running: boolean; finished: boolean;
  } | null>(null);
  const minScoreInitRef = useRef(false);

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
    minScoreInitRef.current = false;
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
    try {
      // Use API route (service role) to bypass RLS
      const res = await fetch(`/api/campaigns/${campaignId}/targets`, { credentials: "include" });
      if (res.status === 404) { routerRef.current.push("/dashboard"); return; }
      if (!res.ok) { setLoading(false); return; }

      const data = await res.json();
      const campData = data.campaign;
      const tgtsData: Record<string, unknown>[] = data.targets || [];

      setCampaign(campData);

      // Always start with minScore=0 (show all targets) — user applies filter manually
      minScoreInitRef.current = true;

      const enriched: TargetRow[] = tgtsData.map((t) => ({
        id: t.id as string, platform: t.platform as string, username: t.username as string,
        contact_url: t.contact_url as string | null, website: t.website as string | null,
        post_url: t.post_url as string | null, post_content: t.post_content as string | null,
        match_score: Number(t.match_score) || 0, match_reason: t.match_reason as string | null,
        email: t.email as string | null, twitter_handle: t.twitter_handle as string | null,
        priority: t.priority as string | null,
        ai_reason: t.ai_reason as string | null, estimated_age: t.estimated_age as string | null,
        estimated_role: t.estimated_role as string | null,
        relevance_score: t.relevance_score as number | null,
        intent_score: t.intent_score as number | null,
        influence_score: t.influence_score as number | null,
        accessibility_score: t.accessibility_score as number | null,
        q1_score: t.q1_score as number | null,
        q2_score: t.q2_score as number | null,
        q3_score: t.q3_score as number | null,
        comment: undefined, // populated below by merging existing state
      }));
      // Preserve in-memory generated comments (don't wipe them on polling re-fetch)
      setTargets((prev) => {
        const prevMap = new Map(prev.map((t) => [t.id, t]));
        return enriched.map((t) => ({
          ...t,
          comment: t.comment ?? prevMap.get(t.id)?.comment,
        }));
      });

      // Build logs from fetched data
      const logTargets = tgtsData.map(t => ({
        id: t.id as string, platform: t.platform as string, username: t.username as string,
        match_score: Number(t.match_score) || 0,
        created_at: (t.created_at as string) || "",
        priority: (t.priority as string) || undefined,
      }));
      const builtLogs = buildLogsFromData(logTargets, []);
      setInitialLogs([...builtLogs]);
    } catch (err) {
      console.error("[campaign page] fetchData error:", err);
    }
    setLoading(false);
  }, [campaignId, buildLogsFromData]);

  // Polling: stop when campaign is done or after 10min timeout
  useEffect(() => {
    let stopped = false;
    const startTime = Date.now();
    const MAX_POLL_MS = 10 * 60 * 1000; // 10 minutes

    const poll = async () => {
      if (stopped) return;
      await fetchData();
      // Stop polling if campaign finished or timed out
      const status = (campaign as Record<string, unknown> | null)?.status as string;
      if (status === "completed" || status === "paused") { stopped = true; return; }
      if (Date.now() - startTime > MAX_POLL_MS) { stopped = true; return; }
    };

    poll();
    const interval = setInterval(poll, 10000);
    return () => { stopped = true; clearInterval(interval); };
  }, [fetchData]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const handleDraftEmail = async (target: TargetRow) => {
    setDraftingIds((prev) => { const n = new Set(prev); n.add(target.id); return n; });
    // Build Gmail compose URL directly with generated comment as body
    const comment = target.comment?.content || "";
    const campaignTitle = (campaign?.product_url as string || campaign?.product_description as string || "SPARK").slice(0, 40);
    const subject = encodeURIComponent(`【ご提案】${campaignTitle}`);
    const body = encodeURIComponent(comment || "");
    const gmailUrl = `https://mail.google.com/mail/?view=cm&to=${encodeURIComponent(target.email || "")}&su=${subject}&body=${body}`;
    window.open(gmailUrl, "_blank");
    setDraftingIds((prev) => { const n = new Set(prev); n.delete(target.id); return n; });
  };

  const handleSubmitForm = async (target: TargetRow) => {
    const senderName = typeof window !== "undefined" ? localStorage.getItem("spark_sender_name") || "" : "";
    const senderEmail = typeof window !== "undefined" ? localStorage.getItem("spark_sender_email") || "" : "";
    if (!senderEmail) {
      setToast("⚠️ 設定ページで送信者メールアドレスを登録してください");
      setTimeout(() => setToast(""), 4000);
      return;
    }
    const websiteUrl = target.contact_url || target.website || "";
    if (!websiteUrl) { setToast("⚠️ ウェブサイトURLが見つかりません"); setTimeout(() => setToast(""), 3000); return; }
    // Show modal: first generate the message via Claude
    setSubmittingFormIds((prev) => { const n = new Set(prev); n.add(target.id); return n; });
    setFormModal(null);
    try {
      const res = await fetch(`/api/targets/${target.id}/submit-form`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sender_name: senderName, sender_email: senderEmail, preview_only: true }),
      });
      const data = await res.json();
      const generatedMsg = data.generatedMessage || "";
      setFormModalMsg(generatedMsg);
      setFormModal({ targetId: target.id, websiteUrl, message: generatedMsg, senderName, senderEmail });
    } catch { setToast("❌ メッセージ生成に失敗しました"); }
    setSubmittingFormIds((prev) => { const n = new Set(prev); n.delete(target.id); return n; });
  };

  const handleConfirmSubmit = async () => {
    if (!formModal) return;
    setFormSubmitting(true);
    try {
      const res = await fetch(`/api/targets/${formModal.targetId}/submit-form`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sender_name: formModal.senderName, sender_email: formModal.senderEmail, override_message: formModalMsg }),
      });
      const data = await res.json();
      setFormModal(null);
      if (data.success || data.submitted) {
        setToast("✅ フォーム送信完了！");
      } else {
        setToast(`❌ ${data.error || "フォーム送信に失敗"}`);
      }
    } catch { setToast("❌ エラーが発生しました"); setFormModal(null); }
    setFormSubmitting(false);
    setTimeout(() => setToast(""), 4000);
  };

  // Open bulk send confirmation modal
  const handleBulkSubmit = () => {
    const senderName = typeof window !== "undefined" ? localStorage.getItem("spark_sender_name") || "" : "";
    const senderEmail = typeof window !== "undefined" ? localStorage.getItem("spark_sender_email") || "" : "";
    if (!senderEmail) { setToast("⚠️ 設定ページで送信者メールを登録してください"); setTimeout(() => setToast(""), 4000); return; }
    // Collect targets: selected if any, else all visible — that have website or email
    const base = selectedCount > 0
      ? visibleTargets.filter(t => selected.has(t.id))
      : visibleTargets;
    const eligible = base.filter(t => (t.contact_url || t.website) || (t.email && !t.email.startsWith("DM:")));
    if (!eligible.length) { setToast("⚠️ 送信可能なターゲットがありません"); setTimeout(() => setToast(""), 3000); return; }
    const mapped = eligible.map(t => ({
      id: t.id, username: t.username,
      method: (t.email && !t.email.startsWith("Twitter:") && !t.email.startsWith("DM:")) ? "gmail" as const : "form" as const,
    }));
    setBulkModal({ targets: mapped, senderName, senderEmail });
    setBulkProgress(null);
  };

  // Execute bulk send — calls API sequentially in batches
  const handleBulkStart = async () => {
    if (!bulkModal) return;
    setBulkProgress({ done: 0, total: bulkModal.targets.length, results: [], running: true, finished: false });
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/bulk-submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetIds: bulkModal.targets.map(t => t.id),
          senderName: bulkModal.senderName,
          senderEmail: bulkModal.senderEmail,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setToast(`❌ ${data.error || "一括送信に失敗しました"}`); setBulkProgress(null); return; }
      const results = (data.results || []).map((r: { username: string; status: string; gmailUrl?: string; error?: string }) => ({
        username: r.username, status: r.status as "sent" | "failed" | "gmail", gmailUrl: r.gmailUrl, error: r.error,
      }));
      setBulkProgress({ done: data.sent + data.failed, total: bulkModal.targets.length, results, running: false, finished: true });
    } catch (e) {
      setToast("❌ エラーが発生しました"); setBulkProgress(null);
    }
  };

  const st = STATUS_MAP[campaign?.status as string] || STATUS_MAP.running;
  const uniquePlatforms = [...new Set(targets.map((t) => t.platform))];

  const visibleTargets = useMemo(() => targets
    .filter((t) => platformFilter === "all" || t.platform === platformFilter)
    .filter((t) => priorityFilter === "all" || t.priority === priorityFilter)
    .filter((t) => {
      const score = Number(t.match_score) || 0;
      return minScore <= 0 || score >= minScore;
    })
    .filter((t) => !contactFilter || t.email || t.twitter_handle),
    [targets, platformFilter, priorityFilter, minScore, contactFilter]);

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
      <div style={{ borderBottom: "1px solid rgba(255,255,255,0.07)", padding: "14px 24px" }}>
        <div style={{ maxWidth: "1200px", margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
            <a href="/dashboard" style={{ color: "rgba(240,239,232,0.4)", textDecoration: "none", fontSize: "13px" }}>← ダッシュボード</a>
            <span style={{ color: "rgba(255,255,255,0.1)" }}>|</span>
            <h1 style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: "17px", margin: 0 }}>{(campaign?.product_description as string || "").slice(0, 30)}</h1>
            <span style={{ fontSize: "11px", padding: "3px 10px", borderRadius: "8px", background: `${st.color}18`, color: st.color, fontWeight: 600 }}>{st.icon} {st.label}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            {(() => {
              const SNS_DM = ["reddit","twitter","wantedly"];
              const selectedTargets = visibleTargets.filter(t => selected.has(t.id));
              const contactable = selectedTargets.filter(t => {
                const hasEmail = t.email && !t.email.startsWith("Twitter:") && !t.email.startsWith("DM:");
                const hasDm = SNS_DM.includes(t.platform);
                return hasEmail || hasDm;
              });
              const canSend = selectedCount > 0 && contactable.length > 0;
              const tooltip = selectedCount === 0 ? "ターゲットを選択してください" : contactable.length === 0 ? "選択中のターゲットに連絡手段がありません" : "";
              return (
                <a
                  href={canSend ? `/campaigns/${campaignId}/outreach?ids=${[...selected].join(",")}` : undefined}
                  onClick={!canSend ? (e) => e.preventDefault() : undefined}
                  title={tooltip}
                  style={{
                    background: canSend ? "linear-gradient(135deg, #7c5cfc, #5a3fd6)" : "rgba(255,255,255,0.06)",
                    color: canSend ? "#fff" : "rgba(240,239,232,0.25)",
                    border: "none", borderRadius: "10px",
                    padding: "8px 18px", fontSize: "12px", fontWeight: 700, textDecoration: "none",
                    fontFamily: "'Space Grotesk'",
                    boxShadow: canSend ? "0 4px 16px rgba(124,92,252,0.3)" : "none",
                    display: "flex", alignItems: "center", gap: "6px",
                    cursor: canSend ? "pointer" : "not-allowed", pointerEvents: "auto",
                  }}
                >
                  📨 送信する{selectedCount > 0 ? ` (${contactable.length}件)` : ""}
                </a>
              );
            })()}
            <button onClick={() => setShowLiveLog(!showLiveLog)} style={{ background: showLiveLog ? "rgba(124,92,252,0.15)" : "rgba(255,255,255,0.04)", border: `1px solid ${showLiveLog ? "rgba(124,92,252,0.3)" : "rgba(255,255,255,0.08)"}`, borderRadius: "10px", padding: "7px 12px", fontSize: "14px", cursor: "pointer", color: showLiveLog ? "#7c5cfc" : "rgba(240,239,232,0.4)" }}>
              🔔
            </button>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "20px 24px" }}>
        {/* Stats row - 4 metric cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px", marginBottom: "20px" }}>
          {[
            { label: "発見済み", value: targets.length, icon: "🔍", color: "#ff6b35" },
            { label: "S+Aランク", value: targets.filter(t => t.priority === "S" || t.priority === "A").length, icon: "⭐", color: "#ffd60a" },
            { label: "選択中", value: selectedCount, icon: "☑️", color: "#7c5cfc" },
            { label: "連絡先あり", value: targets.filter(t => {
              const snsPlatforms = ["reddit","twitter","wantedly"];
              return t.email || snsPlatforms.includes(t.platform);
            }).length, icon: "📧", color: "#2dd17a" },
          ].map((s) => (
            <div key={s.label} style={{ background: "#13132a", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "14px", padding: "16px 18px" }}>
              <div style={{ fontSize: "11px", color: "rgba(240,239,232,0.4)", marginBottom: "6px", fontWeight: 500 }}>{s.icon} {s.label}</div>
              <div style={{ fontSize: "26px", fontWeight: 800, fontFamily: "'Space Grotesk', sans-serif", color: s.color }}>{s.value}</div>
            </div>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "200px 1fr", gap: "20px" }}>
          {/* Left sidebar */}
          <div style={{ position: "sticky", top: "20px", alignSelf: "start", display: "flex", flexDirection: "column", gap: "20px" }}>
            {/* Priority filter */}
            <div>
              <div style={{ fontSize: "10px", fontWeight: 600, color: "rgba(240,239,232,0.3)", textTransform: "uppercase", letterSpacing: "1px", marginBottom: "8px" }}>優先度</div>
              <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                {["all", "S", "A", "B", "C"].map((p) => {
                  const count = p === "all" ? targets.length : targets.filter((t) => t.priority === p).length;
                  const ps = p !== "all" ? PRIORITY_STYLE[p] : null;
                  const active = priorityFilter === p;
                  return (
                    <button key={p} onClick={() => setPriorityFilter(p)} style={{
                      background: active ? "rgba(255,255,255,0.06)" : "transparent",
                      border: "none", borderRadius: "8px", padding: "7px 10px",
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      cursor: "pointer", transition: "all 0.15s",
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        {ps && <span style={{ width: "18px", height: "18px", borderRadius: "5px", background: ps.bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "10px", fontWeight: 900, color: ps.color }}>{p}</span>}
                        <span style={{ fontSize: "12px", fontWeight: active ? 700 : 500, color: active ? "#f0efe8" : "rgba(240,239,232,0.5)" }}>{p === "all" ? "全て" : `${p}ランク`}</span>
                      </div>
                      <span style={{ fontSize: "11px", fontWeight: 600, color: "rgba(240,239,232,0.3)" }}>{count}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Platform filter */}
            <div>
              <div style={{ fontSize: "10px", fontWeight: 600, color: "rgba(240,239,232,0.3)", textTransform: "uppercase", letterSpacing: "1px", marginBottom: "8px" }}>プラットフォーム</div>
              <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                {uniquePlatforms.map((p) => {
                  const pi = PLATFORM_ICONS[p] || { icon: "?", color: "#888" };
                  const count = targets.filter((t) => t.platform === p).length;
                  const active = platformFilter === p;
                  return (
                    <button key={p} onClick={() => setPlatformFilter(active ? "all" : p)} style={{
                      background: active ? `${pi.color}12` : "transparent",
                      border: "none", borderRadius: "8px", padding: "7px 10px",
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      cursor: "pointer", transition: "all 0.15s",
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <span style={{ fontSize: "13px" }}>{pi.icon}</span>
                        <span style={{ fontSize: "12px", fontWeight: active ? 700 : 500, color: active ? pi.color : "rgba(240,239,232,0.5)" }}>{p === "yahoo_qa" ? "Yahoo知恵袋" : p.charAt(0).toUpperCase() + p.slice(1)}</span>
                      </div>
                      <span style={{ fontSize: "11px", fontWeight: 600, color: "rgba(240,239,232,0.3)" }}>{count}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Min score */}
            <div>
              <div style={{ fontSize: "10px", fontWeight: 600, color: "rgba(240,239,232,0.3)", textTransform: "uppercase", letterSpacing: "1px", marginBottom: "8px" }}>最低スコア</div>
              <select value={minScore} onChange={(e) => setMinScore(Number(e.target.value))} style={{
                width: "100%", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: "8px", padding: "7px 10px", fontSize: "12px", color: "#f0efe8", cursor: "pointer", outline: "none",
              }}>
                <option value={0}>制限なし</option>
                <option value={50}>≥ 50%</option>
                <option value={70}>≥ 70%</option>
                <option value={80}>≥ 80%</option>
                <option value={90}>≥ 90%</option>
              </select>
            </div>

            {/* Contact filter */}
            <div>
              <div style={{ fontSize: "10px", fontWeight: 600, color: "rgba(240,239,232,0.3)", textTransform: "uppercase", letterSpacing: "1px", marginBottom: "8px" }}>連絡先</div>
              <button onClick={() => setContactFilter(!contactFilter)} style={{
                width: "100%", background: contactFilter ? "rgba(45,209,122,0.1)" : "rgba(255,255,255,0.04)",
                border: `1px solid ${contactFilter ? "rgba(45,209,122,0.25)" : "rgba(255,255,255,0.08)"}`,
                borderRadius: "8px", padding: "7px 10px", fontSize: "12px", fontWeight: 600,
                color: contactFilter ? "#2dd17a" : "rgba(240,239,232,0.5)", cursor: "pointer", textAlign: "left",
              }}>
                {contactFilter ? "✅ 連絡先ありのみ" : "連絡先ありのみ"}
              </button>
            </div>

            {/* Action buttons */}
            <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "8px" }}>
              <button onClick={handleBulkGenerate} disabled={bulkGenerating} style={{
                width: "100%", background: "rgba(124,92,252,0.1)", border: "1px solid rgba(124,92,252,0.2)",
                borderRadius: "10px", padding: "9px 10px", fontSize: "12px", fontWeight: 700,
                color: "#7c5cfc", cursor: bulkGenerating ? "wait" : "pointer", opacity: bulkGenerating ? 0.6 : 1,
              }}>
                {bulkGenerating ? "⏳ 生成中..." : "💬 一括コメント生成"}
              </button>
              <button onClick={handleBulkSubmit} style={{
                width: "100%", background: "rgba(255,107,53,0.1)", border: "1px solid rgba(255,107,53,0.25)",
                borderRadius: "10px", padding: "9px 10px", fontSize: "12px", fontWeight: 700,
                color: "#ff6b35", cursor: "pointer",
              }}>
                🚀 一括フォーム送信
              </button>
              <button onClick={handleExport} disabled={exporting} style={{
                width: "100%", background: "linear-gradient(135deg, #2dd17a, #1ba360)", border: "none",
                borderRadius: "10px", padding: "10px", fontSize: "12px", fontWeight: 700,
                color: "#fff", cursor: exporting ? "wait" : "pointer", opacity: exporting ? 0.7 : 1,
                boxShadow: "0 4px 16px rgba(45,209,122,0.2)",
              }}>
                📊 {exporting ? "エクスポート中..." : `エクスポート (${selectedCount > 0 ? selectedCount : visibleTargets.length}件)`}
              </button>
            </div>
          </div>

          {/* Right content */}
          <div>
            {/* Selection bar */}
            <div style={{ display: "flex", gap: "6px", marginBottom: "12px", alignItems: "center" }}>
              <button onClick={selectAll} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "7px", padding: "5px 12px", fontSize: "11px", fontWeight: 600, color: "rgba(240,239,232,0.5)", cursor: "pointer" }}>全選択</button>
              <button onClick={selectSA} title="S・AランクターゲットのチェックボックスをONにする（表示フィルターは変わりません）" style={{ background: "transparent", border: "1px solid rgba(255,214,0,0.2)", borderRadius: "7px", padding: "5px 12px", fontSize: "11px", fontWeight: 600, color: "rgba(255,214,10,0.6)", cursor: "pointer" }}>☑ S+A選択</button>
              <button onClick={() => setSelected(new Set())} style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "7px", padding: "5px 12px", fontSize: "11px", fontWeight: 600, color: "rgba(240,239,232,0.3)", cursor: "pointer" }}>解除</button>
              <span style={{ marginLeft: "auto", fontSize: "11px", color: "rgba(240,239,232,0.35)" }}>{selectedCount > 0 ? `${selectedCount}件選択中` : `${visibleTargets.length}件表示`}</span>
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
                  const contactInfo = t.email || (t.twitter_handle ? `@${t.twitter_handle}` : null);
                  return (
                    <div key={t.id} style={{
                      background: isSelected ? "rgba(255,214,0,0.03)" : "#13132a",
                      border: `1px solid ${isSelected ? "rgba(255,214,0,0.12)" : "rgba(255,255,255,0.06)"}`,
                      borderRadius: "14px", padding: "16px 18px", transition: "all 0.15s",
                    }}>
                      {/* Header row */}
                      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "10px" }}>
                        <div onClick={() => toggleSelect(t.id)} style={{
                          width: "18px", height: "18px", borderRadius: "5px", flexShrink: 0,
                          border: `2px solid ${isSelected ? "#ffd60a" : "rgba(255,255,255,0.12)"}`,
                          background: isSelected ? "#ffd60a" : "transparent", display: "flex", alignItems: "center", justifyContent: "center",
                          cursor: "pointer", transition: "all 0.15s",
                        }}>
                          {isSelected && <span style={{ fontSize: "10px", color: "#000", fontWeight: 900 }}>✓</span>}
                        </div>
                        {t.platform === "google_maps" ? (
                          <span style={{ fontSize: "10px", fontWeight: 900, padding: "2px 6px", borderRadius: "6px", background: "rgba(66,133,244,0.15)", color: "#4285f4", flexShrink: 0, whiteSpace: "nowrap" }}>🏢 企業</span>
                        ) : (
                          <span style={{ background: ps.bg, color: ps.color, fontSize: "10px", fontWeight: 900, width: "22px", height: "22px", borderRadius: "6px", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{ps.label}</span>
                        )}
                        <span style={{ fontSize: "14px", fontWeight: 700, color: "#f0efe8" }}>@{t.username}</span>
                        <span style={{ fontSize: "10px", padding: "2px 8px", borderRadius: "5px", background: `${pi.color}12`, color: pi.color, fontWeight: 600, flexShrink: 0 }}>{pi.icon} {t.platform === "yahoo_qa" ? "Yahoo知恵袋" : t.platform.charAt(0).toUpperCase() + t.platform.slice(1)}</span>
                        {(() => {
                          const snsDm = ["reddit","twitter","wantedly"];
                          const hasEmail = t.email && !t.email.startsWith("Twitter:") && !t.email.startsWith("DM:");
                          const isDmOnly = !hasEmail && snsDm.includes(t.platform);
                          if (hasEmail) return <span style={{ fontSize: "10px", padding: "2px 8px", borderRadius: "5px", background: "rgba(45,209,122,0.12)", color: "#2dd17a", fontWeight: 600 }}>✉️ メール</span>;
                          if (isDmOnly) return <span style={{ fontSize: "10px", padding: "2px 8px", borderRadius: "5px", background: "rgba(29,155,240,0.1)", color: "#1d9bf0", fontWeight: 600 }}>💬 DM可能</span>;
                          return null;
                        })()}
                        {t.estimated_role && <span style={{ fontSize: "10px", color: "rgba(240,239,232,0.3)" }}>{t.estimated_role}</span>}
                        {t.platform === "google_maps" && (t.website || t.contact_url) ? (
                          <a href={t.website || t.contact_url || ""} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} style={{ marginLeft: "auto", fontSize: "11px", color: "#4285f4", textDecoration: "none", maxWidth: "160px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flexShrink: 0 }}>
                            🌐 {(t.website || t.contact_url || "").replace(/^https?:\/\/(www\.)?/, "").split("/")[0]}
                          </a>
                        ) : (
                          <span style={{ marginLeft: "auto", fontSize: "20px", fontWeight: 800, fontFamily: "'Space Grotesk'", color: t.match_score >= 75 ? "#ffd60a" : t.match_score >= 55 ? "#2dd17a" : "rgba(240,239,232,0.4)" }}>{t.match_score}%</span>
                        )}
                      </div>

                      {/* AI reason — always visible, prominent */}
                      {(t.ai_reason || t.match_reason) && (
                        <div style={{ background: t.platform === "google_maps" ? "rgba(66,133,244,0.06)" : "rgba(255,107,53,0.06)", border: `1px solid ${t.platform === "google_maps" ? "rgba(66,133,244,0.15)" : "rgba(255,107,53,0.12)"}`, borderRadius: "8px", padding: "8px 12px", marginBottom: "10px" }}>
                          <span style={{ fontSize: "13px", color: t.platform === "google_maps" ? "rgba(120,180,255,0.85)" : "rgba(240,200,160,0.85)", lineHeight: 1.6, display: "block" }}>
                            {t.platform === "google_maps" ? "🏢 " : "💡 "}{t.ai_reason || t.match_reason}
                          </span>
                        </div>
                      )}

                      {/* Score bars — hidden for B2B google_maps leads */}
                      {t.platform !== "google_maps" && <div style={{ display: "flex", gap: "16px", marginBottom: "10px" }}>
                        {[
                          { label: "課題の深さ", score: t.q1_score ?? t.relevance_score ?? 0, max: 10, color: "#ff6b35" },
                          { label: "試す意欲", score: t.q2_score ?? t.intent_score ?? 0, max: 10, color: "#2dd17a" },
                          { label: "接触可能性", score: t.q3_score ?? t.influence_score ?? 0, max: 5, color: "#1d9bf0" },
                        ].map((s) => (
                          <div key={s.label} style={{ flex: 1, display: "flex", alignItems: "center", gap: "6px" }}>
                            <span style={{ fontSize: "9px", color: "rgba(240,239,232,0.3)", width: "52px", flexShrink: 0 }}>{s.label}</span>
                            <div style={{ flex: 1, height: "4px", background: "rgba(255,255,255,0.05)", borderRadius: "2px", overflow: "hidden" }}>
                              <div style={{ width: `${(s.score / s.max) * 100}%`, height: "100%", background: s.color, borderRadius: "2px" }} />
                            </div>
                            <span style={{ fontSize: "9px", color: s.color, fontWeight: 700, width: "24px", textAlign: "right" }}>{s.score}/{s.max}</span>
                          </div>
                        ))}
                      </div>}

                      {/* Action row */}
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        {t.post_content && <span style={{ fontSize: "11px", color: "rgba(240,239,232,0.25)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.post_content.slice(0, 80)}</span>}
                        {!t.post_content && <span style={{ flex: 1 }} />}
                        {!t.comment ? (
                          <button onClick={() => handleGenerateComment(t.id)} disabled={generatingIds.has(t.id)} style={{
                            background: "rgba(124,92,252,0.08)", border: "1px solid rgba(124,92,252,0.15)", borderRadius: "7px",
                            padding: "4px 10px", fontSize: "10px", fontWeight: 600, color: "#7c5cfc",
                            cursor: generatingIds.has(t.id) ? "wait" : "pointer", flexShrink: 0,
                          }}>
                            {generatingIds.has(t.id) ? "⏳" : "💬 コメント生成"}
                          </button>
                        ) : (
                          <button onClick={() => { navigator.clipboard.writeText(t.comment!.content); setToast("📋 コピーしました"); setTimeout(() => setToast(""), 2000); }} style={{
                            background: "rgba(255,214,10,0.06)", border: "1px solid rgba(255,214,10,0.12)", borderRadius: "7px",
                            padding: "4px 10px", fontSize: "10px", fontWeight: 600, color: "#ffd60a",
                            cursor: "pointer", flexShrink: 0,
                          }}>
                            📋 コメントをコピー
                          </button>
                        )}
                        {t.email && !t.email.startsWith("Twitter:") && (
                          <button onClick={() => handleDraftEmail(t)} disabled={draftingIds.has(t.id)} style={{
                            background: "rgba(45,209,122,0.08)", border: "1px solid rgba(45,209,122,0.15)", borderRadius: "7px",
                            padding: "4px 10px", fontSize: "10px", fontWeight: 600, color: "#2dd17a",
                            cursor: draftingIds.has(t.id) ? "wait" : "pointer", flexShrink: 0,
                          }}>
                            {draftingIds.has(t.id) ? "⏳" : "📧 メール"}
                          </button>
                        )}
                        {(t.contact_url || t.website) && (() => {
                          const siteUrl = t.contact_url || t.website || "";
                          return siteUrl.startsWith("http") ? (
                            <button onClick={(e) => { e.stopPropagation(); handleSubmitForm(t); }} disabled={submittingFormIds.has(t.id)} style={{
                              background: "rgba(255,107,53,0.08)", border: "1px solid rgba(255,107,53,0.18)", borderRadius: "7px",
                              padding: "4px 10px", fontSize: "10px", fontWeight: 600, color: "#ff6b35",
                              cursor: submittingFormIds.has(t.id) ? "wait" : "pointer", flexShrink: 0,
                            }}>
                              {submittingFormIds.has(t.id) ? "⏳" : "📨 フォーム送信"}
                            </button>
                          ) : null;
                        })()}
                        {t.post_url && (
                          <a href={t.post_url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} style={{
                            background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "7px",
                            padding: "4px 8px", fontSize: "10px", color: "rgba(240,239,232,0.3)", textDecoration: "none", flexShrink: 0,
                          }}>
                            🔗
                          </a>
                        )}
                      </div>

                      {/* Comment preview — full text, persists across re-fetches */}
                      {t.comment ? (
                        <div style={{ marginTop: "8px", background: "rgba(255,214,10,0.03)", border: "1px solid rgba(255,214,10,0.08)", borderRadius: "8px", padding: "10px 12px" }}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
                            <span style={{ fontSize: "10px", fontWeight: 600, color: "rgba(255,214,10,0.6)" }}>{t.platform === "google_maps" ? "📧 ビジネスメール" : "💬 生成メッセージ"}</span>
                            <button onClick={() => { navigator.clipboard.writeText(t.comment!.content); setToast("📋 コピーしました"); setTimeout(() => setToast(""), 2000); }} style={{ background: "transparent", border: "1px solid rgba(255,214,10,0.15)", borderRadius: "5px", padding: "2px 8px", fontSize: "10px", color: "rgba(255,214,10,0.6)", cursor: "pointer" }}>📋 コピー</button>
                          </div>
                          <div style={{ fontSize: "11px", color: "rgba(240,239,232,0.65)", lineHeight: 1.7, whiteSpace: "pre-wrap", wordBreak: "break-all", minHeight: "100px" }}>
                            {t.comment.content}
                          </div>
                        </div>
                      ) : t.platform === "google_maps" ? (
                        <div style={{ marginTop: "8px", background: "rgba(66,133,244,0.03)", border: "1px dashed rgba(66,133,244,0.15)", borderRadius: "8px", padding: "10px 12px" }}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
                            <span style={{ fontSize: "10px", fontWeight: 600, color: "rgba(66,133,244,0.6)" }}>🏢 ビジネスメールテンプレート</span>
                            <span style={{ fontSize: "9px", color: "rgba(240,239,232,0.25)" }}>「メール生成」でパーソナライズ</span>
                          </div>
                          <div style={{ fontSize: "11px", color: "rgba(240,239,232,0.25)", lineHeight: 1.7, whiteSpace: "pre-wrap", minHeight: "100px", fontStyle: "italic" }}>
                            {`はじめまして。${(campaign?.product_description as string || campaign?.product_url as string || "弊社プロダクト").slice(0, 40)}の開発をしているものです。
${t.username}様のビジネスにお役立ていただけるかと存じまして、初期ユーザーとしてお試しいただけないかとご連絡しました。
ご検討いただけますと幸いです。`}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Live log drawer */}
      {showLiveLog && (
        <div style={{ position: "fixed", top: 0, right: 0, width: "360px", height: "100vh", background: "#13132a", borderLeft: "1px solid rgba(255,255,255,0.08)", zIndex: 999, display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "16px 20px", borderBottom: "1px solid rgba(255,255,255,0.07)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: "14px", fontWeight: 700, fontFamily: "'Space Grotesk'" }}>🔔 アクティビティ</span>
            <button onClick={() => setShowLiveLog(false)} style={{ background: "none", border: "none", color: "rgba(240,239,232,0.4)", fontSize: "18px", cursor: "pointer" }}>✕</button>
          </div>
          <div style={{ flex: 1, overflow: "auto" }}>
            <DashboardLiveLog logs={logs} platforms={(campaign?.platforms as string[]) || []} campaignCreatedAt={campaign?.created_at as string} hasData={hasData} />
          </div>
        </div>
      )}

      {/* Bulk send confirmation + progress modal */}
      {bulkModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 2100, display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}>
          <div style={{ background: "#13132a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "20px", padding: "28px", width: "100%", maxWidth: "520px", maxHeight: "80vh", display: "flex", flexDirection: "column" }}>
            <h3 style={{ fontFamily: "'Space Grotesk'", fontWeight: 700, fontSize: "18px", marginBottom: "20px" }}>🚀 一括フォーム送信</h3>

            {!bulkProgress ? (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "16px" }}>
                  <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: "10px", padding: "12px" }}>
                    <div style={{ fontSize: "10px", color: "rgba(240,239,232,0.4)", marginBottom: "4px" }}>送信対象</div>
                    <div style={{ fontSize: "22px", fontWeight: 800, fontFamily: "'Space Grotesk'" }}>{bulkModal.targets.length}<span style={{ fontSize: "11px", fontWeight: 400 }}>件</span></div>
                    <div style={{ fontSize: "10px", color: "rgba(240,239,232,0.4)", marginTop: "2px" }}>
                      フォーム{bulkModal.targets.filter(t => t.method === "form").length}件 / メール{bulkModal.targets.filter(t => t.method === "gmail").length}件
                    </div>
                  </div>
                  <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: "10px", padding: "12px" }}>
                    <div style={{ fontSize: "10px", color: "rgba(240,239,232,0.4)", marginBottom: "4px" }}>送信者</div>
                    <div style={{ fontSize: "12px", fontWeight: 600 }}>{bulkModal.senderName || "未設定"}</div>
                    <div style={{ fontSize: "10px", color: "rgba(240,239,232,0.4)", marginTop: "2px", wordBreak: "break-all" }}>{bulkModal.senderEmail}</div>
                  </div>
                </div>
                <div style={{ fontSize: "11px", color: "rgba(255,200,100,0.7)", background: "rgba(255,200,0,0.05)", border: "1px solid rgba(255,200,0,0.1)", borderRadius: "8px", padding: "8px 12px", marginBottom: "20px" }}>
                  ⚠️ メールターゲットはGmailリンクを開きます。フォームターゲットはPlaywrightで自動送信されます。
                </div>
                <div style={{ display: "flex", gap: "10px" }}>
                  <button onClick={() => setBulkModal(null)} style={{ flex: 1, padding: "12px", background: "transparent", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "10px", color: "rgba(240,239,232,0.5)", fontSize: "14px", cursor: "pointer", fontWeight: 600 }}>キャンセル</button>
                  <button onClick={handleBulkStart} style={{ flex: 2, padding: "12px", background: "#ff6b35", border: "none", borderRadius: "10px", color: "#fff", fontSize: "14px", cursor: "pointer", fontWeight: 700 }}>🚀 送信開始</button>
                </div>
              </>
            ) : (
              <>
                {/* Progress bar */}
                <div style={{ marginBottom: "16px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
                    <span style={{ fontSize: "13px", fontWeight: 600 }}>{bulkProgress.running ? "送信中..." : "送信完了"}</span>
                    <span style={{ fontSize: "13px", color: "rgba(240,239,232,0.5)" }}>{bulkProgress.done}/{bulkProgress.total}件</span>
                  </div>
                  <div style={{ height: "6px", background: "rgba(255,255,255,0.08)", borderRadius: "3px", overflow: "hidden" }}>
                    <div style={{ width: `${bulkProgress.total > 0 ? (bulkProgress.done / bulkProgress.total) * 100 : 0}%`, height: "100%", background: "linear-gradient(90deg, #ff6b35, #ffd60a)", borderRadius: "3px", transition: "width 0.3s" }} />
                  </div>
                </div>
                {/* Results list */}
                <div style={{ flex: 1, overflow: "auto", marginBottom: "16px", display: "flex", flexDirection: "column", gap: "4px" }}>
                  {bulkProgress.results.map((r, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "6px 10px", background: "rgba(255,255,255,0.03)", borderRadius: "7px" }}>
                      <span style={{ fontSize: "14px" }}>{r.status === "sent" ? "✅" : r.status === "gmail" ? "📧" : "❌"}</span>
                      <span style={{ fontSize: "12px", fontWeight: 600, flex: 1 }}>@{r.username}</span>
                      {r.status === "gmail" && r.gmailUrl && (
                        <a href={r.gmailUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: "10px", color: "#2dd17a", textDecoration: "none", background: "rgba(45,209,122,0.1)", padding: "2px 8px", borderRadius: "4px" }}>Gmail開く</a>
                      )}
                      {r.status === "failed" && <span style={{ fontSize: "10px", color: "rgba(255,100,100,0.7)" }}>{r.error}</span>}
                      {r.status === "sent" && <span style={{ fontSize: "10px", color: "rgba(45,209,122,0.7)" }}>送信完了</span>}
                    </div>
                  ))}
                  {bulkProgress.running && (
                    <div style={{ padding: "8px 10px", fontSize: "12px", color: "rgba(240,239,232,0.4)", textAlign: "center" }}>⏳ 処理中...</div>
                  )}
                </div>
                {bulkProgress.finished && (
                  <button onClick={() => { setBulkModal(null); setBulkProgress(null); }} style={{ width: "100%", padding: "12px", background: "#2dd17a", border: "none", borderRadius: "10px", color: "#fff", fontSize: "14px", cursor: "pointer", fontWeight: 700 }}>✅ 完了</button>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Form submission preview modal */}
      {formModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}>
          <div style={{ background: "#13132a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "20px", padding: "28px", width: "100%", maxWidth: "540px" }}>
            <h3 style={{ fontFamily: "'Space Grotesk'", fontWeight: 700, fontSize: "18px", marginBottom: "20px" }}>📨 フォーム送信の確認</h3>
            <div style={{ marginBottom: "12px" }}>
              <div style={{ fontSize: "11px", color: "rgba(240,239,232,0.4)", marginBottom: "4px" }}>送信先URL</div>
              <div style={{ fontSize: "12px", color: "#4285f4", wordBreak: "break-all" }}>{formModal.websiteUrl}</div>
            </div>
            <div style={{ marginBottom: "12px" }}>
              <div style={{ fontSize: "11px", color: "rgba(240,239,232,0.4)", marginBottom: "4px" }}>送信者</div>
              <div style={{ fontSize: "12px", color: "rgba(240,239,232,0.7)" }}>{formModal.senderName} &lt;{formModal.senderEmail}&gt;</div>
            </div>
            <div style={{ marginBottom: "20px" }}>
              <div style={{ fontSize: "11px", color: "rgba(240,239,232,0.4)", marginBottom: "4px" }}>送信メッセージ（編集可）</div>
              <textarea
                value={formModalMsg}
                onChange={(e) => setFormModalMsg(e.target.value)}
                rows={6}
                style={{ width: "100%", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "10px", padding: "12px", color: "#f0efe8", fontSize: "13px", lineHeight: 1.6, resize: "vertical", outline: "none", boxSizing: "border-box", fontFamily: "DM Sans" }}
              />
            </div>
            <div style={{ display: "flex", gap: "10px" }}>
              <button onClick={() => setFormModal(null)} style={{ flex: 1, padding: "12px", background: "transparent", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "10px", color: "rgba(240,239,232,0.5)", fontSize: "14px", cursor: "pointer", fontWeight: 600 }}>キャンセル</button>
              <button onClick={handleConfirmSubmit} disabled={formSubmitting} style={{ flex: 2, padding: "12px", background: formSubmitting ? "rgba(255,107,53,0.4)" : "#ff6b35", border: "none", borderRadius: "10px", color: "#fff", fontSize: "14px", cursor: formSubmitting ? "wait" : "pointer", fontWeight: 700 }}>
                {formSubmitting ? "⏳ 送信中..." : "📨 送信する"}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div style={{ position: "fixed", bottom: 32, right: 32, background: "#2dd17a", color: "#fff", borderRadius: 12, padding: "12px 20px", fontSize: 14, fontWeight: 600, zIndex: 1000, boxShadow: "0 4px 20px rgba(0,0,0,0.3)", fontFamily: "DM Sans" }}>
          {toast}
        </div>
      )}
    </div>
  );
}
