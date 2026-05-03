"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function ApprovePage() {
  const router = useRouter();
  const [comments, setComments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchComments = async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.push("/auth/login");
        return;
      }

      try {
        const { data, error } = await supabase
          .from("comments")
          .select(`
            *,
            targets (
              username,
              platform,
              post_url,
              post_content,
              match_score
            ),
            campaigns (
              product_url,
              product_description
            )
          `)
          .eq("approved", false)
          .order("created_at", { ascending: false });

        console.log("comments error:", error);
        console.log("comments count:", data?.length);
        setComments(data || []);
      } catch {
        setComments([]);
      }
      setLoading(false);
    };
    fetchComments();
  }, [router]);

  const handleApprove = async (commentId: string) => {
    const supabase = createClient();

    // まずapprovedをtrueに更新
    await supabase
      .from("comments")
      .update({
        approved: true,
        approved_at: new Date().toISOString(),
      })
      .eq("id", commentId);

    // Railwayに投稿リクエストを送る
    try {
      const res = await fetch("/api/comments/post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment_id: commentId }),
      });
      const data = await res.json();

      if (data.success && data.queued) {
        alert("✅ " + (data.message || "承認しました"));
      } else if (data.success) {
        alert("✅ 投稿しました！");
      } else {
        alert(`⚠️ 承認しましたが投稿に失敗: ${data.error}`);
      }
    } catch {
      alert("✅ 承認しました");
    }

    setComments((prev) => prev.filter((c) => c.id !== commentId));
  };

  const handleReject = async (commentId: string) => {
    const supabase = createClient();
    await supabase.from("comments").delete().eq("id", commentId);
    setComments((prev) => prev.filter((c) => c.id !== commentId));
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0d0d1a",
        color: "#f0efe8",
        fontFamily: "DM Sans, sans-serif",
        padding: "32px",
      }}
    >
      <div style={{ maxWidth: 800, margin: "0 auto" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            marginBottom: 32,
          }}
        >
          <button
            onClick={() => router.push("/dashboard")}
            style={{
              background: "transparent",
              border: "0.5px solid rgba(255,255,255,0.15)",
              borderRadius: 8,
              padding: "6px 12px",
              color: "rgba(240,239,232,0.6)",
              cursor: "pointer",
              fontSize: 13,
              fontFamily: "DM Sans",
            }}
          >
            ← ダッシュボード
          </button>
          <h1
            style={{
              fontFamily: "Space Grotesk",
              fontSize: 24,
              fontWeight: 700,
            }}
          >
            承認待ちコメント
          </h1>
          <span
            style={{
              background: "rgba(255,107,53,0.15)",
              color: "#ff6b35",
              borderRadius: 20,
              padding: "3px 12px",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            {comments.length}件
          </span>
        </div>

        {loading && (
          <div
            style={{
              textAlign: "center",
              color: "rgba(240,239,232,0.5)",
              padding: 60,
            }}
          >
            読み込み中...
          </div>
        )}

        {!loading && comments.length === 0 && (
          <div
            style={{
              textAlign: "center",
              color: "rgba(240,239,232,0.5)",
              padding: 60,
              background: "#13132a",
              borderRadius: 16,
              border: "0.5px solid rgba(255,255,255,0.07)",
            }}
          >
            <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>
              承認待ちのコメントはありません
            </div>
            <div style={{ fontSize: 13, marginTop: 8 }}>
              キャンペーンが動き出すとここにコメントが表示されます
            </div>
          </div>
        )}

        {comments.map((comment) => (
          <div
            key={comment.id}
            style={{
              background: "#13132a",
              border: "0.5px solid rgba(255,255,255,0.07)",
              borderRadius: 16,
              padding: 20,
              marginBottom: 16,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                marginBottom: 12,
              }}
            >
              <span
                style={{
                  background: "rgba(255,255,255,0.07)",
                  borderRadius: 8,
                  padding: "3px 10px",
                  fontSize: 12,
                  color: "rgba(240,239,232,0.6)",
                }}
              >
                {comment.platform}
              </span>
              <span
                style={{ fontSize: 13, color: "rgba(240,239,232,0.5)" }}
              >
                @{comment.targets?.username}
              </span>
            </div>

            {comment.targets?.post_content && (
              <div
                style={{
                  background: "rgba(255,255,255,0.03)",
                  border: "0.5px solid rgba(255,255,255,0.07)",
                  borderRadius: 10,
                  padding: 12,
                  fontSize: 13,
                  color: "rgba(240,239,232,0.5)",
                  marginBottom: 12,
                  fontStyle: "italic",
                }}
              >
                &ldquo;{comment.targets.post_content.slice(0, 200)}&rdquo;
              </div>
            )}

            <div
              style={{
                background: "rgba(255,107,53,0.05)",
                border: "0.5px solid rgba(255,107,53,0.2)",
                borderRadius: 10,
                padding: 12,
                fontSize: 14,
                color: "#f0efe8",
                marginBottom: 8,
              }}
            >
              {comment.content}
            </div>

            {comment.approach && (
              <div
                style={{
                  fontSize: 12,
                  color: "rgba(240,239,232,0.4)",
                  fontStyle: "italic",
                  marginBottom: 16,
                }}
              >
                💡 {comment.approach}
              </div>
            )}

            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={() => handleApprove(comment.id)}
                style={{
                  background: "#2dd17a",
                  color: "#fff",
                  border: "none",
                  borderRadius: 10,
                  padding: "10px 20px",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: "DM Sans",
                }}
              >
                ✓ 承認して投稿
              </button>
              <button
                onClick={() => handleReject(comment.id)}
                style={{
                  background: "transparent",
                  color: "rgba(240,239,232,0.5)",
                  border: "0.5px solid rgba(255,255,255,0.15)",
                  borderRadius: 10,
                  padding: "10px 20px",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: "DM Sans",
                }}
              >
                ✗ 却下
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
