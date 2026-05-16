"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const PLATFORM_ICONS: Record<string, { icon: string; label: string }> = {
  twitter: { icon: "𝕏", label: "X" }, reddit: { icon: "🤖", label: "Reddit" },
  note: { icon: "📝", label: "note" }, zenn: { icon: "📘", label: "Zenn" },
  qiita: { icon: "💻", label: "Qiita" }, connpass: { icon: "🎪", label: "Connpass" },
  wantedly: { icon: "🤝", label: "Wantedly" }, yahoo_qa: { icon: "🟡", label: "Yahoo知恵袋" },
  google_maps: { icon: "🗺️", label: "Googleマップ" }, web: { icon: "🌐", label: "Web" },
};

const PRIORITY_STYLE: Record<string, { bg: string; color: string }> = {
  S: { bg: "linear-gradient(135deg, #ffd700, #ffaa00)", color: "#000" },
  A: { bg: "linear-gradient(135deg, #2dd17a, #1ba360)", color: "#fff" },
  B: { bg: "rgba(59,130,246,0.2)", color: "#3ea8ff" },
  C: { bg: "rgba(255,255,255,0.06)", color: "rgba(240,239,232,0.4)" },
};

type OutreachTarget = {
  id: string; username: string; platform: string; match_score: number;
  priority: string; email: string | null; profile_url: string | null;
  post_content: string | null; ai_reason: string | null;
  message: string; status: "pending" | "sent" | "skipped";
  sendMethod: "email" | "dm" | "none";
};

const SNS_DM_PLATFORMS = ["reddit","twitter","wantedly"];

const DM_URLS: Record<string, (username: string) => string> = {
  twitter: (u) => `https://twitter.com/messages/compose?recipient_id=${u}`,
  reddit:  (u) => `https://www.reddit.com/message/compose/?to=${u}`,
  wantedly:(u) => `https://www.wantedly.com/users/${u}`,
};

type Tab = "all" | "email" | "dm" | "sent" | "skipped";

