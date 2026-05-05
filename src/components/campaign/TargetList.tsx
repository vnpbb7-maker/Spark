"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Target = {
  id: string;
  platform: string;
  username: string;
  post_url: string | null;
  post_content: string | null;
  match_score: number;
  match_reason: string | null;
  comment?: {
    id: string;
    content: string;
    approach: string | null;
    approved: boolean;
    posted_at: string | null;
    response_text: string | null;
  };
};

const PLATFORM_ICONS: Record<string, { icon: string; color: string }> = {
  twitter: { icon: "𝕏", color: "#1d9bf0" },
  reddit: { icon: "🤖", color: "#ff4500" },
  linkedin: { icon: "in", color: "#0a66c2" },
  tiktok: { icon: "♪", color: "#ff0050" },
  instagram: { icon: "◈", color: "#e1306c" },
  facebook: { icon: "f", color: "#1877f2" },
};

type Props = {
  targets: Target[];
  tab: "pending" | "posted" | "replied";
  onTabChange: (tab: "pending" | "posted" | "replied") => void;
  pendingCount: number;
  onRefresh: () => void;
};

export default function TargetList({ targets, tab, onTabChange, pendingCount, onRefresh }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const s = new Set(prev);
      s.has(id) ? s.delete(id) : s.add(id);
      return s;
    });
  };

  const approveComment = async (commentId: string, content?: string) => {
    const supabase = createClient();
    const update: Record<string, unknown> = { approved: true, approved_at: new Date().toISOString() };
    if (content) update.content = content;
    await supabase.from("comments").update(update).eq("id", commentId);

    // 投稿リクエストを送る
    fetch("/api/comments/post", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comment_id: commentId }),
    })
      .then((r) => r.json())
      .then((d) => console.log("Post result:", d))
      .catch((err) => console.error("Post error:", err));

    onRefresh();
  };

  const rejectTarget = async (targetId: string) => {
    const supabase = createClient();
    await supabase.from("targets").update({ status: "rejected" }).eq("id", targetId);
    onRefresh();
  };

  const bulkApprove = async () => {
    for (const t of targets.filter((t) => selected.has(t.id) && t.comment)) {
      if (t.comment) await approveComment(t.comment.id);
    }
    setSelected(new Set());
    onRefresh();
  };

  const scoreColor = (score: number) => score >= 80 ? "#2dd17a" : "#ff6b35";

  const tabs = [
    { id: "pending" as const, label: `承認待ち(${pendingCount})` },
    { id: "posted" as const, label: "投稿済み" },
    { id: "replied" as const, label: "返信あり" },
  ];

  return (
    <div>
      {/* Tabs */}
      <div style={{ display: "flex", gap: "0", marginBottom: "20px", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
        {tabs.map((t) => (
          <button key={t.id} onClick={() => onTabChange(t.id)} style={{ padding: "12px 20px", background: "none", border: "none", borderBottom: tab === t.id ? "2px solid #ff6b35" : "2px solid transparent", color: tab === t.id ? "#ff6b35" : "rgba(240,239,232,0.4)", fontSize: "14px", fontWeight: tab === t.id ? 600 : 400, cursor: "pointer" }}>{t.label}</button>
        ))}
      </div>

      {/* Bulk action bar */}
      {tab === "pending" && selected.size > 0 && (
        <div style={{ display: "flex", gap: "12px", marginBottom: "16px", padding: "12px 16px", background: "rgba(255,107,53,0.08)", borderRadius: "12px", border: "1px solid rgba(255,107,53,0.2)" }}>
          <button onClick={bulkApprove} style={{ background: "#2dd17a", color: "#fff", border: "none", borderRadius: "8px", padding: "8px 16px", fontSize: "13px", fontWeight: 600, cursor: "pointer" }}>{selected.size}件を一括承認</button>
          <button onClick={() => setSelected(new Set())} style={{ background: "none", border: "none", color: "rgba(240,239,232,0.4)", fontSize: "13px", cursor: "pointer" }}>全件却下</button>
        </div>
      )}

      {/* Target cards */}
      {targets.length === 0 ? (
        <div style={{ textAlign: "center", padding: "60px 20px", color: "rgba(240,239,232,0.2)", fontSize: "14px" }}>データがありません</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {targets.map((t) => {
            const pi = PLATFORM_ICONS[t.platform] || { icon: "?", color: "#888" };
            const isPosted = t.comment?.posted_at;
            const hasResponse = t.comment?.response_text;
            return (
              <div key={t.id} style={{ background: "#13132a", border: `1px solid ${hasResponse ? "rgba(255,107,53,0.3)" : "rgba(255,255,255,0.07)"}`, borderRadius: "14px", padding: "20px" }}>
                {/* Header */}
                <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "14px" }}>
                  {tab === "pending" && (
                    <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggleSelect(t.id)} style={{ accentColor: "#ff6b35" }} />
                  )}
                  <span style={{ fontSize: "18px", fontWeight: 700, color: pi.color }}>{pi.icon}</span>
                  <span style={{ fontSize: "14px", fontWeight: 600, color: "#f0efe8" }}>@{t.username}</span>
                  <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "8px" }}>
                    <div style={{ width: "60px", height: "6px", borderRadius: "3px", background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
                      <div style={{ width: `${t.match_score}%`, height: "100%", borderRadius: "3px", background: scoreColor(t.match_score) }} />
                    </div>
                    <span style={{ fontSize: "12px", fontWeight: 700, color: scoreColor(t.match_score) }}>{t.match_score}%</span>
                  </div>
                </div>

                {/* Post content */}
                {t.post_content && (
                  <div style={{ background: "rgba(255,255,255,0.03)", borderLeft: "3px solid rgba(255,255,255,0.1)", borderRadius: "0 8px 8px 0", padding: "12px 16px", marginBottom: "14px", fontSize: "13px", color: "rgba(240,239,232,0.5)", lineHeight: 1.5 }}>
                    {t.post_content}
                    {t.post_url && <a href={t.post_url} target="_blank" rel="noopener" style={{ display: "block", marginTop: "8px", fontSize: "11px", color: "#ff6b35" }}>元の投稿を見る →</a>}
                  </div>
                )}

                {/* Comment */}
                {t.comment && (
                  <div style={{ marginBottom: "14px" }}>
                    {editingId === t.id ? (
                      <textarea value={editContent} onChange={(e) => setEditContent(e.target.value)} rows={3} style={{ width: "100%", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,107,53,0.3)", borderRadius: "10px", padding: "12px", color: "#f0efe8", fontSize: "13px", resize: "vertical", outline: "none", boxSizing: "border-box" }} />
                    ) : (
                      <div style={{ fontSize: "13px", color: "#f0efe8", lineHeight: 1.5, padding: "12px 16px", background: "rgba(255,107,53,0.04)", borderRadius: "10px", border: "1px solid rgba(255,107,53,0.15)" }}>{t.comment.content}</div>
                    )}
                    {t.comment.approach && <p style={{ fontSize: "11px", color: "rgba(240,239,232,0.3)", fontStyle: "italic", marginTop: "6px" }}>AI意図: {t.comment.approach}</p>}
                  </div>
                )}

                {/* Response */}
                {hasResponse && (
                  <div style={{ background: "rgba(255,107,53,0.06)", border: "1px solid rgba(255,107,53,0.2)", borderRadius: "10px", padding: "12px 16px", marginBottom: "14px" }}>
                    <p style={{ fontSize: "11px", color: "#ff6b35", fontWeight: 600, marginBottom: "4px" }}>💬 返信</p>
                    <p style={{ fontSize: "13px", color: "rgba(240,239,232,0.6)" }}>{t.comment?.response_text}</p>
                  </div>
                )}

                {/* Actions */}
                {tab === "pending" && t.comment && !isPosted && (
                  <div style={{ display: "flex", gap: "10px" }}>
                    {editingId === t.id ? (
                      <button onClick={() => { approveComment(t.comment!.id, editContent); setEditingId(null); }} style={{ background: "#2dd17a", color: "#fff", border: "none", borderRadius: "8px", padding: "8px 16px", fontSize: "13px", fontWeight: 600, cursor: "pointer" }}>✓ 保存して承認</button>
                    ) : (
                      <button onClick={() => approveComment(t.comment!.id)} style={{ background: "#2dd17a", color: "#fff", border: "none", borderRadius: "8px", padding: "8px 16px", fontSize: "13px", fontWeight: 600, cursor: "pointer" }}>✓ 承認して投稿</button>
                    )}
                    <button onClick={() => rejectTarget(t.id)} style={{ background: "none", border: "none", color: "#ff3b30", fontSize: "13px", cursor: "pointer" }}>✗ 却下</button>
                    <button onClick={() => { setEditingId(t.id); setEditContent(t.comment?.content || ""); }} style={{ background: "none", border: "none", color: "rgba(240,239,232,0.4)", fontSize: "13px", cursor: "pointer" }}>✏ 編集</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
