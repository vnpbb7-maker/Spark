"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { CampaignSettings } from "@/types/campaign";
import { createClient } from "@/lib/supabase/client";

const PLATFORMS = [
  { id: "twitter", name: "X", icon: "𝕏", color: "#1d9bf0", requiredPlan: "free" },
  { id: "reddit", name: "Reddit", icon: "🤖", color: "#ff4500", requiredPlan: "free" },
  { id: "linkedin", name: "LinkedIn", icon: "in", color: "#0a66c2", requiredPlan: "starter" },
  { id: "tiktok", name: "TikTok", icon: "♪", color: "#ff0050", requiredPlan: "growth" },
  { id: "instagram", name: "Instagram", icon: "◈", color: "#e1306c", requiredPlan: "growth" },
  { id: "facebook", name: "Facebook", icon: "f", color: "#1877f2", requiredPlan: "growth" },
];

const TONES = [
  { id: "casual" as const, label: "カジュアル", desc: "友達に話しかけるような自然なトーン" },
  { id: "professional" as const, label: "プロフェッショナル", desc: "ビジネスライクで信頼感のあるトーン" },
  { id: "empathetic" as const, label: "共感型", desc: "相手の悩みに寄り添う温かいトーン" },
];

const PLAN_ORDER = ["free", "starter", "growth", "agency"];

const PLAN_PRICE: Record<string, string> = {
  starter: "Starterプラン（$99/月）",
  growth: "Growthプラン（$299/月）",
};

function canUsePlatform(platformRequiredPlan: string, userPlan: string): boolean {
  return PLAN_ORDER.indexOf(userPlan) >= PLAN_ORDER.indexOf(platformRequiredPlan);
}

function getPlanLabel(requiredPlan: string): string {
  if (requiredPlan === "starter") return "Starterプラン";
  return "Growthプラン";
}

type Props = {
  recommendedPlatforms: string[];
  onSubmit: (settings: CampaignSettings) => void;
  loading: boolean;
};