export default function OutreachPage() {
  const { id: campaignId } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const [targets, setTargets] = useState<OutreachTarget[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [campaign, setCampaign] = useState<Record<string, unknown> | null>(null);
  const [generating, setGenerating] = useState(false);
  const [bulkSending, setBulkSending] = useState(false);
  const [bulkResult, setBulkResult] = useState<{ sent: number; failed: number } | null>(null);
  const [sendStatus, setSendStatus] = useState<Record<string, { status: "idle" | "sending" | "success" | "error"; error?: string }>>({});
  const [showSettings, setShowSettings] = useState(false);
  const [settingsSenderName, setSettingsSenderName] = useState("");
  const [settingsProductUrl, setSettingsProductUrl] = useState("");
  const [settingsKeywords, setSettingsKeywords] = useState("");

  const fetchTargets = useCallback(async () => {
    const supabase = createClient();
    const { data: camp } = await supabase.from("campaigns").select("*").eq("id", campaignId).single();
    if (!camp) return;
    setCampaign(camp);

    // Get selected IDs from URL or default to all targets
    const idsParam = searchParams.get("ids");
    console.log("[outreach] campaignId:", campaignId, "idsParam:", idsParam);

    let query = supabase.from("targets")
      .select("id, username, platform, match_score, priority, email, profile_url, post_content, ai_reason")
      .eq("campaign_id", campaignId)
      .order("match_score", { ascending: false });

    if (idsParam) {
      const ids = idsParam.split(",").filter(Boolean);
      if (ids.length > 0) query = query.in("id", ids);
    }

    const { data, error: fetchErr } = await query.limit(50);
    console.log("[outreach] fetched targets:", data?.length || 0, "error:", fetchErr?.message || "none");
    if (data) {
      setTargets(data.map((t: Record<string, unknown>) => {
        const rawEmail = (t.email as string) || "";
        const realEmail = rawEmail && !rawEmail.startsWith("Twitter:") && !rawEmail.startsWith("DM:") ? rawEmail : null;
        const hasEmail = realEmail && realEmail.includes("@");
        const isDmPlatform = SNS_DM_PLATFORMS.includes(t.platform as string);
        return {
          id: t.id as string, username: t.username as string, platform: t.platform as string,
          match_score: Number(t.match_score) || 0, priority: (t.priority as string) || "C",
          email: realEmail,
          profile_url: (t.profile_url as string | null),
          post_content: t.post_content as string | null, ai_reason: t.ai_reason as string | null,
          message: "", status: "pending" as const,
          sendMethod: hasEmail ? "email" : isDmPlatform ? "dm" : "none",
        };
      }));
    }
    setLoading(false);
  }, [campaignId, searchParams]);

  useEffect(() => { fetchTargets(); }, [fetchTargets]);

  // Pre-fill settings from localStorage when modal opens
  const openSettings = () => {
    setSettingsSenderName(localStorage.getItem("spark_sender_name") || "");
    setSettingsProductUrl(localStorage.getItem("spark_product_url") || (campaign?.product_url as string) || "");
    setSettingsKeywords(localStorage.getItem("spark_keywords") || "");
    setShowSettings(true);
  };

  const confirmAndGenerate = () => {
    // Save to localStorage
    localStorage.setItem("spark_sender_name", settingsSenderName);
    localStorage.setItem("spark_product_url", settingsProductUrl);
    localStorage.setItem("spark_keywords", settingsKeywords);
    setShowSettings(false);
    generateMessages(settingsSenderName, settingsProductUrl, settingsKeywords);
  };

  const generateMessages = async (senderName?: string, productUrl?: string, keywords?: string) => {
    setGenerating(true);
    const sn = senderName || (typeof window !== "undefined" ? localStorage.getItem("spark_sender_name") || "担当者" : "担当者");
    const pu = productUrl || (typeof window !== "undefined" ? localStorage.getItem("spark_product_url") || "" : "");
    const kw = keywords || (typeof window !== "undefined" ? localStorage.getItem("spark_keywords") || "" : "");
    const senderEmail = typeof window !== "undefined" ? localStorage.getItem("spark_sender_email") || "" : "";
    const updated = [...targets];
    for (let i = 0; i < updated.length; i++) {
      try {
        const reqBody = { sender_name: sn, sender_email: senderEmail, product_url: pu, keywords: kw, force: true };
        console.log("[generate] target:", updated[i].username, "body:", reqBody);
        const res = await fetch(`/api/targets/${updated[i].id}/generate-comment`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(reqBody),
        });
        if (res.ok) {
          const data = await res.json();
          console.log("[generate] response:", data);
          // Prefer flat generatedMessage string, fall back to comment.content
          updated[i].message = data.generatedMessage || data.comment?.content || (typeof data.comment === "string" ? data.comment : "") || "";
        }
      } catch { /* keep empty, user can retry */ }
      if (!updated[i].message) {
        const productDesc = (campaign?.product_description as string) || pu || "";
        const kwNote = kw ? `（${kw}）` : "";
        const isB2B = updated[i].platform === "google_maps";
        updated[i].message = isB2B
          ? `${updated[i].username} ご担当者様

はじめまして、${sn}と申します。

${productDesc.slice(0, 80)}${kwNote}を開発しております。貴社のビジネスにご活用いただけると考え、ご連絡いたしました。βテスターとしてお試しいただけませんでしょうか。

ご検討のほど、よろしくお願いいたします。`
          : `${updated[i].username} さん、はじめまして。${sn}と申します。

${updated[i].platform}での投稿を拝見し、${productDesc.slice(0, 60)}${kwNote}のβテスターとしてご協力いただけないかとご連絡しました。もしご興味があれば、ぜひお試しください！`;
      }
      setTargets([...updated]);
    }
    setGenerating(false);
  };

  const updateMessage = (id: string, msg: string) => {
    setTargets(prev => prev.map(t => t.id === id ? { ...t, message: msg } : t));
  };

  const setStatus = (id: string, status: "sent" | "skipped") => {
    setTargets(prev => prev.map(t => t.id === id ? { ...t, status } : t));
    setEditingId(null);
  };

  const handleBulkSend = async () => {
    const senderName = typeof window !== "undefined" ? localStorage.getItem("spark_sender_name") || "" : "";
    const senderEmail = typeof window !== "undefined" ? localStorage.getItem("spark_sender_email") || "" : "";
    if (!senderEmail) { alert("設定ページで送信者メールを登録してください"); return; }
    const pending = targets.filter(t => t.status === "pending" && t.sendMethod !== "none");
    if (!pending.length) { alert("送信可能なターゲットがありません"); return; }
    if (!confirm(`${pending.length}件を一括送信しますか？`)) return;
    setBulkSending(true);

    // Mark all pending as "sending"
    const initialStatus: Record<string, { status: "idle" | "sending" | "success" | "error"; error?: string }> = {};
    for (const t of pending) initialStatus[t.id] = { status: "sending" };
    setSendStatus(prev => ({ ...prev, ...initialStatus }));

    const messages: Record<string, string> = {};
    for (const t of pending) messages[t.id] = t.message || "";
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/bulk-submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetIds: pending.map(t => t.id), senderName, senderEmail, messages }),
      });
      const data = await res.json();
      setBulkResult({ sent: data.sent || 0, failed: data.failed || 0 });

      // Update per-target status from results
      if (data.results) {
        const newStatus: Record<string, { status: "idle" | "sending" | "success" | "error"; error?: string }> = {};
        for (const r of data.results as { targetId: string; status: string; error?: string }[]) {
          newStatus[r.targetId] = r.status === "failed"
            ? { status: "error", error: r.error || "送信失敗" }
            : { status: "success" };
        }
        setSendStatus(prev => ({ ...prev, ...newStatus }));
        setTargets(prev => prev.map(t => {
          const r = data.results.find((x: { targetId: string; status: string }) => x.targetId === t.id);
          return r && r.status !== "failed" ? { ...t, status: "sent" as const } : t;
        }));
      }
    } catch (e) {
      // Mark all as error
      const errStatus: Record<string, { status: "error"; error: string }> = {};
      for (const t of pending) errStatus[t.id] = { status: "error", error: "ネットワークエラー" };
      setSendStatus(prev => ({ ...prev, ...errStatus }));
      alert("送信エラーが発生しました");
    }
    setBulkSending(false);
  };

  const filtered = targets.filter(t => {
    if (activeTab === "all") return t.status === "pending";
    if (activeTab === "email") return t.sendMethod === "email" && t.status === "pending";
    if (activeTab === "dm") return t.sendMethod === "dm" && t.status === "pending";
    if (activeTab === "sent") return t.status === "sent";
    if (activeTab === "skipped") return t.status === "skipped";
    return true;
  });

  const emailCount = targets.filter(t => t.sendMethod === "email" && t.status === "pending").length;
  const dmCount = targets.filter(t => t.sendMethod === "dm" && t.status === "pending").length;
  const sentCount = targets.filter(t => t.status === "sent").length;

  if (loading) return <div style={{ minHeight: "100vh", background: "#0d0d1a", display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(240,239,232,0.3)" }}>読み込み中...</div>;

  return (
    <div style={{ minHeight: "100vh", background: "#0d0d1a", color: "#f0efe8" }}>
      {/* Header */}
      <div style={{ borderBottom: "1px solid rgba(255,255,255,0.07)", padding: "14px 24px" }}>
        <div style={{ maxWidth: "1000px", margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
            <a href={`/campaigns/${campaignId}`} style={{ color: "rgba(240,239,232,0.4)", textDecoration: "none", fontSize: "13px" }}>← キャンペーン</a>
            <span style={{ color: "rgba(255,255,255,0.1)" }}>|</span>
            <h1 style={{ fontFamily: "'Space Grotesk'", fontWeight: 700, fontSize: "17px", margin: 0 }}>📨 アウトリーチ</h1>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <button onClick={openSettings} disabled={generating} style={{
              background: generating ? "rgba(124,92,252,0.1)" : "linear-gradient(135deg, #7c5cfc, #5a3fd6)",
              color: "#fff", border: "none", borderRadius: "10px", padding: "8px 18px",
              fontSize: "12px", fontWeight: 700, cursor: generating ? "wait" : "pointer",
              fontFamily: "'Space Grotesk'", opacity: generating ? 0.7 : 1,
            }}>
              {generating ? "⏳ メッセージ生成中..." : "✨ メッセージ一括生成"}
            </button>
            <button onClick={handleBulkSend} disabled={bulkSending} style={{
              background: bulkSending ? "rgba(45,209,122,0.1)" : "linear-gradient(135deg, #2dd17a, #1ba360)",
              color: "#fff", border: "none", borderRadius: "10px", padding: "8px 18px",
              fontSize: "12px", fontWeight: 700, cursor: bulkSending ? "wait" : "pointer",
              fontFamily: "'Space Grotesk'", opacity: bulkSending ? 0.7 : 1,
            }}>
              {bulkSending ? "⏳ 送信中..." : "🚀 一括送信"}
            </button>
            {bulkResult && (
              <span style={{ fontSize: "11px", color: "rgba(240,239,232,0.5)" }}>
                ✅{bulkResult.sent}件 / ❌{bulkResult.failed}件
              </span>
            )}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: "1000px", margin: "0 auto", padding: "20px 24px" }}>
        {/* Stats */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px", marginBottom: "20px" }}>
          {[
            { label: "送信対象", value: targets.filter(t => t.status === "pending").length, icon: "📋", color: "#ff6b35" },
            { label: "メール", value: emailCount, icon: "📧", color: "#2dd17a" },
            { label: "DM", value: dmCount, icon: "💬", color: "#1d9bf0" },
            { label: "送信済み", value: sentCount, icon: "✅", color: "#7c5cfc" },
          ].map(s => (
            <div key={s.label} style={{ background: "#13132a", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "14px", padding: "14px 16px" }}>
              <div style={{ fontSize: "10px", color: "rgba(240,239,232,0.4)", marginBottom: "4px" }}>{s.icon} {s.label}</div>
              <div style={{ fontSize: "24px", fontWeight: 800, fontFamily: "'Space Grotesk'", color: s.color }}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: "4px", marginBottom: "16px" }}>
          {([
            { key: "all" as Tab, label: "全て", count: targets.filter(t => t.status === "pending").length },
            { key: "email" as Tab, label: "メール", count: emailCount },
            { key: "dm" as Tab, label: "DM", count: dmCount },
            { key: "sent" as Tab, label: "送信済み", count: sentCount },
            { key: "skipped" as Tab, label: "スキップ", count: targets.filter(t => t.status === "skipped").length },
          ]).map(tab => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)} style={{
              background: activeTab === tab.key ? "rgba(255,255,255,0.06)" : "transparent",
              border: `1px solid ${activeTab === tab.key ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.05)"}`,
              borderRadius: "8px", padding: "6px 14px", fontSize: "12px", fontWeight: activeTab === tab.key ? 700 : 500,
              color: activeTab === tab.key ? "#f0efe8" : "rgba(240,239,232,0.4)", cursor: "pointer",
            }}>
              {tab.label} ({tab.count})
            </button>
          ))}
        </div>

        {/* Target list */}
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {filtered.length === 0 ? (
            <div style={{ background: "#13132a", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "14px", padding: "40px", textAlign: "center" }}>
              <div style={{ fontSize: "28px", marginBottom: "8px" }}>📭</div>
              <div style={{ fontSize: "13px", color: "rgba(240,239,232,0.4)" }}>このカテゴリにターゲットはありません</div>
            </div>
          ) : filtered.map(t => {
            const pi = PLATFORM_ICONS[t.platform] || { icon: "?", label: t.platform };
            const ps = PRIORITY_STYLE[t.priority] || PRIORITY_STYLE.C;
            const isEditing = editingId === t.id;
            return (
              <div key={t.id} style={{
                background: "#13132a", border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: "14px", padding: "16px 18px",
              }}>
                {/* Header */}
                <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "10px" }}>
                  <span style={{ background: ps.bg, color: ps.color, fontSize: "10px", fontWeight: 900, width: "22px", height: "22px", borderRadius: "6px", display: "flex", alignItems: "center", justifyContent: "center" }}>{t.priority}</span>
                  <span style={{ fontSize: "14px", fontWeight: 700 }}>@{t.username}</span>
                  <span style={{ fontSize: "10px", padding: "2px 8px", borderRadius: "5px", background: "rgba(255,255,255,0.04)", color: "rgba(240,239,232,0.5)" }}>{pi.icon} {pi.label}</span>
                  <span style={{ fontSize: "16px", fontWeight: 800, fontFamily: "'Space Grotesk'", color: t.match_score >= 65 ? "#ffd60a" : "#2dd17a" }}>{t.match_score}%</span>
                  <span style={{
                    marginLeft: "auto", fontSize: "10px", padding: "3px 10px", borderRadius: "6px", fontWeight: 600,
                    background: t.sendMethod === "email" ? "rgba(45,209,122,0.1)" : t.sendMethod === "dm" ? "rgba(29,155,240,0.1)" : "rgba(255,255,255,0.04)",
                    color: t.sendMethod === "email" ? "#2dd17a" : t.sendMethod === "dm" ? "#1d9bf0" : "rgba(240,239,232,0.3)",
                  }}>
                    {t.sendMethod === "email" ? `📧 ${t.email}` : t.sendMethod === "dm" ? `💬 DM` : "❌ 送信不可"}
                  </span>
                  {/* Send status badge */}
                  {sendStatus[t.id] && sendStatus[t.id].status !== "idle" && (
                    <span style={{
                      fontSize: "10px", padding: "3px 10px", borderRadius: "6px", fontWeight: 700,
                      background: sendStatus[t.id].status === "success" ? "rgba(45,209,122,0.15)"
                        : sendStatus[t.id].status === "error" ? "rgba(255,80,80,0.15)"
                        : "rgba(255,214,10,0.15)",
                      color: sendStatus[t.id].status === "success" ? "#2dd17a"
                        : sendStatus[t.id].status === "error" ? "#ff5050"
                        : "#ffd60a",
                    }}>
                      {sendStatus[t.id].status === "success" ? "✅ 送信済"
                        : sendStatus[t.id].status === "error" ? `❌ ${sendStatus[t.id].error || "エラー"}`
                        : "⏳ 送信中..."}
                    </span>
                  )}
                </div>

                {/* AI Reason */}
                {t.ai_reason && (
                  <div style={{ fontSize: "11px", color: "rgba(240,239,232,0.4)", marginBottom: "10px", lineHeight: 1.4 }}>
                    💡 {t.ai_reason}
                  </div>
                )}

                {/* Message */}
                <div style={{ marginBottom: "10px" }}>
                  {t.message ? (
                    isEditing ? (
                      <textarea value={t.message} onChange={(e) => updateMessage(t.id, e.target.value)} style={{
                        width: "100%", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(124,92,252,0.2)",
                        borderRadius: "8px", padding: "10px", fontSize: "12px", color: "#f0efe8",
                        lineHeight: 1.5, minHeight: "80px", resize: "vertical", outline: "none",
                        fontFamily: "inherit",
                      }} />
                    ) : (
                      <div style={{
                        background: "rgba(124,92,252,0.04)", border: "1px solid rgba(124,92,252,0.1)",
                        borderRadius: "8px", padding: "10px", fontSize: "12px", color: "rgba(240,239,232,0.7)",
                        lineHeight: 1.5, cursor: "pointer",
                      }} onClick={() => setEditingId(t.id)}>
                        {t.message}
                      </div>
                    )
                  ) : (
                    <div style={{
                      background: "rgba(255,255,255,0.02)", border: "1px dashed rgba(255,255,255,0.08)",
                      borderRadius: "8px", padding: "12px", fontSize: "11px", color: "rgba(240,239,232,0.25)",
                      textAlign: "center",
                    }}>
                      💬 「✨ メッセージ一括生成」でAIメッセージを作成
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                  {t.message && (
                    <button onClick={() => setEditingId(isEditing ? null : t.id)} style={{
                      background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
                      borderRadius: "7px", padding: "5px 12px", fontSize: "10px", fontWeight: 600,
                      color: "rgba(240,239,232,0.5)", cursor: "pointer",
                    }}>
                      {isEditing ? "✅ 完了" : "✏️ 編集"}
                    </button>
                  )}
                  {t.status === "pending" && t.sendMethod === "email" && t.email && t.message && (
                    <a
                      href={`mailto:${t.email}?subject=${encodeURIComponent("βテスト参加のご案内")}&body=${encodeURIComponent(t.message)}`}
                      onClick={() => setStatus(t.id, "sent")}
                      style={{
                        background: "rgba(45,209,122,0.1)", border: "1px solid rgba(45,209,122,0.2)",
                        borderRadius: "7px", padding: "5px 12px", fontSize: "10px", fontWeight: 600,
                        color: "#2dd17a", cursor: "pointer", textDecoration: "none",
                      }}
                    >
                      ✉️ メールを開く
                    </a>
                  )}
                  {t.status === "pending" && t.sendMethod === "dm" && (
                    <a
                      href={DM_URLS[t.platform] ? DM_URLS[t.platform](t.username) : `${t.profile_url || "#"}`}
                      target="_blank" rel="noopener noreferrer"
                      onClick={() => setStatus(t.id, "sent")}
                      style={{
                        background: "rgba(29,155,240,0.1)", border: "1px solid rgba(29,155,240,0.2)",
                        borderRadius: "7px", padding: "5px 12px", fontSize: "10px", fontWeight: 600,
                        color: "#1d9bf0", cursor: "pointer", textDecoration: "none",
                      }}
                    >
                      💬 DMを開く →
                    </a>
                  )}
                  {t.status === "pending" && (
                    <button onClick={() => setStatus(t.id, "skipped")} style={{
                      background: "transparent", border: "1px solid rgba(255,255,255,0.06)",
                      borderRadius: "7px", padding: "5px 12px", fontSize: "10px", fontWeight: 600,
                      color: "rgba(240,239,232,0.3)", cursor: "pointer",
                    }}>
                      ⏭️ スキップ
                    </button>
                  )}
                  {t.message && (
                    <button onClick={() => { navigator.clipboard.writeText(t.message); }} style={{
                      background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)",
                      borderRadius: "7px", padding: "5px 12px", fontSize: "10px", fontWeight: 600,
                      color: "rgba(240,239,232,0.4)", cursor: "pointer", marginLeft: "auto",
                    }}>
                      📋 コピー
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Settings modal */}
      {showSettings && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}>
          <div style={{ background: "#13132a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "20px", padding: "28px", width: "100%", maxWidth: "520px" }}>
            <h3 style={{ fontFamily: "'Space Grotesk'", fontWeight: 700, fontSize: "18px", marginBottom: "6px" }}>✨ メッセージ設定を確認</h3>
            <p style={{ fontSize: "12px", color: "rgba(240,239,232,0.4)", marginBottom: "24px" }}>一括生成前に送信者情報・訴求ポイントを設定してください</p>

            <div style={{ marginBottom: "16px" }}>
              <label style={{ fontSize: "11px", color: "rgba(240,239,232,0.5)", display: "block", marginBottom: "6px" }}>🔗 プロダクトURL</label>
              <input value={settingsProductUrl} onChange={e => setSettingsProductUrl(e.target.value)}
                placeholder="https://spark-ai.jp" style={{ width: "100%", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "10px", padding: "10px 14px", color: "#f0efe8", fontSize: "13px", outline: "none", boxSizing: "border-box", fontFamily: "DM Sans" }} />
            </div>

            <div style={{ marginBottom: "16px" }}>
              <label style={{ fontSize: "11px", color: "rgba(240,239,232,0.5)", display: "block", marginBottom: "6px" }}>👤 送信者名</label>
              <input value={settingsSenderName} onChange={e => setSettingsSenderName(e.target.value)}
                placeholder="山田 太郎" style={{ width: "100%", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "10px", padding: "10px 14px", color: "#f0efe8", fontSize: "13px", outline: "none", boxSizing: "border-box", fontFamily: "DM Sans" }} />
            </div>

            <div style={{ marginBottom: "24px" }}>
              <label style={{ fontSize: "11px", color: "rgba(240,239,232,0.5)", display: "block", marginBottom: "6px" }}>🎯 キーワード / 訴求ポイント</label>
              <textarea value={settingsKeywords} onChange={e => setSettingsKeywords(e.target.value)}
                placeholder="例：AI自動化、コスト削減、β無料など"
                rows={3} style={{ width: "100%", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "10px", padding: "10px 14px", color: "#f0efe8", fontSize: "13px", outline: "none", resize: "vertical", boxSizing: "border-box", fontFamily: "DM Sans" }} />
            </div>

            <div style={{ display: "flex", gap: "10px" }}>
              <button onClick={() => setShowSettings(false)} style={{ flex: 1, padding: "12px", background: "transparent", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "10px", color: "rgba(240,239,232,0.5)", fontSize: "13px", cursor: "pointer", fontWeight: 600 }}>← 戻る</button>
              <button onClick={confirmAndGenerate} style={{ flex: 2, padding: "12px", background: "linear-gradient(135deg, #7c5cfc, #5a3fd6)", border: "none", borderRadius: "10px", color: "#fff", fontSize: "13px", cursor: "pointer", fontWeight: 700, fontFamily: "'Space Grotesk'" }}>✨ この設定で一括生成する</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
