"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function AnalyticsPage() {
  const router = useRouter();
  const [stats, setStats] = useState({
    totalTargets: 0,
    totalComments: 0,
    approvedComments: 0,
    postedComments: 0,
  });
  const [postedComments, setPostedComments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.push("/auth/login");
        return;
      }

      // キャンペーンID一覧を取得
      const { data: campaigns } = await supabase
        .from("campaigns")
        .select("id")
        .eq("user_id", user.id);

      const campaignIds = campaigns?.map((c) => c.id) || [];

      if (campaignIds.length === 0) {
        setLoading(false);
        return;
      }

      // 統計データ
      const { count: targetCount } = await supabase
        .from("targets")
        .select("*", { count: "exact", head: true })
        .in("campaign_id", campaignIds);

      const { count: commentCount } = await supabase
        .from("comments")
        .select("*", { count: "exact", head: true })
        .in("campaign_id", campaignIds);

      const { count: approvedCount } = await supabase
        .from("comments")
        .select("*", { count: "exact", head: true })
        .in("campaign_id", campaignIds)
        .eq("approved", true);

      const { count: postedCount } = await supabase
        .from("comments")
        .select("*", { count: "exact", head: true })
        .in("campaign_id", campaignIds)
        .not("posted_at", "is", null);

      setStats({
        totalTargets: targetCount || 0,
        totalComments: commentCount || 0,
        approvedComments: approvedCount || 0,
        postedComments: postedCount || 0,
      });

      // 投稿済みコメント一覧
      const { data: posted } = await supabase
        .from("comments")
        .select("*, targets(username, post_url, platform)")
        .in("campaign_id", campaignIds)
        .not("posted_at", "is", null)
        .order("posted_at", { ascending: false })
        .limit(20);

      setPostedComments(posted || []);
      setLoading(false);
    };
    fetchData();
  }, [router]);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0d0d1a",
        color: "#f0efe8",
        fontFamily: "DM Sans, sans-serif",
        padding: 32,
      }}
    >
      <div style={{ maxWidth: 900, margin: "0 auto" }}>
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
            アナリティクス
          </h1>
        </div>

        {/* KPI */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 16,
            marginBottom: 32,
          }}
        >
          {[
            {
              label: "発見ターゲット",
              value: stats.totalTargets,
              color: "#60a5fa",
            },
            {
              label: "コメント生成",
              value: stats.totalComments,
              color: "#f59e0b",
            },
            {
              label: "承認済み",
              value: stats.approvedComments,
              color: "#a78bfa",
            },
            {
              label: "投稿済み",
              value: stats.postedComments,
              color: "#2dd17a",
            },
          ].map((kpi) => (
            <div
              key={kpi.label}
              style={{
                background: "#13132a",
                border: "0.5px solid rgba(255,255,255,0.07)",
                borderRadius: 16,
                padding: 20,
                textAlign: "center",
              }}
            >
              <div
                style={{ fontSize: 32, fontWeight: 700, color: kpi.color }}
              >
                {kpi.value}
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: "rgba(240,239,232,0.5)",
                  marginTop: 4,
                }}
              >
                {kpi.label}
              </div>
            </div>
          ))}
        </div>

        {/* 投稿済みコメント一覧 */}
        <h2
          style={{
            fontFamily: "Space Grotesk",
            fontSize: 18,
            fontWeight: 700,
            marginBottom: 16,
          }}
        >
          投稿済みコメント
        </h2>

        {loading ? (
          <div
            style={{
              color: "rgba(240,239,232,0.5)",
              textAlign: "center",
              padding: 40,
            }}
          >
            読み込み中...
          </div>
        ) : postedComments.length === 0 ? (
          <div
            style={{
              background: "#13132a",
              border: "0.5px solid rgba(255,255,255,0.07)",
              borderRadius: 16,
              padding: 40,
              textAlign: "center",
              color: "rgba(240,239,232,0.5)",
            }}
          >
            まだ投稿済みのコメントはありません
          </div>
        ) : (
          postedComments.map((comment) => (
            <div
              key={comment.id}
              style={{
                background: "#13132a",
                border: "0.5px solid rgba(255,255,255,0.07)",
                borderRadius: 16,
                padding: 20,
                marginBottom: 12,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  marginBottom: 8,
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
                  style={{
                    fontSize: 13,
                    color: "rgba(240,239,232,0.5)",
                  }}
                >
                  @{comment.targets?.username}
                </span>
                <span
                  style={{
                    marginLeft: "auto",
                    fontSize: 11,
                    color: "rgba(240,239,232,0.3)",
                  }}
                >
                  {new Date(comment.posted_at).toLocaleString("ja-JP")}
                </span>
              </div>
              <div
                style={{ fontSize: 14, color: "#f0efe8", lineHeight: 1.6 }}
              >
                {comment.content}
              </div>
              {comment.targets?.post_url && (
                <a
                  href={comment.targets.post_url}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    fontSize: 12,
                    color: "#ff6b35",
                    marginTop: 8,
                    display: "block",
                  }}
                >
                  投稿を見る →
                </a>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
