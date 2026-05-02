"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";


export default function LoginPage() {
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirect") || "/dashboard";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleGoogleLogin = async () => {
    setLoading(true);
    setError("");
    const supabase = createClient();
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback?redirect=${encodeURIComponent(redirectTo)}`,
      },
    });
    if (error) {
      setError(error.message);
      setLoading(false);
    }
  };

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    console.log("login attempt:", email, password.length);
    setLoading(true);
    setError("");

    if (!email || !password) {
      setError("メールアドレスとパスワードを入力してください");
      setLoading(false);
      return;
    }

    const supabase = createClient();
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    console.log("login success:", data.user?.email);
    window.location.href = redirectTo;
  };

  const handleSignUp = async () => {
    if (!email || !password) {
      setError("メールアドレスとパスワードを入力してください");
      return;
    }
    setLoading(true);
    setError("");
    const supabase = createClient();
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback`,
      },
    });
    if (error) {
      setError(error.message);
    } else {
      setError("");
      alert("確認メールを送信しました。メールを確認してください。");
    }
    setLoading(false);
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0d0d1a",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        position: "relative",
      }}
    >


      {/* Login card */}
      <div
        style={{
          position: "relative",
          zIndex: 10,
          width: "100%",
          maxWidth: "420px",
          background: "#13132a",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: "20px",
          padding: "48px 36px",
          boxShadow:
            "0 0 80px rgba(255,107,53,0.08), 0 20px 60px rgba(0,0,0,0.5)",
        }}
      >
        {/* Logo */}
        <div
          style={{
            textAlign: "center",
            marginBottom: "32px",
          }}
        >
          <div
            style={{
              fontSize: "28px",
              fontWeight: 700,
              fontFamily: "'Space Grotesk', sans-serif",
              color: "#f0efe8",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "8px",
            }}
          >
            <span style={{ color: "#ff6b35", fontSize: "32px" }}>⚡</span>
            SPARK
          </div>
          <p
            style={{
              color: "rgba(240,239,232,0.5)",
              fontSize: "14px",
              marginTop: "8px",
            }}
          >
            SPARKにログイン
          </p>
        </div>

        {/* Error */}
        {error && (
          <div
            style={{
              background: "rgba(255,59,48,0.1)",
              border: "1px solid rgba(255,59,48,0.3)",
              borderRadius: "12px",
              padding: "12px 16px",
              marginBottom: "20px",
              color: "#ff3b30",
              fontSize: "13px",
            }}
          >
            {error}
          </div>
        )}

        {/* Google Login */}
        <button
          type="button"
          onClick={handleGoogleLogin}
          disabled={loading}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "10px",
            background: "#ffffff",
            color: "#333",
            border: "none",
            borderRadius: "12px",
            padding: "14px 20px",
            fontSize: "15px",
            fontWeight: 600,
            cursor: loading ? "not-allowed" : "pointer",
            opacity: loading ? 0.7 : 1,
            transition: "all 0.2s",
            marginBottom: "24px",
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24">
            <path
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
              fill="#4285F4"
            />
            <path
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              fill="#34A853"
            />
            <path
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              fill="#FBBC05"
            />
            <path
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              fill="#EA4335"
            />
          </svg>
          Googleでログイン
        </button>

        {/* Divider */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "16px",
            marginBottom: "24px",
          }}
        >
          <div
            style={{
              flex: 1,
              height: "1px",
              background: "rgba(255,255,255,0.1)",
            }}
          />
          <span
            style={{
              color: "rgba(240,239,232,0.3)",
              fontSize: "12px",
              whiteSpace: "nowrap",
            }}
          >
            または
          </span>
          <div
            style={{
              flex: 1,
              height: "1px",
              background: "rgba(255,255,255,0.1)",
            }}
          />
        </div>

        {/* Email/Password form */}
        <form onSubmit={handleEmailLogin}>
          <div style={{ marginBottom: "16px" }}>
            <label
              style={{
                display: "block",
                color: "rgba(240,239,232,0.5)",
                fontSize: "13px",
                marginBottom: "6px",
              }}
            >
              メールアドレス
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              style={{
                width: "100%",
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: "10px",
                padding: "12px 16px",
                color: "#f0efe8",
                fontSize: "14px",
                outline: "none",
                transition: "border-color 0.2s",
                boxSizing: "border-box",
              }}
            />
          </div>
          <div style={{ marginBottom: "24px" }}>
            <label
              style={{
                display: "block",
                color: "rgba(240,239,232,0.5)",
                fontSize: "13px",
                marginBottom: "6px",
              }}
            >
              パスワード
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              style={{
                width: "100%",
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: "10px",
                padding: "12px 16px",
                color: "#f0efe8",
                fontSize: "14px",
                outline: "none",
                transition: "border-color 0.2s",
                boxSizing: "border-box",
              }}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{
              width: "100%",
              background: "#ff6b35",
              color: "#fff",
              border: "none",
              borderRadius: "12px",
              padding: "14px 20px",
              fontSize: "15px",
              fontWeight: 700,
              fontFamily: "'Space Grotesk', sans-serif",
              cursor: loading ? "not-allowed" : "pointer",
              opacity: loading ? 0.7 : 1,
              boxShadow: "0 0 20px rgba(255,107,53,0.35)",
              transition: "all 0.2s",
              marginBottom: "12px",
            }}
          >
            {loading ? "ログイン中..." : "ログイン"}
          </button>
        </form>

        {/* Sign up link */}
        <div style={{ textAlign: "center", marginTop: "16px" }}>
          <button
            onClick={handleSignUp}
            disabled={loading}
            style={{
              background: "none",
              border: "none",
              color: "#ff6b35",
              fontSize: "13px",
              cursor: "pointer",
              textDecoration: "underline",
              textUnderlineOffset: "3px",
            }}
          >
            アカウントをお持ちでない方はこちら
          </button>
        </div>
      </div>
    </div>
  );
}
