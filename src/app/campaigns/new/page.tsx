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
  // Reset analysis state on fresh mount (prevents SPA stale data)
  useEffect(() => {
    setAnalysis(null);
    setStep(1);
    setError("");
    setInputData({ url: initialUrl });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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


  const handleAnalyze = async (data: { url?: string; description?: string }) => {
    setInputData(data);
    setLoading(true);
    setError("");
    setAnalysis(null);

    try {
      const res = await fetch("/api/campaigns/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        let errMsg = "分析に失敗しました";
        try {
          const err = await res.json();
          errMsg = err.error || errMsg;
        } catch { /* non-JSON error body */ }
        throw new Error(errMsg);
      }

      const result = await res.json();

      // Validate response structure
      if (!result || !Array.isArray(result.personas) || result.personas.length === 0) {
        console.error("[analyze] Invalid response structure:", JSON.stringify(result).slice(0, 500));
        throw new Error("分析結果のフォーマットが不正です。もう一度お試しください。");
      }

      setAnalysis(result);
      setStep(2);
    } catch (e) {
      console.error("[analyze] Error:", e);
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
            <Step1Input onAnalyze={handleAnalyze} initialUrl={initialUrl} />
          </div>
        ) : step === 2 && analysis ? (
          <Step2Analysis analysis={analysis} onContinue={() => setStep(3)} onBack={() => { setStep(1); setAnalysis(null); }} userPlan={userPlan} />
        ) : step === 3 && analysis ? (
          <Step3Settings recommendedPlatforms={analysis.recommended_platforms} onSubmit={handleCreate} loading={creating} />
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
