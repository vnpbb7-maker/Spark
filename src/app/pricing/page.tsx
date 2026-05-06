"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const PLANS = [
  {
    key: "free",
    name: "Free",
    price: "$0",
    per: "/月",
    desc: "まず試したい方へ",
    features: [
      "Reddit・Yahoo知恵袋・note.com",
      "1キャンペーンあたり10ターゲット",
      "コメント生成（手動投稿）",
      "キャンペーン1つ",
    ],
    cta: "無料で始める",
    featured: false,
    route: "/campaigns/new",
  },
  {
    key: "starter",
    name: "Starter",
    price: "$29",
    per: "/月",
    desc: "個人クリエイター向け",
    features: [
      "Reddit・note・Instagram・X・Yahoo知恵袋",
      "1日100ターゲット",
      "コメント生成（手動投稿）",
      "キャンペーン5つ",
    ],
    cta: "Starter を始める",
    featured: false,
    route: null,
  },
  {
    key: "growth",
    name: "Growth",
    price: "$99",
    per: "/月",
    desc: "一番人気",
    features: [
      "全プラットフォーム対応",
      "LinkedIn・Web全体を含む",
      "1日1,000ターゲット",
      "自動コメント投稿",
      "半自動→全自動切り替え",
      "公開連絡先の自動抽出",
      "Excelエクスポート",
      "キャンペーン無制限",
    ],
    cta: "Growth を始める",
    featured: true,
    route: null,
  },
  {
    key: "agency",
    name: "Agency",
    price: "$999",
    per: "/月",
    desc: "代理店・大規模向け",
    features: [
      "Growth全機能",
      "複数クライアント管理",
      "ホワイトラベルUI",
      "API直接アクセス",
      "無制限ターゲット",
      "無制限キャンペーン",
    ],
    cta: "お問い合わせ",
    featured: false,
    route: null,
  },
];

