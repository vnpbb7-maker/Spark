import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import LogoutButton from "./LogoutButton";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0d0d1a",
        color: "#f0efe8",
        padding: "24px",
      }}
    >
      <div
        style={{
          maxWidth: "900px",
          margin: "0 auto",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "48px",
            paddingTop: "24px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              fontFamily: "'Space Grotesk', sans-serif",
              fontWeight: 700,
              fontSize: "22px",
            }}
          >
            <span style={{ color: "#ff6b35", fontSize: "24px" }}>⚡</span>
            SPARK
          </div>
          <LogoutButton />
        </div>

        {/* Welcome card */}
        <div
          style={{
            background: "#13132a",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: "20px",
            padding: "48px",
            textAlign: "center",
            boxShadow:
              "0 0 80px rgba(255,107,53,0.08), 0 20px 60px rgba(0,0,0,0.5)",
          }}
        >
          <div
            style={{
              fontSize: "48px",
              marginBottom: "24px",
            }}
          >
            🎉
          </div>
          <h1
            style={{
              fontFamily: "'Space Grotesk', sans-serif",
              fontWeight: 700,
              fontSize: "28px",
              marginBottom: "16px",
            }}
          >
            ようこそ、SPARKへ
          </h1>
          <p
            style={{
              color: "rgba(240,239,232,0.5)",
              fontSize: "15px",
              marginBottom: "8px",
            }}
          >
            ログイン中：
          </p>
          <p
            style={{
              color: "#ff6b35",
              fontSize: "16px",
              fontWeight: 600,
              wordBreak: "break-all",
            }}
          >
            {user.email}
          </p>
          <div
            style={{
              marginTop: "32px",
              padding: "16px 24px",
              background: "rgba(255,107,53,0.08)",
              borderRadius: "12px",
              border: "1px solid rgba(255,107,53,0.2)",
              color: "rgba(240,239,232,0.6)",
              fontSize: "14px",
            }}
          >
            ダッシュボードは現在開発中です。まもなく、キャンペーン作成ウィザードが利用可能になります。
          </div>
        </div>
      </div>
    </div>
  );
}
