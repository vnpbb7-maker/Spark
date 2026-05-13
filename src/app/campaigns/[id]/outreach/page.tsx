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

  const generateMessages = async () => {
    setGenerating(true);
    const productDesc = (campaign?.product_description as string) || "";
    const updated = [...targets];
    for (let i = 0; i < updated.length; i++) {
      if (updated[i].message) continue;
      try {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-api-key": "", "anthropic-version": "2023-06-01" },
          body: JSON.stringify({
            model: "claude-3-5-haiku-20241022", max_tokens: 300, temperature: 0.6,
            messages: [{ role: "user", content: `あなたはβテスター勧誘の専門家です。以下の情報を元に、この人にβテスト参加を依頼する短いメッセージ（3-4文）を日本語で書いてください。フレンドリーだが押しつけがましくないトーンで。

プロダクト: ${productDesc}
ターゲット: @${updated[i].username} (${updated[i].platform})
この人の投稿: ${(updated[i].post_content || "").slice(0, 200)}
マッチ理由: ${updated[i].ai_reason || ""}

メッセージ本文のみを返してください。件名や署名は不要です。` }],
          }),
        });
        if (res.ok) {
          const data = await res.json();
          updated[i].message = data.content?.[0]?.text || "メッセージ生成に失敗しました";
        } else {
          // Fallback message
          updated[i].message = `@${updated[i].username} さん、はじめまして。${updated[i].platform}での投稿を拝見しました。現在「${productDesc.slice(0, 30)}」のβテスターを募集しています。もしご興味があれば、ぜひ一度お試しいただけませんか？`;
        }
      } catch {
        updated[i].message = `@${updated[i].username} さん、はじめまして。${productDesc.slice(0, 30)}のβテスターにご興味はありませんか？`;
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
            <button onClick={generateMessages} disabled={generating} style={{
              background: generating ? "rgba(124,92,252,0.1)" : "linear-gradient(135deg, #7c5cfc, #5a3fd6)",
              color: "#fff", border: "none", borderRadius: "10px", padding: "8px 18px",
              fontSize: "12px", fontWeight: 700, cursor: generating ? "wait" : "pointer",
              fontFamily: "'Space Grotesk'", opacity: generating ? 0.7 : 1,
            }}>
              {generating ? "⏳ メッセージ生成中..." : "✨ メッセージ一括生成"}
            </button>
            <button disabled style={{
              background: "rgba(45,209,122,0.1)", color: "#2dd17a", border: "1px solid rgba(45,209,122,0.2)",
              borderRadius: "10px", padding: "8px 18px", fontSize: "12px", fontWeight: 700,
              cursor: "not-allowed", fontFamily: "'Space Grotesk'", opacity: 0.6,
            }}>
              🚀 一括送信（準備中）
            </button>
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
    </div>
  );
}
