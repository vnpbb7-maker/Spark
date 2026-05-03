"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const PLATFORMS = [
  { id: "twitter", name: "X (Twitter)", icon: "𝕏", color: "#1d9bf0", fields: [{ key: "username", label: "ユーザー名" }, { key: "password", label: "パスワード" }] },
  { id: "reddit", name: "Reddit", icon: "🤖", color: "#ff4500", fields: [{ key: "username", label: "ユーザー名" }, { key: "password", label: "パスワード" }] },
  { id: "linkedin", name: "LinkedIn", icon: "in", color: "#0a66c2", fields: [{ key: "email", label: "メールアドレス" }, { key: "password", label: "パスワード" }] },
  { id: "tiktok", name: "TikTok", icon: "♪", color: "#ff0050", fields: [{ key: "username", label: "ユーザー名" }, { key: "password", label: "パスワード" }] },
  { id: "instagram", name: "Instagram", icon: "◈", color: "#e1306c", fields: [{ key: "username", label: "ユーザー名" }, { key: "password", label: "パスワード" }] },
  { id: "facebook", name: "Facebook", icon: "f", color: "#1877f2", fields: [{ key: "email", label: "メールアドレス" }, { key: "password", label: "パスワード" }] },
];

const DELAY_PRESETS = [
  { id: "conservative", label: "保守的", desc: "間隔: 60〜180秒", min: 60, max: 180 },
  { id: "balanced", label: "バランス（推奨）", desc: "間隔: 30〜90秒", min: 30, max: 90 },
  { id: "aggressive", label: "アグレッシブ", desc: "間隔: 10〜30秒", min: 10, max: 30 },
];