export default function PricingPage() {
  const router = useRouter();
  const [user, setUser] = useState<{ id: string } | null>(null);
  const [currentPlan, setCurrentPlan] = useState("free");

  useEffect(() => {
    const fetchUser = async () => {
      const supabase = createClient();
      const { data: { user: u } } = await supabase.auth.getUser();
      if (u) {
        setUser(u);
        const { data: sub } = await supabase
          .from("subscriptions")
          .select("plan")
          .eq("user_id", u.id)
          .maybeSingle();
        setCurrentPlan(sub?.plan || "free");
      }
    };
    fetchUser();
  }, []);

  const handlePlanClick = async (plan: typeof PLANS[number]) => {
    if (plan.key === "free") {
      router.push("/campaigns/new");
      return;
    }
    if (!user) {
      router.push("/auth/login");
      return;
    }
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan: plan.key,
          successUrl: `${window.location.origin}/dashboard?success=true`,
          cancelUrl: `${window.location.origin}/pricing`,
        }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        alert(data.error || "チェックアウトの作成に失敗しました");
      }
    } catch {
      alert("エラーが発生しました。もう一度お試しください。");
    }
  };

  return (
    <div style={{ width: "100vw", minHeight: "100vh", background: "#0d0d1a", color: "#f0efe8", fontFamily: "DM Sans, sans-serif", overflowX: "hidden" }}>
      {/* Nav */}
      <nav style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 48px", borderBottom: "0.5px solid rgba(255,255,255,0.07)" }}>
        <a href="/" style={{ fontFamily: "Space Grotesk", fontWeight: 700, fontSize: 22, color: "#f0efe8", textDecoration: "none" }}>
          ⚡ SPARK
        </a>
        <button
          onClick={() => router.push(user ? "/dashboard" : "/auth/login")}
          style={{ background: "#ff6b35", color: "#fff", border: "none", borderRadius: 20, padding: "8px 20px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}
        >
          {user ? "ダッシュボード" : "ログイン"}
        </button>
      </nav>

      {/* Header */}
      <div style={{ textAlign: "center", padding: "80px 24px 48px" }}>
        <div style={{ fontSize: 11, color: "#ff6b35", letterSpacing: 2, textTransform: "uppercase", marginBottom: 12 }}>料金プラン</div>
        <h1 style={{ fontFamily: "Space Grotesk", fontSize: "clamp(28px, 5vw, 48px)", fontWeight: 700, marginBottom: 16 }}>
          あなたに合ったプランを選ぼう
        </h1>
        <p style={{ fontSize: 16, color: "rgba(240,239,232,0.5)", maxWidth: 500, margin: "0 auto" }}>
          スタートアップから代理店まで、規模に合わせて選べます
        </p>
      </div>

      {/* Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16, width: "100%", maxWidth: 1200, margin: "0 auto", padding: "0 24px 80px" }}>
        {PLANS.map((plan) => {
          const isCurrent = plan.key === currentPlan;
          return (
            <div
              key={plan.key}
              style={{
                background: plan.featured ? "rgba(255,107,53,0.05)" : "#13132a",
                border: plan.featured ? "1px solid #ff6b35" : isCurrent ? "1px solid rgba(45,209,122,0.4)" : "0.5px solid rgba(255,255,255,0.07)",
                borderRadius: 16,
                padding: 28,
                position: "relative",
                display: "flex",
                flexDirection: "column",
              }}
            >
              {plan.featured && (
                <div style={{ position: "absolute", top: -12, left: "50%", transform: "translateX(-50%)", background: "#ff6b35", color: "#fff", fontSize: 10, fontWeight: 600, padding: "4px 14px", borderRadius: 20, whiteSpace: "nowrap" }}>
                  🔥 一番人気
                </div>
              )}
              {isCurrent && (
                <div style={{ position: "absolute", top: -12, left: "50%", transform: "translateX(-50%)", background: "#2dd17a", color: "#0d0d1a", fontSize: 10, fontWeight: 600, padding: "4px 14px", borderRadius: 20, whiteSpace: "nowrap" }}>
                  ✓ 現在のプラン
                </div>
              )}
              <div style={{ fontSize: 12, color: "rgba(240,239,232,0.5)", marginBottom: 8 }}>{plan.desc}</div>
              <div style={{ fontFamily: "Space Grotesk", fontSize: 18, fontWeight: 600, marginBottom: 4 }}>{plan.name}</div>
              <div style={{ fontFamily: "Space Grotesk", fontSize: 42, fontWeight: 700, marginBottom: 4 }}>
                {plan.price}<span style={{ fontSize: 14, fontWeight: 400, color: "rgba(240,239,232,0.5)" }}>{plan.per}</span>
              </div>
              <ul style={{ listStyle: "none", padding: 0, margin: "16px 0 24px", display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
                {plan.features.map((f) => (
                  <li key={f} style={{ fontSize: 13, color: "rgba(240,239,232,0.6)", display: "flex", alignItems: "flex-start", gap: 8 }}>
                    <span style={{ color: "#2dd17a" }}>✓</span> {f}
                  </li>
                ))}
              </ul>
              <button
                onClick={() => handlePlanClick(plan)}
                disabled={isCurrent}
                style={{
                  width: "100%",
                  padding: "12px",
                  borderRadius: 10,
                  border: plan.featured ? "none" : "0.5px solid rgba(255,255,255,0.2)",
                  background: isCurrent ? "rgba(45,209,122,0.15)" : plan.featured ? "#ff6b35" : "transparent",
                  color: isCurrent ? "#2dd17a" : plan.featured ? "#fff" : "rgba(240,239,232,0.6)",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: isCurrent ? "default" : "pointer",
                  fontFamily: "DM Sans",
                  transition: "all 0.2s",
                }}
              >
                {isCurrent ? "現在のプラン" : plan.cta}
              </button>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <footer style={{ padding: "24px 48px", borderTop: "0.5px solid rgba(255,255,255,0.07)", display: "flex", justifyContent: "space-between", fontSize: 12, color: "rgba(240,239,232,0.3)" }}>
        <div>⚡ SPARK</div>
        <div>© 2025 SPARK. AI Growth Engine.</div>
      </footer>
    </div>
  );
}