export default function Step3Settings({ recommendedPlatforms, onSubmit, loading }: Props) {
  const router = useRouter();
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [dailyLimit, setDailyLimit] = useState(10);
  const [tone, setTone] = useState<CampaignSettings["tone"]>("casual");
  const [autoMode, setAutoMode] = useState(false);
  const [userPlan, setUserPlan] = useState("free");
  const [upgradeModal, setUpgradeModal] = useState<string | null>(null);
  const [targetLanguage, setTargetLanguage] = useState("ja");
  const [requiredKeywords, setRequiredKeywords] = useState("");
  const [minMatchScore, setMinMatchScore] = useState(60);

  useEffect(() => {
    const fetchPlan = async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: sub } = await supabase
          .from("subscriptions")
          .select("plan")
          .eq("user_id", user.id)
          .maybeSingle();
        const plan = sub?.plan || "free";
        setUserPlan(plan);
        if (plan === "growth" || plan === "agency") setDailyLimit(200);
        else if (plan === "starter") setDailyLimit(50);
        else setDailyLimit(10);
      }
    };
    fetchPlan();
  }, []);

  useEffect(() => {
    const allowed = recommendedPlatforms.filter((p) => {
      const plat = PLATFORMS.find((pl) => pl.id === p);
      return plat && canUsePlatform(plat.requiredPlan, userPlan);
    });
    setPlatforms(allowed);
  }, [recommendedPlatforms, userPlan]);

  const handlePlatformClick = (p: typeof PLATFORMS[number]) => {
    if (!canUsePlatform(p.requiredPlan, userPlan)) {
      setUpgradeModal(p.name);
      return;
    }
    setPlatforms((prev) => prev.includes(p.id) ? prev.filter((x) => x !== p.id) : [...prev, p.id]);
  };

  const handleSubmit = () => {
    if (platforms.length === 0) {
      router.push("/pricing");
      return;
    }
    onSubmit({ platforms, daily_limit: dailyLimit, tone, auto_mode: autoMode, target_language: targetLanguage, required_keywords: requiredKeywords, min_match_score: minMatchScore });
  };

  return (
    <div style={{ maxWidth: "600px", margin: "0 auto" }}>
      <h2 style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: "28px", color: "#f0efe8", textAlign: "center", marginBottom: "8px" }}>
        キャンペーン設定
      </h2>
      <p style={{ textAlign: "center", color: "rgba(240,239,232,0.5)", fontSize: "15px", marginBottom: "40px" }}>
        あとは設定を決めて開始するだけ
      </p>

      {/* Platform selection */}
      <div style={{ marginBottom: "36px" }}>
        <h3 style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: "15px", color: "#f0efe8", marginBottom: "12px" }}>プラットフォーム選択</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "10px" }}>
          {PLATFORMS.map((p) => {
            const allowed = canUsePlatform(p.requiredPlan, userPlan);
            const selected = platforms.includes(p.id);
            const recommended = recommendedPlatforms.includes(p.id);
            return (
              <button
                key={p.id}
                onClick={() => handlePlatformClick(p)}
                style={{
                  display: "flex", flexDirection: "column", gap: "6px",
                  padding: "16px", textAlign: "left",
                  background: !allowed ? "rgba(255,255,255,0.02)" : selected ? "rgba(255,107,53,0.1)" : "rgba(255,255,255,0.03)",
                  border: `1px solid ${!allowed ? "rgba(255,255,255,0.05)" : selected ? "rgba(255,107,53,0.4)" : "rgba(255,255,255,0.07)"}`,
                  borderRadius: "14px", cursor: "pointer", transition: "all 0.2s", position: "relative",
                }}
              >
                {/* Row 1: icon + name */}
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <span style={{ fontSize: "18px", fontWeight: 700, color: allowed ? p.color : "rgba(240,239,232,0.25)" }}>
                    {allowed ? p.icon : "🔒"}
                  </span>
                  <span style={{ fontSize: "15px", fontWeight: selected ? 700 : 500, color: allowed ? (selected ? "#f0efe8" : "rgba(240,239,232,0.6)") : "rgba(240,239,232,0.3)" }}>
                    {p.name}
                  </span>
                </div>
                {/* Row 2: badges */}
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                  {recommended && (
                    <span style={{ fontSize: "10px", fontWeight: 600, color: "#2dd17a", background: "rgba(45,209,122,0.1)", padding: "2px 8px", borderRadius: "6px" }}>
                      ✨ AI推奨
                    </span>
                  )}
                  {allowed ? (
                    <span style={{ fontSize: "10px", fontWeight: 600, color: "rgba(240,239,232,0.4)", background: "rgba(255,255,255,0.05)", padding: "2px 8px", borderRadius: "6px" }}>
                      ✓ 無料で使える
                    </span>
                  ) : (
                    <span style={{ fontSize: "10px", fontWeight: 600, color: "#ff6b35", background: "rgba(255,107,53,0.1)", padding: "2px 8px", borderRadius: "6px" }}>
                      🔒 {getPlanLabel(p.requiredPlan)}
                    </span>
                  )}
                </div>
                {/* Row 3: locked CTA */}
                {!allowed && (
                  <div style={{ fontSize: "11px", color: "rgba(255,107,53,0.7)", marginTop: "2px" }}>
                    アップグレードして使う →
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Daily limit slider */}
      <div style={{ marginBottom: "36px" }}>
        <h3 style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: "15px", color: "#f0efe8", marginBottom: "12px" }}>1日の接触数</h3>
        <div style={{ textAlign: "center", marginBottom: "12px" }}>
          <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: "48px", color: "#ff6b35" }}>{dailyLimit}</span>
          <span style={{ fontSize: "16px", color: "rgba(240,239,232,0.4)", marginLeft: "4px" }}>/ 日</span>
        </div>
        <input
          type="range"
          min={10}
          max={userPlan === "free" ? 10 : userPlan === "starter" ? 50 : 200}
          step={10}
          value={dailyLimit}
          onChange={(e) => setDailyLimit(Number(e.target.value))}
          style={{ width: "100%", accentColor: "#ff6b35" }}
          disabled={userPlan === "free"}
        />
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "rgba(240,239,232,0.3)", marginTop: "4px" }}>
          <span>10</span>
          <span>{userPlan === "free" ? "10（Freeプラン）" : userPlan === "starter" ? "50" : "200"}</span>
        </div>
      </div>

      {/* Tone selection */}
      <div style={{ marginBottom: "36px" }}>
        <h3 style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: "15px", color: "#f0efe8", marginBottom: "12px" }}>メッセージトーン</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {TONES.map((t) => (
            <button key={t.id} onClick={() => setTone(t.id)} style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", padding: "16px 18px", background: tone === t.id ? "rgba(255,107,53,0.1)" : "rgba(255,255,255,0.03)", border: `1px solid ${tone === t.id ? "rgba(255,107,53,0.4)" : "rgba(255,255,255,0.07)"}`, borderRadius: "12px", cursor: "pointer", transition: "all 0.2s" }}>
              <span style={{ fontSize: "15px", fontWeight: 600, color: tone === t.id ? "#ff6b35" : "#f0efe8", marginBottom: "4px" }}>{t.label}</span>
              <span style={{ fontSize: "12px", color: "rgba(240,239,232,0.4)" }}>{t.desc}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Auto mode toggle */}
      <div style={{ marginBottom: "40px" }}>
        <h3 style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: "15px", color: "#f0efe8", marginBottom: "12px" }}>承認モード</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <button onClick={() => setAutoMode(false)} style={{ display: "flex", alignItems: "flex-start", gap: "12px", padding: "18px", background: !autoMode ? "rgba(255,107,53,0.1)" : "rgba(255,255,255,0.03)", border: `1px solid ${!autoMode ? "rgba(255,107,53,0.4)" : "rgba(255,255,255,0.07)"}`, borderRadius: "14px", cursor: "pointer", transition: "all 0.2s", textAlign: "left" }}>
            <span style={{ fontSize: "24px" }}>🔶</span>
            <div>
              <div style={{ fontSize: "15px", fontWeight: 600, color: !autoMode ? "#ff6b35" : "#f0efe8", marginBottom: "4px" }}>半自動モード（推奨）</div>
              <div style={{ fontSize: "12px", color: "rgba(240,239,232,0.4)" }}>AIが生成 → あなたが確認 → 投稿</div>
            </div>
          </button>
          <button onClick={() => setAutoMode(true)} style={{ display: "flex", alignItems: "flex-start", gap: "12px", padding: "18px", background: autoMode ? "rgba(45,209,122,0.1)" : "rgba(255,255,255,0.03)", border: `1px solid ${autoMode ? "rgba(45,209,122,0.4)" : "rgba(255,255,255,0.07)"}`, borderRadius: "14px", cursor: "pointer", transition: "all 0.2s", textAlign: "left" }}>
            <span style={{ fontSize: "24px" }}>🟢</span>
            <div>
              <div style={{ fontSize: "15px", fontWeight: 600, color: autoMode ? "#2dd17a" : "#f0efe8", marginBottom: "4px" }}>全自動モード</div>
              <div style={{ fontSize: "12px", color: "rgba(240,239,232,0.4)" }}>AIが全て自動で実行</div>
            </div>
          </button>
        </div>
      </div>

      {/* Language selection */}
      <div style={{ marginBottom: "36px" }}>
        <h3 style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: "15px", color: "#f0efe8", marginBottom: "12px" }}>ターゲットの言語</h3>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {[
            { id: "ja", label: "日本語" },
            { id: "en", label: "英語" },
            { id: "zh", label: "中国語" },
            { id: "ko", label: "韓国語" },
            { id: "any", label: "全言語" },
          ].map((lang) => (
            <button
              key={lang.id}
              onClick={() => setTargetLanguage(lang.id)}
              style={{
                background: targetLanguage === lang.id ? "#ff6b35" : "rgba(255,255,255,0.05)",
                border: targetLanguage === lang.id ? "none" : "0.5px solid rgba(255,255,255,0.15)",
                borderRadius: 20,
                padding: "6px 16px",
                fontSize: 13,
                fontWeight: 600,
                color: targetLanguage === lang.id ? "#fff" : "rgba(240,239,232,0.6)",
                cursor: "pointer",
              }}
            >
              {lang.label}
            </button>
          ))}
        </div>
      </div>

      {/* Required keywords */}
      <div style={{ marginBottom: "36px" }}>
        <h3 style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: "15px", color: "#f0efe8", marginBottom: "4px" }}>コメントに必ず含めるキーワード</h3>
        <div style={{ fontSize: 12, color: "rgba(240,239,232,0.4)", marginBottom: 8 }}>
          例：SPARK, spark-ai.jp, 初期ユーザー獲得
        </div>
        <input
          type="text"
          value={requiredKeywords}
          onChange={(e) => setRequiredKeywords(e.target.value)}
          placeholder="カンマ区切りで入力（例：SPARK, ユーザー獲得）"
          style={{
            width: "100%",
            background: "rgba(255,255,255,0.05)",
            border: "0.5px solid rgba(255,255,255,0.15)",
            borderRadius: 10,
            padding: "10px 14px",
            fontSize: 14,
            color: "#f0efe8",
            fontFamily: "DM Sans",
            outline: "none",
            boxSizing: "border-box",
          }}
        />
      </div>

      {/* Min match score */}
      <div style={{ marginBottom: "36px" }}>
        <h3 style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: "15px", color: "#f0efe8", marginBottom: "8px" }}>
          ターゲットの最低マッチスコア: {minMatchScore}%以上
        </h3>
        <input
          type="range"
          min={30}
          max={90}
          value={minMatchScore}
          onChange={(e) => setMinMatchScore(Number(e.target.value))}
          style={{ width: "100%", accentColor: "#ff6b35" }}
        />
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "rgba(240,239,232,0.4)" }}>
          <span>30%（広く）</span>
          <span>90%（厳密）</span>
        </div>
      </div>

      {/* Submit */}
      <button
        onClick={handleSubmit}
        disabled={loading || platforms.length === 0}
        style={{
          width: "100%", padding: "18px 24px",
          background: platforms.length > 0 ? "#ff6b35" : "rgba(255,107,53,0.3)",
          color: "#fff", border: "none", borderRadius: "14px",
          fontSize: "18px", fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif",
          cursor: platforms.length > 0 && !loading ? "pointer" : "not-allowed",
          boxShadow: platforms.length > 0 ? "0 0 40px rgba(255,107,53,0.35)" : "none",
          transition: "all 0.2s", opacity: loading ? 0.7 : 1,
        }}
      >
        {loading ? "作成中..." : platforms.length > 0 ? "キャンペーン開始 🚀" : "プランをアップグレード"}
      </button>

      {/* Upgrade Modal */}
      {upgradeModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ background: "#13132a", border: "0.5px solid rgba(255,255,255,0.15)", borderRadius: 20, padding: 32, maxWidth: 400, width: "90%", textAlign: "center" }}>
            <div style={{ fontSize: 32, marginBottom: 16 }}>🔒</div>
            <div style={{ fontFamily: "Space Grotesk", fontSize: 18, fontWeight: 700, color: "#f0efe8", marginBottom: 8 }}>
              {upgradeModal}はGrowthプランで利用可能
            </div>
            <div style={{ fontSize: 13, color: "rgba(240,239,232,0.5)", marginBottom: 24, lineHeight: 1.6 }}>
              Growthプラン（$299/月）にアップグレードすると
              全6プラットフォームで自動コメント投稿が使えます。
            </div>
            <button
              onClick={async () => {
                setUpgradeModal(null);
                try {
                  const res = await fetch("/api/stripe/checkout", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      plan: "growth",
                      successUrl: `${window.location.origin}/campaigns/new?upgraded=true&step=3`,
                      cancelUrl: `${window.location.origin}/campaigns/new`,
                    }),
                  });
                  const data = await res.json();
                  if (data.url) {
                    window.location.href = data.url;
                  } else {
                    router.push("/pricing");
                  }
                } catch {
                  router.push("/pricing");
                }
              }}
              style={{ width: "100%", background: "#ff6b35", color: "#fff", border: "none", borderRadius: 10, padding: "12px", fontSize: 14, fontWeight: 600, cursor: "pointer", marginBottom: 10, fontFamily: "DM Sans" }}
            >
              アップグレードする →
            </button>
            <button
              onClick={() => setUpgradeModal(null)}
              style={{ width: "100%", background: "transparent", color: "rgba(240,239,232,0.5)", border: "0.5px solid rgba(255,255,255,0.1)", borderRadius: 10, padding: "12px", fontSize: 14, cursor: "pointer", fontFamily: "DM Sans" }}
            >
              キャンセル
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