export default function SettingsPage() {
  const router = useRouter();
  const [creds, setCreds] = useState<Record<string, Record<string, string>>>({});
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState<string | null>(null);
  const [delayPreset, setDelayPreset] = useState("balanced");
  const [loading, setLoading] = useState(true);

  const fetchCreds = useCallback(async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push("/auth/login"); return; }
    const { data } = await supabase.from("platform_credentials").select("*").eq("user_id", user.id);
    const map: Record<string, Record<string, string>> = {};
    const savedSet = new Set<string>();
    (data || []).forEach((c: Record<string, unknown>) => {
      map[c.platform as string] = c.credentials as Record<string, string>;
      savedSet.add(c.platform as string);
    });
    setCreds(map);
    setSaved(savedSet);
    setLoading(false);
  }, [router]);

  useEffect(() => { fetchCreds(); }, [fetchCreds]);

  const updateField = (platform: string, field: string, value: string) => {
    setCreds((prev) => ({ ...prev, [platform]: { ...(prev[platform] || {}), [field]: value } }));
  };

  const savePlatform = async (platformId: string) => {
    setSaving(platformId);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const credentials = creds[platformId] || {};
    await supabase.from("platform_credentials").upsert({ user_id: user.id, platform: platformId, credentials }, { onConflict: "user_id,platform" });
    setSaved((prev) => new Set([...prev, platformId]));
    setSaving(null);
  };

  const testConnection = async (platformId: string) => {
    const res = await fetch("/api/platforms/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ platform: platformId }),
    });
    const data = await res.json();
    if (data.success) {
      alert(`✅ ${platformId} の接続に成功しました`);
    } else {
      alert(`❌ 失敗: ${data.error}`);
    }
  };

  if (loading) return <div style={{ minHeight: "100vh", background: "#0d0d1a", display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(240,239,232,0.3)" }}>読み込み中...</div>;

  return (
    <div style={{ minHeight: "100vh", background: "#0d0d1a", color: "#f0efe8" }}>
      <div style={{ borderBottom: "1px solid rgba(255,255,255,0.07)", padding: "16px 24px" }}>
        <div style={{ maxWidth: "900px", margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            <a href="/dashboard" style={{ color: "rgba(240,239,232,0.4)", textDecoration: "none", fontSize: "14px" }}>← ダッシュボード</a>
            <h1 style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: "20px" }}>⚙️ 設定</h1>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: "900px", margin: "0 auto", padding: "32px 24px" }}>
        {/* Platform credentials */}
        <h2 style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: "18px", marginBottom: "20px" }}>プラットフォーム認証情報</h2>
        <p style={{ fontSize: "13px", color: "rgba(240,239,232,0.4)", marginBottom: "24px" }}>自動コメント投稿に使用するアカウント情報を設定してください。情報は暗号化して保存されます。</p>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "16px", marginBottom: "48px" }}>
          {PLATFORMS.map((p) => {
            const isSaved = saved.has(p.id);
            return (
              <div key={p.id} style={{ background: "#13132a", border: `1px solid ${isSaved ? "rgba(45,209,122,0.3)" : "rgba(255,255,255,0.07)"}`, borderRadius: "16px", padding: "24px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <span style={{ fontSize: "20px", fontWeight: 700, color: p.color }}>{p.icon}</span>
                    <span style={{ fontSize: "15px", fontWeight: 600 }}>{p.name}</span>
                  </div>
                  <span style={{ fontSize: "11px", fontWeight: 600, color: isSaved ? "#2dd17a" : "rgba(240,239,232,0.3)" }}>
                    {isSaved ? "🟢 接続済み" : "⚫ 未接続"}
                  </span>
                </div>
                {p.fields.map((f) => (
                  <div key={f.key} style={{ marginBottom: "12px" }}>
                    <label style={{ display: "block", fontSize: "12px", color: "rgba(240,239,232,0.4)", marginBottom: "4px" }}>{f.label}</label>
                    <input
                      type={f.key === "password" ? "password" : "text"}
                      value={(creds[p.id] || {})[f.key] || ""}
                      onChange={(e) => updateField(p.id, f.key, e.target.value)}
                      style={{ width: "100%", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", padding: "10px 12px", color: "#f0efe8", fontSize: "13px", outline: "none", boxSizing: "border-box" }}
                    />
                  </div>
                ))}
                <div style={{ display: "flex", gap: "8px" }}>
                  <button onClick={() => savePlatform(p.id)} disabled={saving === p.id} style={{ flex: 1, padding: "10px", background: saving === p.id ? "rgba(255,107,53,0.3)" : "#ff6b35", color: "#fff", border: "none", borderRadius: "10px", fontSize: "13px", fontWeight: 600, cursor: "pointer" }}>
                    {saving === p.id ? "保存中..." : "保存"}
                  </button>
                  {isSaved && (
                    <button onClick={() => testConnection(p.id)} style={{ background: "transparent", border: "0.5px solid rgba(255,255,255,0.15)", borderRadius: 8, padding: "6px 12px", fontSize: 12, color: "rgba(240,239,232,0.5)", cursor: "pointer", fontFamily: "DM Sans", whiteSpace: "nowrap" }}>
                      🔗 接続テスト
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Safety settings */}
        <h2 style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: "18px", marginBottom: "20px" }}>安全設定</h2>
        <div style={{ background: "#13132a", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "16px", padding: "24px", marginBottom: "24px" }}>
          <h3 style={{ fontSize: "15px", fontWeight: 600, marginBottom: "16px" }}>Bot検知回避レベル</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {DELAY_PRESETS.map((d) => (
              <button key={d.id} onClick={() => setDelayPreset(d.id)} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "14px 18px", background: delayPreset === d.id ? "rgba(255,107,53,0.1)" : "rgba(255,255,255,0.03)", border: `1px solid ${delayPreset === d.id ? "rgba(255,107,53,0.4)" : "rgba(255,255,255,0.07)"}`, borderRadius: "12px", cursor: "pointer", textAlign: "left" }}>
                <span style={{ width: "16px", height: "16px", borderRadius: "50%", border: `2px solid ${delayPreset === d.id ? "#ff6b35" : "rgba(255,255,255,0.2)"}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {delayPreset === d.id && <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#ff6b35" }} />}
                </span>
                <div>
                  <div style={{ fontSize: "14px", fontWeight: 600, color: delayPreset === d.id ? "#ff6b35" : "#f0efe8" }}>{d.label}</div>
                  <div style={{ fontSize: "12px", color: "rgba(240,239,232,0.4)" }}>{d.desc}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
