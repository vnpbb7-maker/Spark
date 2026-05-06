"use client";

export const dynamic = "force-dynamic";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { AnalysisResult, CampaignSettings } from "@/types/campaign";
import Step1Input from "@/components/wizard/Step1Input";
import Step2Analysis from "@/components/wizard/Step2Analysis";
import Step3Settings from "@/components/wizard/Step3Settings";
import SparkLoader from "@/components/ui/SparkLoader";

const STEPS = ["プロダクト入力", "分析結果", "キャンペーン設定"];

type ExistingCampaign = {
  id: string;
  product_description: string;
  product_url: string | null;
  target_personas: AnalysisResult | null;
  analysis_cache: AnalysisResult | null;
  platforms: string[];
  created_at: string;
};

function CampaignNewContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialUrl = searchParams.get("url") || "";
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [inputData, setInputData] = useState<{ url?: string; description?: string }>({ url: initialUrl });
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [userPlan, setUserPlan] = useState("free");
  const [existingCampaigns, setExistingCampaigns] = useState<ExistingCampaign[]>([]);
  const [copyFromId, setCopyFromId] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: sub } = await supabase
          .from("subscriptions")
          .select("plan")
          .eq("user_id", user.id)
          .maybeSingle();
        setUserPlan(sub?.plan || "free");

        // Fetch existing campaigns for copy
        const { data: camps } = await supabase
          .from("campaigns")
          .select("id, product_description, product_url, target_personas, analysis_cache, platforms, created_at")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(10);
        if (camps) setExistingCampaigns(camps as ExistingCampaign[]);
      }
    };
    fetchData();

    // Stripe checkout完了後のリダイレクト処理
    const upgraded = searchParams.get("upgraded");
    const returnStep = searchParams.get("step");
    if (upgraded === "true") {
      setUserPlan("growth");
      if (returnStep) setStep(parseInt(returnStep));
    }
  }, [searchParams]);

  const handleCopyCampaign = (campId: string) => {
    const camp = existingCampaigns.find((c) => c.id === campId);
    if (!camp) return;

    setCopyFromId(campId);
    setInputData({
      url: camp.product_url || undefined,
      description: camp.product_description,
    });

    // Use cached analysis or target_personas
    const cachedAnalysis = camp.analysis_cache || camp.target_personas;
    if (cachedAnalysis) {
      setAnalysis(cachedAnalysis);
      setStep(3); // Skip directly to settings
    } else {
      // No cached analysis — go to step 1 with pre-filled data
      setStep(1);
    }
  };

  const handleAnalyze = async (data: { url?: string; description?: string }) => {
    setInputData(data);
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/campaigns/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "分析に失敗しました");
      }

      const result = await res.json();
      setAnalysis(result);
      setStep(2);
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラーが発生しました");
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async (settings: CampaignSettings) => {
    if (!analysis) return;
    setCreating(true);
    setError("");

    try {
      const res = await fetch("/api/campaigns/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product_url: inputData.url || null,
          product_description: inputData.description || inputData.url || "",
          target_personas: analysis,
          analysis_cache: analysis,
          copied_from: copyFromId || null,
          ...settings,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "作成に失敗しました");
      }

      const result = await res.json();
      window.location.href = result.redirect || "/dashboard";
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラーが発生しました");
      setCreating(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: "#0d0d1a", color: "#f0efe8" }}>
      {/* Header */}
      <div style={{ borderBottom: "1px solid rgba(255,255,255,0.07)", padding: "16px 24px" }}>
        <div style={{ maxWidth: "900px", margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <a href="/" style={{ display: "flex", alignItems: "center", gap: "8px", fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: "20px", color: "#f0efe8", textDecoration: "none" }}>
            <span style={{ color: "#ff6b35", fontSize: "22px" }}>⚡</span> SPARK
          </a>
          <a href="/dashboard" style={{ fontSize: "13px", color: "rgba(240,239,232,0.4)", textDecoration: "none" }}>ダッシュボードへ</a>
        </div>
      </div>

      {/* Step indicator */}
      <div style={{ maxWidth: "500px", margin: "0 auto", padding: "32px 24px 0" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0" }}>
          {STEPS.map((label, i) => {
            const stepNum = i + 1;
            const isActive = step === stepNum;
            const isDone = step > stepNum;
            return (
              <div key={i} style={{ display: "flex", alignItems: "center" }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "6px" }}>
                  <div style={{ width: "32px", height: "32px", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "13px", fontWeight: 700, background: isActive ? "#ff6b35" : isDone ? "rgba(45,209,122,0.2)" : "rgba(255,255,255,0.06)", color: isActive ? "#fff" : isDone ? "#2dd17a" : "rgba(240,239,232,0.3)", border: isActive ? "none" : "1px solid rgba(255,255,255,0.1)", transition: "all 0.3s" }}>
                    {isDone ? "✓" : stepNum}
                  </div>
                  <span style={{ fontSize: "11px", color: isActive ? "#ff6b35" : "rgba(240,239,232,0.3)", fontWeight: isActive ? 600 : 400, whiteSpace: "nowrap" }}>
                    {label}
                  </span>
                </div>
                {i < STEPS.length - 1 && (
                  <div style={{ width: "60px", height: "2px", background: isDone ? "rgba(45,209,122,0.3)" : "rgba(255,255,255,0.07)", margin: "0 8px", marginBottom: "20px" }} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Content */}
      <div style={{ maxWidth: "900px", margin: "0 auto", padding: "40px 24px 80px" }}>
        {/* Error */}
        {error && (
          <div style={{ background: "rgba(255,59,48,0.1)", border: "1px solid rgba(255,59,48,0.3)", borderRadius: "12px", padding: "14px 18px", marginBottom: "24px", color: "#ff3b30", fontSize: "14px", textAlign: "center", maxWidth: "600px", margin: "0 auto 24px" }}>
            {error}
          </div>
        )}

        {loading ? (
          <SparkLoader />
        ) : step === 1 ? (
          <div>
            {/* Copy from existing campaign */}
            {existingCampaigns.length > 0 && (
              <div style={{ maxWidth: "600px", margin: "0 auto 32px" }}>
                <div style={{ background: "#13132a", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "14px", padding: "20px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
                    <span style={{ fontSize: "16px" }}>📋</span>
                    <span style={{ fontSize: "14px", fontWeight: 600, color: "#f0efe8" }}>既存のキャンペーンをコピー</span>
                    <span style={{ fontSize: "11px", color: "rgba(240,239,232,0.35)", marginLeft: "auto" }}>分析をスキップ</span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    {existingCampaigns.slice(0, 5).map((c) => (
                      <button
                        key={c.id}
                        onClick={() => handleCopyCampaign(c.id)}
                        style={{
                          display: "flex", alignItems: "center", gap: "10px", width: "100%",
                          background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)",
                          borderRadius: "10px", padding: "10px 14px", cursor: "pointer", transition: "all 0.2s",
                          textAlign: "left",
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(255,107,53,0.3)"; e.currentTarget.style.background = "rgba(255,107,53,0.05)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.07)"; e.currentTarget.style.background = "rgba(255,255,255,0.03)"; }}
                      >
                        <span style={{ fontSize: "12px", color: "rgba(240,239,232,0.6)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {c.product_description?.slice(0, 40) || c.product_url || "—"}
                        </span>
                        <span style={{ fontSize: "10px", color: "rgba(240,239,232,0.25)", flexShrink: 0 }}>
                          {new Date(c.created_at).toLocaleDateString("ja-JP")}
                        </span>
                        <span style={{ fontSize: "11px", color: "#ff6b35", fontWeight: 600, flexShrink: 0 }}>→</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div style={{ textAlign: "center", margin: "16px 0", fontSize: "12px", color: "rgba(240,239,232,0.25)" }}>
                  または新しく分析する ↓
                </div>
              </div>
            )}

            <Step1Input onAnalyze={handleAnalyze} initialUrl={initialUrl} />
          </div>
        ) : step === 2 && analysis ? (
          <Step2Analysis analysis={analysis} onContinue={() => setStep(3)} onBack={() => { setStep(1); setCopyFromId(null); }} userPlan={userPlan} />
        ) : step === 3 && analysis ? (
          <div>
            {copyFromId && (
              <div style={{ maxWidth: "600px", margin: "0 auto 16px", textAlign: "center" }}>
                <span style={{ fontSize: "12px", padding: "4px 12px", borderRadius: "8px", background: "rgba(45,209,122,0.1)", color: "#2dd17a", fontWeight: 600 }}>
                  📋 既存キャンペーンからコピー中 — 分析スキップ済み
                </span>
              </div>
            )}
            <Step3Settings recommendedPlatforms={analysis.recommended_platforms} onSubmit={handleCreate} loading={creating} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function NewCampaignPage() {
  return (
    <Suspense
      fallback={
        <div style={{ minHeight: "100vh", background: "#0d0d1a", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ color: "#ff6b35", fontFamily: "'Space Grotesk', sans-serif", fontSize: "16px" }}>読み込み中...</div>
        </div>
      }
    >
      <CampaignNewContent />
    </Suspense>
  );
}
